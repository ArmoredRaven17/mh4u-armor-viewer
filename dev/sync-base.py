"""THE SHARED VIEWER BASE, copied from its upstream and kept honest by a hash manifest (2026-10-18; the plan is
C:\\Coding Repos\\VIEWER-BASE-PLAN.md). Generalised from the GU Monster Viewer's dev/sync-render.py, flags kept.

    python dev/sync-base.py --stamp                # UPSTREAM only: record docs/base/SOURCE.json from the files as they are
    python dev/sync-base.py --check                # exit 1 if a base file was edited here, is missing, or is behind
    python dev/sync-base.py --pull [--source DIR]  # copy the base from upstream and record the hashes
    python dev/sync-base.py --pull --force         # ...even over a local edit (it is discarded)
    python dev/sync-base.py --pull --only render/fx.js,ui/shell.js   # just these; the rest are left alone

Every viewer loads ES modules straight out of `docs/` with no bundler, so at RUNTIME the base has to be plain copies.
The manifest stops a plain copy from drifting. `docs/base/SOURCE.json` records the upstream commit and each file's
sha256 (files normalised to LF):

  * a file edited in a CONSUMER fails --check: the fix belongs upstream, where every viewer gets it; then --pull;
  * a file changed UPSTREAM is listed as behind, and --pull takes it.

One direction only. UPSTREAM is the repo whose docs/base/SOURCE.json says `"upstream": true` (the GU Armor Viewer, for
render and ui); there --stamp records the manifest and --check verifies it. A CONSUMER's manifest names its `source`,
the upstream docs/base folder; pass --source on the first pull. This script is itself part of the base: --pull copies
upstream's dev/sync-base.py over this one (the manifest's `tool`). The app's own files (docs/game.js, docs/adapter.js,
everything outside docs/base) are never touched.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BASE = os.path.join(REPO, "docs", "base")
MANIFEST = os.path.join(BASE, "SOURCE.json")
TOOL = os.path.join(HERE, "sync-base.py")
SKIP = {"SOURCE.json"}


# Line endings are normalised in TEXT files only (git may check them out as CRLF on Windows); every other file is raw
# bytes. Normalising a PNG turned the CR LF in its signature into LF and broke every board image (the MH3U Armor
# Viewer agent, 2026-10-18).
TEXT_EXT = (".js", ".css", ".md", ".json", ".py", ".html", ".txt", ".svg")


def lf(data, name):
    return data.replace(b"\r\n", b"\n") if name.lower().endswith(TEXT_EXT) else data


def sha_bytes(data, name):
    return hashlib.sha256(lf(data, name)).hexdigest()


def sha(path):
    with open(path, "rb") as f:
        return sha_bytes(f.read(), path)


def listing(root):
    """every base file under `root`, as forward-slash paths relative to it"""
    out = []
    for d, _, files in os.walk(root):
        for n in files:
            rel = os.path.relpath(os.path.join(d, n), root).replace(os.sep, "/")
            if rel not in SKIP:
                out.append(rel)
    return sorted(out)


def git_head(path):
    try:
        out = subprocess.run(["git", "-C", path, "rev-parse", "HEAD"], capture_output=True, text=True)
        return out.stdout.strip() or None
    except Exception:
        return None


def git_dirty(path, rel):
    try:
        out = subprocess.run(["git", "-C", path, "status", "--porcelain", "--", rel], capture_output=True, text=True)
        return bool(out.stdout.strip())
    except Exception:
        return False


def load():
    if os.path.isfile(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    return {"source": None, "commit": None, "files": {}}


def save(man):
    os.makedirs(BASE, exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(man, f, indent=1, sort_keys=False)
        f.write("\n")


def stamp():
    man = load()
    if man.get("source") and not man.get("upstream"):
        print("this repo pulls its base from %s: --stamp is for the upstream repo only" % man["source"])
        return 1
    files = {n: sha(os.path.join(BASE, n)) for n in listing(BASE)}
    out = {"upstream": True, "source": None, "commit": git_head(REPO),
           "dirty": git_dirty(REPO, "docs/base") or git_dirty(REPO, "dev/sync-base.py"),
           "files": files, "tool": sha(TOOL)}
    save(out)
    print("stamped %d files @ %s%s" % (len(files), (out["commit"] or "?")[:8], " (uncommitted changes)" if out["dirty"] else ""))
    return 0


def check(quiet=False):
    man = load()
    files = man.get("files") or {}
    edited, behind, missing, extra = [], [], [], []
    for name, rec in files.items():
        p = os.path.join(BASE, name)
        if not os.path.isfile(p):
            missing.append(name)
        elif sha(p) != rec:
            edited.append(name)
    for name in listing(BASE):
        if name not in files:
            extra.append(name)
    src = man.get("source")
    if not man.get("upstream") and src and os.path.isdir(src):
        up = load_from(src)
        for name, rec in (up.get("files") or {}).items():
            p = os.path.join(BASE, name)
            if not os.path.isfile(p) or sha(p) != rec:
                if name not in edited and name not in missing:
                    behind.append(name)
        if up.get("tool") and os.path.isfile(TOOL) and sha(TOOL) != up["tool"]:
            behind.append("dev/sync-base.py")
    if not quiet:
        who = "UPSTREAM" if man.get("upstream") else "from %s" % src
        print("base %s @ %s" % (who, (man.get("commit") or "?")[:8]))
        for n in missing:
            print("  MISSING  %s" % n)
        for n in edited:
            print("  EDITED HERE  %s  <- %s" % (n, "--stamp" if man.get("upstream") else "make the change upstream, then --pull"))
        for n in extra:
            print("  NOT IN SOURCE.json  %s  <- %s" % (n, "--stamp" if man.get("upstream") else "a file only this repo has: move it out of docs/base"))
        for n in behind:
            print("  behind upstream  %s  <- --pull" % n)
        if not (missing or edited or extra or behind):
            print("  %d files, all current" % len(files))
    return 1 if (missing or edited or extra or behind) else 0


def load_from(src):
    p = os.path.join(src, "SOURCE.json")
    if not os.path.isfile(p):
        return {}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def pull(force=False, only=None, source=None):
    man = load()
    if man.get("upstream"):
        print("this is the upstream base: nothing to pull (use --stamp)")
        return 1
    src = os.path.abspath(source) if source else man.get("source")
    if not src or not os.path.isdir(src):
        print("no upstream base folder (pass --source <upstream repo>/docs/base): %s" % src)
        return 1
    up = load_from(src)
    if not up.get("files"):
        print("the upstream base has no SOURCE.json: ask its agent to run --stamp")
        return 1
    names = list(up["files"])
    if only:
        unknown = [n for n in only if n not in up["files"]]
        if unknown:
            print("not in the upstream base: %s" % ", ".join(unknown))
            return 1
        names = only
    files = dict(man.get("files") or {})
    if not force:
        for name in names:
            p = os.path.join(BASE, name)
            rec = files.get(name)
            if os.path.isfile(p) and rec and sha(p) != rec:
                print("refusing to overwrite a local edit: %s (make it upstream, or --force)" % name)
                return 1
    for name in names:
        s = os.path.join(src, name)
        with open(s, "rb") as f:
            data = lf(f.read(), name)
        if sha_bytes(data, name) != up["files"][name]:
            print("upstream %s does not match its own SOURCE.json: ask its agent to --stamp" % name)
            return 1
        d = os.path.join(BASE, name)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        with open(d, "wb") as f:
            f.write(data)
        files[name] = up["files"][name]
        print("  %-28s %s" % (name, files[name][:12]))
    if not only:
        for name in list(files):
            if name not in up["files"]:
                p = os.path.join(BASE, name)
                if os.path.isfile(p):
                    os.remove(p)
                del files[name]
                print("  removed (gone upstream)  %s" % name)
        tool_src = os.path.join(os.path.dirname(os.path.dirname(src)), "dev", "sync-base.py")
        if os.path.isfile(tool_src) and os.path.abspath(tool_src) != os.path.abspath(TOOL):
            with open(tool_src, "rb") as f:
                data = lf(f.read(), tool_src)
            with open(TOOL, "wb") as f:
                f.write(data)
    out = {"upstream": False, "source": src, "commit": up.get("commit"), "dirty": up.get("dirty", False),
           "files": files, "tool": up.get("tool")}
    if only:
        out["fileCommits"] = dict(man.get("fileCommits") or {}, **{n: up.get("commit") for n in names})
    save(out)
    print("recorded %d files from %s%s" % (len(names), (up.get("commit") or "?")[:8],
                                            " (upstream had uncommitted changes)" if up.get("dirty") else ""))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stamp", action="store_true")
    ap.add_argument("--pull", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--source", help="with --pull: the upstream repo's docs/base folder (recorded in SOURCE.json)")
    ap.add_argument("--only", help="with --pull: comma-separated base paths (render/fx.js,ui/shell.js), nothing else")
    a = ap.parse_args()
    only = [n.strip() for n in a.only.split(",") if n.strip()] if a.only else None
    if a.stamp:
        sys.exit(stamp())
    sys.exit(pull(a.force, only, a.source) if a.pull else check())
