r"""Weapon stances for the MH4U Armor Viewer: where the game puts each weapon part, and which of the weapon's own
motions it plays, on every frame of every clip of the class's motion list -- from the game's own code.

    python scripts/build_stances.py [w00 ...]      # every class by default

Per class:
  1. the weapon's own motion list, weapon\<dir>\mot\wgNN (romfs/data/pl_wNN.arc; the list table 0xef9100), converted
     with lmt_to_gltf onto a carrier -- the class's model with the most joints -- and stripped to nodes + animations:
     docs/poses/weapons/wgNN.glb. The viewer applies its tracks by weapon joint id (gid) to whatever model is shown.
  2. the hunter's list (player\mot\wNN\wNN, motion bank 5: id 0x500 | N) and its group-0 events (lmt_to_json), which
     set the hold state (weapon_state.HOLD_BY_ID)
  3. for each clip, part and frame: weapon_state.Harness runs the game's placement (0x34c5d8) and records the
     state, hunter bone, record, scale and the weapon motions the joint code samples (0x351798)
Writes docs/stances/wNN.json:
  { fps, weapon: {file, motions: {M: {frames, loop}}}, clips: {clip: {motion, f0, parts: [timeline per part]}},
    rest: [timeline per part] }   -- a timeline is weapon_state.timeline's segments.
`rest` is the sheathed look (common motion 0x001, the weapon not drawn).

VARIANTS: the joint code reads per-model tables with the weapon's model (callback +0x264), so the class's models are
grouped by what the code does with them (`variants`: {v: {models, model, wid}}); each clip carries a timeline set per
variant (`clips[clip].v[v]`), and `rest[v]` the sheathed look.
NOT HERE: the common motions' own weapon handling, the lobby lists (wgNN_LB), and state carried from clip to clip
(the weapon unit is fresh at each clip's start).
"""
import json, os, re, shutil, struct, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lmt_fix
import weapon_state as WS
from mtlib import glb_read, strip_to_animation, clip_list

EXTRACT = r'C:\MH4U-Extract'
TOOL = r'C:\MHGU-Extract\tools\reviltoolset\revil_toolset.exe'
CONV = os.path.join(EXTRACT, 'conv')
WMOT, HMOT, EV = os.path.join(CONV, 'wmot'), os.path.join(CONV, 'mot'), os.path.join(CONV, 'ev')
DOCS = os.path.join(os.path.dirname(HERE), 'docs')
FPS = WS.FPS
DIRS = {0: 'two', 1: 'one', 2: 'ham', 3: 'lan', 4: 'hbg', 6: 'lbg', 7: 'swo', 8: 'axe', 9: 'gun', 10: 'bow',
        11: 'sou', 12: 'hue', 13: 'rod', 14: 'gaxe'}


def run(*args):
    r = subprocess.run([TOOL, *args], cwd=os.path.dirname(TOOL), capture_output=True, text=True, errors='replace',
                       timeout=600)
    return r.stdout + r.stderr


def carrier(cls):
    """the class's main-part model with the most joints (the wgNN tracks address weapon joint ids)"""
    best = None
    for glb in glob.glob(os.path.join(CONV, 'weapon', DIRS[cls] + '[0-9][0-9][0-9]', '*.glb')):
        js, _ = glb_read(glb)
        n = sum(1 for nd in js['nodes'] if re.match(r'^\d+:\d+$', nd.get('name', '')))
        if best is None or n > best[0]:
            best = (n, glb)
    return best[1]


USAGE_PATH = {0: 'rotation', 1: 'translation', 2: 'scale'}     # an LMT track's usage byte


def strip_untracked(path, mots):
    """Keep only the channels a weapon motion's LMT actually tracks. lmt_to_gltf writes every joint of the carrier into
    every clip, the untracked ones at the CARRIER's rest values -- which then pull another model's joints out of place
    (the Long Sword's motion 1 tracks joint 1's scale alone; its joints 2 and 3 came out floating). The MHGU viewer
    strips the same way (strip-untracked-weapon-tracks.py)."""
    from mtlib import glb_write, compact
    js, bin_ = glb_read(path)
    gid_of = {}
    for i, nd in enumerate(js['nodes']):
        m = re.match(r'^\d+:(\d+)$', nd.get('name', ''))
        if m:
            gid_of[i] = int(m.group(1))
    dropped = kept = 0
    for a in js.get('animations', []):
        m = re.match(r'^Motion\[(\d+)\]', a.get('name', ''))
        mo = mots.get(int(m.group(1))) if m else None
        tracked = {(t['bone'], USAGE_PATH.get(t['usage'])) for t in mo['tracks']} if mo else set()
        chans = []
        for c in a['channels']:
            key = (gid_of.get(c['target']['node']), c['target']['path'])
            if key in tracked:
                chans.append(c)
            else:
                dropped += 1
        kept += len(chans)
        used = sorted({c['sampler'] for c in chans})
        remap = {o: n for n, o in enumerate(used)}
        a['samplers'] = [a['samplers'][o] for o in used]
        for c in chans:
            c['sampler'] = remap[c['sampler']]
        a['channels'] = chans
    compact(js, bin_)
    glb_write(path, js, bin_)
    return kept, dropped


