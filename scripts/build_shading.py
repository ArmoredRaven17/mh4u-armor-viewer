"""docs/shading.json: every MaterialStd's fragment state as the game computes it, for the 4U render path.

    python scripts/build_shading.py

Reads the same .mrl files build_armor.py / build_weapons.py ship (conv\\player\\<g>\\<dir>\\<stem>.mrl, keyed
<g>/<stem>; conv\\weapon\\<folder>\\<stem>.mrl, keyed w/<dir>/<stem>) and, for each material that
materials.json lists, runs the game's own nDraw::MaterialStd apply (0x62a900, scripts/tev_apply.py) on the
program's default state (lfx program 31) with the material's CBMaterialStd. The result is what the GPU gets:

  shading.json = {
    _about,
    tev:  [ [header word 0, update-buffer word, [ [src, op, comb, scale] x 6 ] ], ... ]   pooled programs
    lut:  [ [257 values], ... ]                                                         pooled LUT tables
    light: the character-creation light set (player\\char_make-f, notes/shading-decode.md step 5)
    pieces / weapons: { ref: { material name: {
        p:  tev program index,  k: [6 constant colours as 0xRRGGBBAA],
        c:  [ambient, emission, diffuse, specular0, specular1] as packed 10-bit (R 20-29, G 10-19, B 0-9),
        rr / fr: LUT indices (tLutShininess / tLutFresnel; absent = unbound),
        x / q: texture-table index (1-based, materials.json `tex`) of tExtendMap / tProceduralMap,
        a: fMaterialStdAmbient rgb, pl: fMaterialStdPreLightScale (vertex uniforms c29 / c28),
        clips: the material's own animation clips (below; the Charge Blade's only, for now), and on the Charge
        Blade's: anim (it has an animation set) and mi (its index in the .mrl) } } },
    cbGlow: { red, yellow }   the Charge Blade's Shield Charge materials (weapon\common\gaxe_sld_power_up_red /
        gaxe_sld_time_up_yellow, pl_base_0.arc), each as a material entry: what 0xb06ce0 puts on the shield's colour
        type 0 and 3 materials (it copies their tLutFresnel, tLutShininess and the whole CBMaterialStd, re-runs the
        apply, and hands over the glow's animation set, whose auto clips start at frame 0 -- 0x637f2c)
  }

A MATERIAL ANIMATION (the .mrl material record word 14 = the set's offset; read here from the files): the set is u32
clip count, u32 clip offsets (from the set); a clip is u32 frames, u16 flags (bit 1: starts by itself, 0x637f2c), u16,
u32 data offset, u32 name hash, then u32 track offsets (from the set) up to the data; a track is u32 CB parameter word,
u32 kind | key count << 8 (kind 0x11: four floats), u32 member word (bits 12-21 the float offset), then per key u32
frame + four floats. clips = [{ n: frames, f: flags, h: name hash, t: [[float offset,
[[frame, x, y, z, w], ...]], ...] }] for the CBMaterialStd four-float tracks (every track of every armour and weapon
clip is one). Keys are taken as linear and frames as the engine's 60 units a second: the clip stepper is not read.
THE REGISTERS a track writes (the apply, step 1, checked here against the emulator on every key): fMaterialStdEmission
(float 0) -> the lighting emission word, min(x * 0.5, 1) * 255; fMaterialStdReflect (float 12) -> TEV stage 3's
constant, min(x, 1) * 255 per byte.

Only nDraw::MaterialStd (class 0x5fb0ebe4) is listed; other classes keep the generic path.
"""
import glob, json, os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mrl, tev_apply, lut_gen, sdl_lights

CONV = r'C:\MH4U-Extract\conv'
CHAR_MAKE = r'C:\MH4U-Extract\arcx\eng\data\core_title\player\char_make-f.4c0db839'
MATERIAL_STD = 0x5fb0ebe4
CB_WORD = None
GLOW = r'C:\MH4U-Extract\arcx\loc\data\pl_base_0\weapon\common\gaxe_sld_%s.2749c8a8'
EMISSION, REFLECT = 0, 12          # CBMaterialStd float offsets the clips write
SKIPPED = {}                       # the other tracks (not read): (CB word, kind, float offset) -> count
CLIP_REFS = ('w/gaxe/',)           # whose clips are taken: the Charge Blade's (the rest of material animation waits)


def lut_desc(d, toff, idx):
    """the 64-byte LUT definition of 1-based texture slot idx, or None if that slot is a file"""
    e = d[toff + 76 * (idx - 1): toff + 76 * idx]
    if len(e) < 76 or struct.unpack_from('<I', e, 0)[0] != 0:
        return None
    return e[12:76]


