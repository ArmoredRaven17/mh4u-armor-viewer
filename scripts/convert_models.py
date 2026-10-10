r"""Bulk-convert every MH4U player model -- armour pieces, inner wear, faces, hairs -- and every weapon
model with RevilToolset, and check each output against its own source.

    python scripts/convert_models.py                 # stage + convert + validate, players and weapons
    python scripts/convert_models.py --only player   # or weapon
    python scripts/convert_models.py --check         # validate the existing conversion only

Source: the cart's own archives, read in place (ARC v19, tools\arc4.py's reader):
  romfs/data/pl_<g>_<slot>NNN.arc, pl_<g>_face/hairNNN.arc   one model per arc, internal path
        player\mod\<g>\<pl|face|hair>NNN\<g>_<slot>NNN
  romfs/data/pl_<cls>NNN.arc                                 one weapon per arc,
        weapon\<cls>\<cls>NNN\<part>NNN
  romfs/loc/data/pl_*.arc                                    a few pieces and weapons whose internal
        path carries a leading loc\ (loc\player\mod\f\pl581\...), found only there; were a stem in both
        data/ and loc/data/, loc would win (counted as locOverrides; none on the US cart)
  romfs/loc/data/pl_base_0.arc                               the shared maps player\mod\common\*
        (skin, eye, makeup) and the motion lists (build_poses.py)
Every texture is staged ONCE by its internal path, under conv/tex/<internal path>.tex; differing copies
of one path are counted (the first copy stands).
Outputs: <EXTRACT>\conv\{player,weapon}\<dir>\<stem>.glb + .mod/.mrl, conv\tex\**\*.tex.dds, conv\report.json
"""
import argparse, collections, glob, json, os, re, struct, subprocess, sys

EXTRACT = r'C:\MH4U-Extract'
sys.path.insert(0, os.path.join(EXTRACT, 'tools'))
import arc4

CONV = os.path.join(EXTRACT, 'conv')
TOOL = r'C:\MHGU-Extract\tools\reviltoolset\revil_toolset.exe'   # run read-only
T_MOD, T_MRL, T_TEX = 0x58a15856, 0x2749c8a8, 0x241f5deb
PLAYER_ARC = re.compile(r'^pl_([fm])_(helm|body|arm|wst|leg|face|hair)(\d{3})\.arc$')
WEAPON_ARC = re.compile(r'^pl_(two|swo|one|sou|ham|hue|lan|gun|axe|gaxe|rod|mus|lbg|hbg|bow)(\d{3})\.arc$')


def run(*args, timeout=None):
    try:
        r = subprocess.run([TOOL, *args], cwd=os.path.dirname(TOOL), capture_output=True,
                           text=True, errors='replace', timeout=timeout)
        return r.stdout + r.stderr
    except subprocess.TimeoutExpired:
        return 'TIMEOUT %s' % (args,)


def norm(internal):
    return internal.replace('/', '\\').lower()


def tex_path(internal):
    return os.path.join(CONV, 'tex', *norm(internal).split('\\')) + '.tex'


def arcs(kind):
    """(arc path, key, dir, stem) for every arc of the kind; loc/data overrides data/"""
    pat = PLAYER_ARC if kind == 'player' else WEAPON_ARC
    found = {}
    for sub in ('data', os.path.join('loc', 'data')):
        for p in sorted(glob.glob(os.path.join(EXTRACT, 'romfs', sub, 'pl_*.arc'))):
            m = pat.match(os.path.basename(p))
            if m:
                found.setdefault(m.groups(), []).append(p)
    return found


def stage(kind, rep):
    n = collections.Counter()
    for key, paths in sorted(arcs(kind).items()):
        if len(paths) > 1:
            rep['locOverrides'].append(os.path.basename(paths[-1]))
        src = paths[-1]                       # loc/data sorts last: the US cart's own copy
        with open(src, 'rb') as f:
            for name, th, cs, ds, fl, off in arc4.entries(src):
                if th not in (T_MOD, T_MRL, T_TEX):
                    continue
                data = arc4.read_entry(f, cs, ds, off)
                if th == T_TEX:
                    dst = tex_path(name)
                    if os.path.isfile(dst):
                        if open(dst, 'rb').read() != data:
                            rep['texConflicts'][norm(name)] += 1
                        continue
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    open(dst, 'wb').write(data)
                    n['tex'] += 1
                    continue
                parts = norm(name).split('\\')
                if parts[0] == 'loc':
                    parts = parts[1:]
                # player\mod\<g>\<dir>\<stem>  /  weapon\<cls>\<dir>\<stem>
                d = os.path.join(CONV, kind, *parts[-3:-1]) if kind == 'player' else \
                    os.path.join(CONV, kind, parts[-2])
                os.makedirs(d, exist_ok=True)
                ext = 'mod' if th == T_MOD else 'mrl'
                dst = os.path.join(d, parts[-1] + '.' + ext)
                open(dst, 'wb').write(data)
                rep['internal'][os.path.relpath(dst, CONV).replace(os.sep, '/')] = name
                n[ext] += 1
    return dict(n)