def untag(lmt):
    """A copy of a weapon motion list with its TAG tracks disowned. Many motions open with a constant track whose
    bone byte is a per-motion tag, not a joint (wg14 Motion[12]: bone 13; Motion[1]: bone 1, ahead of joint 1's real
    translation), and lmt_to_gltf keeps the FIRST track for a joint and property -- so a tag that names a real joint
    wipes its motion (the Charge Blade shield's halves lost their -23 / 23 cm). The MHGU viewer met the same in
    wg01_r_00. Any track whose (bone, usage) comes again later in the motion is pointed at bone 0xfe, which no model
    has; returns (bytes, number disowned)."""
    b = bytearray(lmt)
    ver, cnt = struct.unpack_from('<HH', b, 4)
    n = 0
    for i in range(cnt):
        mo = struct.unpack_from('<I', b, 8 + 4 * i)[0]
        if not mo:
            continue
        to, nt = struct.unpack_from('<II', b, mo)
        keys = [(b[to + 0x24 * k + 3], b[to + 0x24 * k + 1]) for k in range(nt)]
        for k in range(nt):
            if keys[k] in keys[k + 1:]:
                b[to + 0x24 * k + 3] = 0xfe
                n += 1
    return bytes(b), n


def weapon_motions(cls, key):
    work = os.path.join(CONV, '_wstance', key)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    src = carrier(cls)
    name = 'wg%02d' % cls
    shutil.copy2(src, os.path.join(work, name + '.glb'))
    lmt, ntag = untag(open(os.path.join(WMOT, name + '.lmt'), 'rb').read())
    open(os.path.join(work, name + '.lmt'), 'wb').write(lmt)
    json.dump([[name + '.glb', name + '.lmt']], open(os.path.join(work, 'batch.json'), 'w'))
    log = run('lmt_to_gltf', os.path.join(work, 'batch.json'))
    out = os.path.join(work, name + '_out.glb')
    if not os.path.isfile(out):
        raise RuntimeError('lmt_to_gltf made nothing for %s: %s' % (name, log[-400:]))
    js, _ = glb_read(src)
    rel = 'poses/weapons/%s.glb' % name
    dst = os.path.join(DOCS, rel.replace('/', os.sep))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    strip_to_animation(out, dst, {n.get('name', '') for n in js['nodes']})
    mots = lmt_fix.motions(lmt)
    strip_untracked(dst, mots)
    return {'file': rel, 'carrier': os.path.relpath(src, CONV).replace(os.sep, '/'),
            'motions': {str(i): {'frames': m['frames'], 'loop': m['loop']} for i, m in sorted(mots.items())},
            'clips': clip_list(dst)}


def hunter_clips(key):
    """[(clip, motion index, f0, frames)] of the hunter's wNN list, with the converter's split: Motion[N] covers the
    whole motion, Motion[N]_start frames 0..loop, Motion[N]_loop frames loop..frames-1 (from t = 0)"""
    poses = json.load(open(os.path.join(CONV, 'poses.json'), encoding='utf-8'))
    lst = next(l for l in poses['f']['lists'] if l['id'] == key)
    mots = lmt_fix.motions(open(os.path.join(HMOT, key + '.lmt'), 'rb').read())
    out = []
    for c in lst['clips']:
        m = re.match(r'Motion\[(\d+)\](?:_(start|loop))?$', c['clip'])
        if not m or int(m.group(1)) not in mots:
            continue
        n, part = int(m.group(1)), m.group(2)
        mo = mots[n]
        if part == 'start':
            f0, frames = 0, mo['loop']
        elif part == 'loop' and mo['loop'] > 0:
            f0, frames = mo['loop'], mo['frames'] - 1 - mo['loop']
        else:
            f0, frames = 0, mo['frames']
        out.append((c['clip'], n, f0, frames))
    return out


MODES = {8: [0, 1], 9: [0, 1], 14: [0, 1]}