def material(d, toff, w, slots, frag, cols, pools, ref=None):
    cb = None
    for o in range(w[13], w[13] + w[2], 12):
        a, val, word = struct.unpack_from('<III', d, o)
        if word == CB_WORD:
            cb = d[w[13] + val:w[13] + val + 0xb0]
    if cb is None:
        return None
    nf, nc, _ = tev_apply.run_apply(cb, frag, cols)
    hdr = list(struct.unpack_from('<3I', nf, 0))
    prog, consts = [], []
    for n in range(6):
        src, op, comb, col, scale = struct.unpack_from('<5I', nf, 0xc + 0x14 * n)
        prog.append([src, op, comb, scale])
        consts.append(struct.unpack('>I', struct.pack('<I', col))[0])      # bytes R, G, B, A -> 0xRRGGBBAA
    key = json.dumps([hdr[0], hdr[1], prog])
    if key not in pools['tevKey']:
        pools['tevKey'][key] = len(pools['tev']); pools['tev'].append([hdr[0], hdr[1], prog])
    f = struct.unpack('<44f', cb)
    out = {'p': pools['tevKey'][key], 'k': consts, 'c': list(struct.unpack('<5I', nc)),
           'a': [round(x, 4) for x in f[16:19]], 'pl': round(f[24], 4)}
    for slot, k in (('tLutShininess', 'rr'), ('tLutFresnel', 'fr')):
        i = slots.get(slot)
        desc = lut_desc(d, toff, i) if i else None
        if desc is None:
            continue
        # 257 samples: the 256 values at x = i / 256 and the last one's value + delta (x = 1), so the
        # PICA's value + delta * fraction can be read as an interpolation between neighbours
        vals, deltas = lut_gen.generate(desc)
        lk = json.dumps([round(v, 5) for v in vals + [vals[-1] + deltas[-1]]])
        if lk not in pools['lutKey']:
            pools['lutKey'][lk] = len(pools['lut']); pools['lut'].append(json.loads(lk))
        out[k] = pools['lutKey'][lk]
    for slot, k in (('tExtendMap', 'x'), ('tProceduralMap', 'q')):
        if slots.get(slot):
            out[k] = slots[slot]
    cb_ref = ref is not None and ref.startswith(CLIP_REFS)
    if cb_ref and w[14]:
        out['anim'] = 1                  # it has an animation set (0x2d6b98 picks the gauge material by this)
    clips = clips_of(d, w) if ref is None or cb_ref else []
    if clips and not any(c['t'] for c in clips):
        clips = []
    if clips:
        check_registers(cb, frag, cols, clips)
        out['clips'] = clips
    return out