def stage_common(rep):
    """the shared maps of pl_base_0 (skin, eyes, makeup), which few piece arcs carry"""
    src = os.path.join(EXTRACT, 'romfs', 'loc', 'data', 'pl_base_0.arc')
    n = 0
    with open(src, 'rb') as f:
        for name, th, cs, ds, fl, off in arc4.entries(src):
            if th == T_TEX:
                dst = tex_path(name)
                if not os.path.isfile(dst):
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    open(dst, 'wb').write(arc4.read_entry(f, cs, ds, off))
                    n += 1
    return n


def convert(kind):
    """per folder, as the MH3U viewers do (a whole-tree run aborted there); a model left without a glb is retried
    alone with a timeout (mod_to_gltf can hang after writing its outputs)"""
    log = []
    dirs = sorted(d for d in glob.glob(os.path.join(CONV, kind, '**'), recursive=True)
                  if os.path.isdir(d) and glob.glob(os.path.join(d, '*.mod')))
    for i, d in enumerate(dirs):
        log.append(run('mod_to_gltf', d, timeout=300))
        if i % 100 == 0:
            print(kind, i, '/', len(dirs), flush=True)
    for mod in sorted(glob.glob(os.path.join(CONV, kind, '**', '*.mod'), recursive=True)):
        if not os.path.isfile(mod[:-4] + '.glb'):
            log.append('RETRY ' + mod + '\n' + run('mod_to_gltf', mod, timeout=120))
        if not os.path.isfile(mod[:-4] + '.glb'):
            log.append('REPACK ' + mod + '\n' + convert_repacked(mod))
    open(os.path.join(CONV, 'mod_to_gltf_%s.log' % kind), 'w', encoding='utf-8').write('\n'.join(log))


# ---- vertex formats mod_to_gltf does not know (the MH4U Monster Viewer's scripts/convert_monsters.py) ----
# Mesh row (48 bytes, header +0x34; vertex buffer at header +0x38, size +0x18, index buffer +0x3C):
#   +0xA u8 stride, +0x10 u32 byte offset of the block in the vertex buffer, +0x14 u32 vertex format.
#   0x866B6018  44 bytes: the standard 36-byte layout (0xF606F017), then f32 uv2[2] -- repacked by dropping uv2
#   0xCE5A801C  36 bytes: the same, but bytes 28-31 are an RGBA colour, not a tangent -- retagged as it stands
#               (the colour is read as a tangent, which the viewer never uses). Long Sword ken094 is one.
# The original .mod stays beside the glb (the build reads its mesh table); the copy is converted in _repack.
STD_FMT = 0xF606F017
REPACK = {0x866B6018: 44, 0xCE5A801C: 36}