def variants(cls, h, clips):
    """the class's weapon models grouped by what the code does with them: every model is probed on the first and the
    middle frame of every clip (both parts); models that agree everywhere share one set of timelines"""
    w = json.load(open(os.path.join(DOCS, 'weapons.json'), encoding='utf-8'))
    rows = w['weapons']['w%02d' % cls]
    models = {}
    for r in rows:
        models.setdefault(r['model'], r['id'])
    groups = {}
    for model, wid in sorted(models.items()):
        sig = []
        for mode in MODES.get(cls, [0]):          # in each of the class's states (a model can differ in one only)
            h.mode = mode
            for clip, n, f0, frames in clips:
                for k in range(len(WS.TYPES[cls])):
                    for f in (f0, f0 + frames // 2):
                        pl, _ = h.place(cls, k, wid, 0x500 | n, f, False, None, model)
                        sig.append(json.dumps(pl, sort_keys=True))
                sig.append(json.dumps(h.place(cls, 0, wid, 0x001, 0, True, None, model)[0], sort_keys=True))
        h.mode = 0
        groups.setdefault('|'.join(sig), []).append((model, wid))
    out = {}
    for i, members in enumerate(sorted(groups.values(), key=lambda m: m[0][0])):
        out['v%d' % i] = {'models': [m for m, _ in members], 'model': members[0][0], 'wid': members[0][1]}
    return out


def one_class(key):
    cls = int(key[1:])
    wm = weapon_motions(cls, key)
    events = json.load(open(os.path.join(EV, key + '.json'), encoding='utf-8'))
    h = WS.Harness()
    h.wframes = {int(k): (m['frames'], m['loop']) for k, m in wm['motions'].items()}
    hc = hunter_clips(key)
    var = variants(cls, h, hc)
    nparts = len(WS.TYPES[cls])
    # the weapon's MODE (player data +0x6f9, 0xb07e58): the Switch Axe's sword (1) and the Charge Blade's axe (1)
    # are kept apart from their other form, which the game carries from the last morph; each clip is run in both
    modes = MODES.get(cls, [0])
    clips = {}
    for clip, n, f0, frames in hc:
        ev = (events.get('%s[%d]' % (key, n)) or {}).get('0') or []
        clips[clip] = {'motion': n, 'f0': f0}
        for mode in modes:
            h.mode = mode
            clips[clip]['v' if mode == 0 else 'm%d' % mode] = {
                v: [h.timeline(cls, k, g['wid'], 0x500 | n, f0, frames, False, ev, g['model']) for k in range(nparts)]
                for v, g in var.items()}
    h.mode = 0
    rest = {v: [h.timeline(cls, k, g['wid'], 0x001, 0, 0, True, None, g['model']) for k in range(nparts)]
            for v, g in var.items()}
    # THE MODE'S IDLE, per mode and model group: the weapon motions the drawn idle (Motion[1], 0x501) asks for at its
    # first frame, by slot, held -- the baseline under every clip (the MHGU viewer's layering: a clip that asks for
    # no weapon motion of its own keeps the mode's form, and one that asks for some overrides only what they track)
    idle = {}
    for mode in modes:
        h.mode = mode
        idle[str(mode)] = {}
        for v, g in var.items():
            per = {}
            for k in range(nparts):
                # after the warm-up, so a weapon motion on its own clock (the Gunlance cooling) stands where it settles
                pl = h.timeline(cls, k, g['wid'], 0x501, 0, 0, False, None, g['model'])[0]
                for w in pl.get('wmot', []):
                    per.setdefault(str(w[1]), []).append([w[0], w[2], 0])
            idle[str(mode)][v] = per
    h.mode = 0
    out = {'version': 1, 'class': key, 'fps': FPS, 'weapon': wm, 'variants': var, 'clips': clips, 'rest': rest,
           'modes': modes, 'idle': idle}
    os.makedirs(os.path.join(DOCS, 'stances'), exist_ok=True)
    p = os.path.join(DOCS, 'stances', key + '.json')
    with open(p, 'w', encoding='utf-8', newline=chr(10)) as f:
        json.dump(out, f, separators=(',', ':'))
    nseg = sum(len(t) for c in clips.values() for tl in c['v'].values() for t in tl)
    return '%s: %d clips, %d variants, %d segments, %d weapon clips, %.0f KB' % (
        key, len(clips), len(var), nseg, len(wm['clips']), os.path.getsize(p) / 1024)


if __name__ == '__main__':
    keys = sys.argv[1:] or ['w%02d' % c for c in sorted(DIRS)]
    for k in keys:
        try:
            print(one_class(k), flush=True)
        except Exception as e:
            print(k, 'FAILED', repr(e)[:400], flush=True)