def clips_of(d, w):
    """the material's animation clips (see the header), CBMaterialStd four-float tracks only"""
    a = w[14]
    if not a:
        return []
    n = struct.unpack_from('<I', d, a)[0]
    out = []
    for co in struct.unpack_from('<%dI' % n, d, a + 4):
        c = a + co
        frames, flags, _, data, nameh = struct.unpack_from('<IHHII', d, c)
        tracks = []
        for k in range((a + data - (c + 16)) // 4):             # the track offsets run from +0x10 up to the data
            to = a + struct.unpack_from('<I', d, c + 16 + 4 * k)[0]
            h, kc, word = struct.unpack_from('<3I', d, to)
            kind, nk = kc & 0xff, kc >> 8
            if not (h == CB_WORD and kind == 0x11 and (word >> 12) & 0x3ff in (EMISSION, REFLECT)):
                SKIPPED[(hex(h), hex(kind), (word >> 12) & 0x3ff)] = SKIPPED.get((hex(h), hex(kind), (word >> 12) & 0x3ff), 0) + 1
                continue
            keys = [list(struct.unpack_from('<I4f', d, to + 12 + 20 * i)) for i in range(nk)]
            tracks.append([(word >> 12) & 0x3ff, [[k[0]] + [round(x, 4) for x in k[1:]] for k in keys]])
        out.append({'n': frames, 'f': flags, 'h': '%08x' % nameh, 't': tracks})
    return out


def check_registers(cb, frag, cols, clips):
    """every key's value through the emulated apply must land where the render path writes it"""
    for c in clips:
        for off, keys in c['t']:
            for k in keys:
                f = list(struct.unpack('<44f', cb)); f[off:off + 4] = k[1:5]
                nf, nc, _ = tev_apply.run_apply(struct.pack('<44f', *f), frag, cols)
                if off == EMISSION:
                    want = [int(min(x * 0.5, 1) * 255) for x in k[1:4]]
                    w = struct.unpack_from('<I', nc, 4)[0]
                    got = [(w >> 20) & 0x3ff, (w >> 10) & 0x3ff, w & 0x3ff]
                elif off == REFLECT:
                    want = [int(min(x, 1) * 255) for x in k[1:5]]
                    got = list(nf[0xc + 0x14 * 3 + 12:0xc + 0x14 * 3 + 16])
                else:
                    raise SystemExit('a clip writes float %d: no register mapping read for it' % off)
                assert got == want, (off, k, got, want)


def slots_of(d, w):
    s = {}
    for o in range(w[13], w[13] + w[2], 12):
        a, val, word = struct.unpack_from('<III', d, o)
        if a == 0 and val == 0 and word == 0:
            break
        n = mrl.rec_name(word)
        if n and n.startswith('t'):
            s[n] = val
    return s


def one_file(path, names, frag, cols, pools, ref):
    d = open(path, 'rb').read()
    _, _, nmat, ntex, _, toff, moff = struct.unpack_from('<4sIIIIII', d, 0)
    by_hash, index = {}, {}
    for m in range(nmat):
        w = struct.unpack_from('<15I', d, moff + 60 * m)
        by_hash[w[1]] = w; index[w[1]] = m
    out = {}
    for name in names:
        w = by_hash.get(mrl.name_hash(name))
        if not w or w[0] != MATERIAL_STD:
            continue
        r = material(d, toff, w, slots_of(d, w), frag, cols, pools, ref)
        if r:
            if ref.startswith(CLIP_REFS):
                r['mi'] = index[w[1]]       # the material's place in its .mrl (the game's "first" is by this)
            out[name] = r
    return out


def light_set():
    objs = {nm: dict(mem) for nm, _, mem in sdl_lights.read(CHAR_MAKE)}
    inf, hemi = objs['base01-InfiniteLight'], objs['base01-HemiSphereLight']
    return {'source': 'player\\char_make-f (core_title.arc)',
            'infinite': {'color': list(inf['mColor'][:3]), 'balance': inf['mBalance'], 'dir': list(inf['mDir'][:3])},
            'hemi': {'color': list(hemi['mColor'][:3]), 'rev': list(hemi['mRevColor'][:3]),
                     'dir': list(hemi['mDir'][:3])}}


def main():
    docs = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs')
    mats = json.load(open(os.path.join(docs, 'materials.json'), encoding='utf-8'))
    global CB_WORD
    CB_WORD = tev_apply.param_word('CBMaterialStd')                  # 0x16a5b126
    # TMaterialStd's first pass (program 31); its second, 32, carries the same fragment defaults
    _, frag, cols = tev_apply.program_defaults(tev_apply.technique_program('TMaterialStd'))
    pools = {'tev': [], 'tevKey': {}, 'lut': [], 'lutKey': {}}
    out = {'_about': __doc__.split('\n\n')[1].strip(), 'light': light_set(), 'pieces': {}, 'weapons': {}}
    srcs = {}
    for p in glob.glob(os.path.join(CONV, 'player', '*', '*', '*.mrl')):
        g = os.path.basename(os.path.dirname(os.path.dirname(p)))
        srcs[('pieces', '%s/%s' % (g, os.path.splitext(os.path.basename(p))[0]))] = p
    for p in glob.glob(os.path.join(CONV, 'weapon', '*', '*.mrl')):
        d = os.path.basename(os.path.dirname(p)).rstrip('0123456789')
        srcs[('weapons', 'w/%s/%s' % (d, os.path.splitext(os.path.basename(p))[0]))] = p
    n = 0
    for section in ('pieces', 'weapons'):
        for ref, ent in mats.get(section, {}).items():
            p = srcs.get((section, ref))
            if not p:
                print('no .mrl for', section, ref); continue
            r = one_file(p, list(ent['mats']), frag, cols, pools, ref)
            if r:
                out[section][ref] = r; n += len(r)
    out['cbGlow'] = {}
    for colour in ('red', 'yellow'):
        p = GLOW % ('power_up_red' if colour == 'red' else 'time_up_yellow')
        d = open(p, 'rb').read()
        _, _, nmat, ntex, _, toff, moff = struct.unpack_from('<4sIIIIII', d, 0)
        w = struct.unpack_from('<15I', d, moff)
        out['cbGlow'][colour] = material(d, toff, w, slots_of(d, w), frag, cols, pools)
    out['tev'] = pools['tev']; out['lut'] = pools['lut']
    json.dump(out, open(os.path.join(docs, 'shading.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    print('%d materials, %d TEV programs, %d LUTs' % (n, len(pools['tev']), len(pools['lut'])))
    print('clip tracks not taken (CB word, kind, float):', sorted(SKIPPED.items(), key=lambda x: -x[1]))


if __name__ == '__main__':
    main()