def repack_mod(src):
    """bytes of a copy of the .mod with every REPACK mesh in the standard 36-byte format, or None"""
    d = open(src, 'rb').read()
    h = list(struct.unpack_from('<16I', d, 0))
    nmesh = struct.unpack_from('<H', d, 8)[0]
    mo, vb, vsize, ib = h[13], h[14], h[6], h[15]
    rows = [bytearray(d[mo + 48 * i:mo + 48 * (i + 1)]) for i in range(nmesh)]
    if not any(struct.unpack_from('<I', r, 0x14)[0] in REPACK for r in rows):
        return None
    blocks = sorted({struct.unpack_from('<I', r, 0x10)[0] for r in rows})
    out, new_off = bytearray(), {}
    for bi, boff in enumerate(blocks):
        end = blocks[bi + 1] if bi + 1 < len(blocks) else vsize
        members = [r for r in rows if struct.unpack_from('<I', r, 0x10)[0] == boff]
        fmts = {struct.unpack_from('<I', r, 0x14)[0] for r in members}
        stride = {r[0xA] for r in members}
        assert len(stride) == 1, (src, boff, stride)
        stride = stride.pop()
        new_off[boff] = len(out)
        raw = d[vb + boff:vb + end]
        if stride != 36:
            assert all(REPACK.get(f) == stride for f in fmts), (src, boff, fmts, stride)
            for i in range(len(raw) // stride):
                out += raw[i * stride:i * stride + 36]
        else:
            out += raw
    for r in rows:
        struct.pack_into('<I', r, 0x10, new_off[struct.unpack_from('<I', r, 0x10)[0]])
        if struct.unpack_from('<I', r, 0x14)[0] in REPACK:
            r[0xA] = 36
            struct.pack_into('<I', r, 0x14, STD_FMT)
    assert ib == vb + vsize, src             # the index buffer follows the vertex buffer directly
    h[6] = len(out)
    h[15] = vb + len(out)
    body = bytearray(d[:vb])
    struct.pack_into('<16I', body, 0, *h)
    for i, r in enumerate(rows):
        body[mo + 48 * i:mo + 48 * (i + 1)] = r
    return bytes(body + out + d[ib:])


def convert_repacked(mod):
    data = repack_mod(mod)
    if data is None:
        return 'no repackable vertex format'
    work = os.path.join(os.path.dirname(mod), '_repack')
    os.makedirs(work, exist_ok=True)
    tmp = os.path.join(work, os.path.basename(mod))
    open(tmp, 'wb').write(data)
    log = run('mod_to_gltf', tmp, timeout=120)
    if os.path.isfile(tmp[:-4] + '.glb'):
        os.replace(tmp[:-4] + '.glb', mod[:-4] + '.glb')
    for p in glob.glob(os.path.join(work, '*')):
        os.remove(p)
    os.rmdir(work)
    return log


def convert_tex():
    open(os.path.join(CONV, 'mtf_tex_to_dds.log'), 'w', encoding='utf-8').write(
        run('mtf_tex_to_dds', '--platform', 'N3DS', os.path.join(CONV, 'tex')))


def glb_json(p):
    b = open(p, 'rb').read()
    n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + n])


def mod_header(p):
    d = open(p, 'rb').read(0x40)
    assert d[:4] == b'MOD\0' and struct.unpack_from('<H', d, 4)[0] == 0xE6, p
    bones, meshes, mats = struct.unpack_from('<HHH', d, 6)
    return {'bones': bones, 'meshes': meshes, 'materials': mats, 'verts': struct.unpack_from('<I', d, 12)[0]}


def check():
    rep = {'models': {}, 'problems': []}
    for mod in sorted(glob.glob(os.path.join(CONV, '*', '**', '*.mod'), recursive=True)):
        rel = os.path.relpath(mod, CONV).replace(os.sep, '/')
        glb = mod[:-4] + '.glb'
        h = mod_header(mod)
        if not os.path.isfile(glb):
            rep['problems'].append('%s: no glb' % rel)
            continue
        js = glb_json(glb)
        verts = sum(js['accessors'][pr['attributes']['POSITION']]['count']
                    for m in js.get('meshes', []) for pr in m['primitives'])
        rep['models'][rel] = {'mod': h, 'glbVerts': verts, 'skins': len(js.get('skins', []))}
        if verts != h['verts']:
            rep['problems'].append('%s: glb has %d vertices, the .mod says %d' % (rel, verts, h['verts']))
    for tex in glob.glob(os.path.join(CONV, 'tex', '**', '*.tex'), recursive=True):
        if not os.path.isfile(tex + '.dds'):
            rep['problems'].append('%s: no dds' % os.path.relpath(tex, CONV))
    return rep


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=['player', 'weapon'])
    ap.add_argument('--check', action='store_true')
    opt = ap.parse_args()
    kinds = [opt.only] if opt.only else ['player', 'weapon']
    stage_rep = {'locOverrides': [], 'texConflicts': collections.Counter(), 'internal': {}}
    if not opt.check:
        for k in kinds:
            print('staged', k, stage(k, stage_rep), flush=True)
        print('common maps', stage_common(stage_rep), flush=True)
        for k in kinds:
            convert(k)
        convert_tex()
        json.dump({k: dict(v) if isinstance(v, collections.Counter) else v for k, v in stage_rep.items()},
                  open(os.path.join(CONV, 'stage.json'), 'w'), indent=1)
        print('loc overrides', len(stage_rep['locOverrides']), 'texture path conflicts',
              len(stage_rep['texConflicts']), flush=True)
    rep = check()
    json.dump(rep, open(os.path.join(CONV, 'report.json'), 'w'), indent=1)
    print(len(rep['models']), 'models checked,', len(rep['problems']), 'problems')
    for p in rep['problems'][:40]:
        print('  ', p)
