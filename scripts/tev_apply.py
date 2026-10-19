"""A 3DS MT Framework material's final fragment state, computed by running the GAME'S OWN material apply in an
emulator, then decoded as the PICA200's TEV and fragment-lighting registers. Written for MH4U; built to be pointed at
another 3DS MT game (MH3U's 3DS build carries the same MFX v52 shader package format and the same PICA200).

    python scripts/tev_apply.py --exe <code.bin> --lfx <package.lfx> <file.mrl> [material index]
        [--base 0x100000] [--apply A --find-cb A --find-tex A --clamp A] [--profile mh4u]
        [--technique TMaterialStd] [--cb CBMaterialStd]

    import tev_apply as T
    T.configure(exe=..., lfx=..., profile='mh4u')            # or addresses by keyword
    light, frag, cols = T.program_defaults(T.technique_program('TMaterialStd'))
    frag2, cols2, cb2 = T.run_apply(cb_bytes, frag, cols)

GAME-FREE FACTS (the PICA200; 3dbrew "GPU/Internal Registers", cross-checked against what the apply writes):
  * A material's fragment state is laid out as the registers: three header words (word 0 the texture-unit config
    GPUREG_TEXUNIT_CONFIG, word 1 GPUREG_TEXENV_UPDATE_BUFFER, word 2 the buffer colour), then six TEV stages of 0x14
    bytes: SOURCE, OPERAND, COMBINER, CONSTANT COLOR (bytes R, G, B, A), SCALE.
      SOURCE   rgb sources in nibbles 0, 1, 2; alpha sources in nibbles 4, 5, 6. 0 primary (vertex) colour, 1 fragment
               primary, 2 fragment secondary, 3-6 texture 0-3, 13 previous buffer, 14 constant, 15 previous stage.
      OPERAND  rgb operands 4 bits each at 0, 4, 8 (0 c, 1 1-c, 2 a, 3 1-a, 4 r, 5 1-r, 8 g, 9 1-g, 12 b, 13 1-b);
               alpha operands 3 bits at 12, 16, 20 (0 a, 1 1-a, 2 r, 3 1-r, 4 g, 5 1-g, 6 b, 7 1-b).
      COMBINER rgb in bits 0-3, alpha in 16-19: 0 replace, 1 modulate, 2 add, 3 add signed, 4 lerp (s0*s2 + s1*(1-s2)),
               5 subtract, 6 dot3 rgb, 7 dot3 rgba, 8 multiply-add, 9 add-multiply (min(s0+s1, 1)*s2).
      SCALE    rgb bits 0-1, alpha 16-17: x1, x2, x4.
      Every stage clamps to [0, 1]. The buffer lags a stage: stage i reads the buffer as the latest of stages 0-3 that
      update it (UPDATE_BUFFER bits 8-11 rgb, 12-15 alpha) left it as of stage i - 2.
  * The fragment-lighting material colours are five words of three 10-bit fields (R 20-29, G 10-19, B 0-9) in the GL
    driver's order: ambient, emission, diffuse, specular0, specular1. The driver multiplies each light's 8-bit colours
    by them (>> 8) into the per-light registers 0x140 + 16 n (specular0, specular1, diffuse, ambient) and writes the
    global ambient 0x1c0 = emission + scene ambient x material ambient.
  * The program's lighting words (+0x48 of the program object): CONFIG0, CONFIG1, LUTINPUT_ABS, LUTINPUT_SELECT,
    LUTINPUT_SCALE and one word not identified.

THE SHADER PACKAGE (MFX v52, game-free): header words [3] record count, [4] program count, [6] program table, [8]
string table; records from 0x2c (offsets), a record = [nameOff, classOff, kind, index << 16, ...]. A program object
(21 words) points at +0x48 its six lighting words, +0x4c its 0x84-byte default fragment state, +0x50 its five
lighting colours: the material constructor copies the last two into the material, and the apply edits the copy. A
technique record's word 5 is its first program. A material parameter word is (jamcrc(name) & 0xfffff) << 12 | the
record index, which is how the .mrl names its constant buffer.

THE GAME-SPECIFIC ADDRESSES (PROFILES below) and how each was found in MH4U, so the same search works elsewhere:
  apply     nDraw::MaterialStd's DTI name -> its DTI object -> the class's vtable (the pointer stored by the
            constructor that registers with that DTI) -> vtable +0x3c, the per-draw "apply" (MH4U 0x62a900; vtable
            0xe7ae6c, DTI 0x10e6ea4). It is the function that looks up the CB by the CBMaterialStd parameter word and
            writes packed 10-bit colours into the material at +0xf4.
  find-cb   the first call in the apply: (material, CB parameter word) -> the CB's floats (MH4U 0xcfafa4).
  find-tex  the apply's texture lookup, (material, tShadowMap's parameter word) -> the bound texture or 0 (MH4U
            0xcfae80); stubbed to "unbound" here.
  clamp     the (1, 1, 1, 1) vector the apply clamps colours against, written at boot (MH4U 0x10e62d0: a .bss word the
            apply loads by a literal); the emulator writes it.
  material  the apply edits fragment state at material +0x70 and colours at +0xf4 (MH4U's layout; read off the apply).
"""
import argparse, struct, zlib
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_C1_C0_2, UC_ARM_REG_FPEXC

PROFILES = {
    'mh4u': {'exe': r'C:\MH4U-Extract\exefs\code.decompressed.bin',
             'lfx': r'C:\MH4U-Extract\romfs\system\ltshader\LtShaderPackage.lfx',
             'base': 0x100000, 'apply': 0x62a900, 'find_cb': 0xcfafa4, 'find_tex': 0xcfae80, 'clamp': 0x10e62d0,
             'frag_off': 0x70, 'cols_off': 0xf4},
}
CFG = dict(PROFILES['mh4u'])
CB_NAME = 'CBMaterialStd'
CB_FLOATS = 44          # CBMaterialStd: 7 colours (28 floats) + 16 switches


def configure(profile=None, **kw):
    """pick a profile and / or override any of exe, lfx, base, apply, find_cb, find_tex, clamp, frag_off, cols_off"""
    global CFG, _UC, _LFX, _REC
    if profile:
        CFG = dict(PROFILES[profile])
    CFG.update({k: v for k, v in kw.items() if v is not None})
    _UC = None; _LFX = None; _REC = None


# ---- the shader package ----------------------------------------------------------------------------------------------
_LFX = None
_REC = None


def lfx():
    global _LFX
    if _LFX is None:
        _LFX = open(CFG['lfx'], 'rb').read()
        assert _LFX[:4] == b'MFX\0', CFG['lfx']
    return _LFX


def records():
    """{record index: (name, class, record offset)}"""
    global _REC
    if _REC is None:
        l = lfx()
        h = struct.unpack_from('<12I', l, 0)
        cstr = lambda o: l[o:l.find(b'\0', o)].decode('latin1')
        _REC = {}
        for i in range(h[3] - 1):              # the last slot overlaps record 1
            o = struct.unpack_from('<I', l, 0x2c + 4 * i)[0]
            w = struct.unpack_from('<4I', l, o)
            _REC[w[3] >> 16] = (cstr(h[8] + w[0]), cstr(h[8] + w[1]), o)
    return _REC


def param_word(name):
    """the .mrl parameter word of a package record: (jamcrc(name) & 0xfffff) << 12 | its record index"""
    idx = next(i for i, (n, _, _) in records().items() if n == name)
    return (((zlib.crc32(name.encode()) ^ 0xffffffff) & 0xfffff) << 12) | idx


def technique_program(name='TMaterialStd'):
    """a technique record's first program (record word 5; MH4U TMaterialStd -> 31)"""
    o = next(o for n, _, o in records().values() if n == name)
    return struct.unpack_from('<6I', lfx(), o)[5]


def program_defaults(prog):
    """(six lighting words, 0x84-byte fragment state, five colour words) of program `prog`"""
    l = lfx()
    h = struct.unpack_from('<12I', l, 0)
    o = struct.unpack_from('<I', l, h[6] + 4 * prog)[0]
    w = struct.unpack_from('<21I', l, o)
    return l[w[18]:w[18] + 0x18], l[w[19]:w[19] + 0x84], l[w[20]:w[20] + 0x14]


# ---- the .mrl --------------------------------------------------------------------------------------------------------
def mrl_cb(path, mat, cb_word=None):
    """(the material's CB bytes, its 15 record words) for material index `mat`"""
    cb_word = cb_word or param_word(CB_NAME)
    d = open(path, 'rb').read()
    _, _, nmat, _, _, _, moff = struct.unpack_from('<4sIIIIII', d, 0)
    w = struct.unpack_from('<15I', d, moff + 60 * mat)
    for o in range(w[13], w[13] + w[2], 12):
        a, val, word = struct.unpack_from('<III', d, o)
        if word == cb_word:
            return d[w[13] + val:w[13] + val + 4 * CB_FLOATS], w
    raise SystemExit('no %s in material %d' % (CB_NAME, mat))


# ---- the emulator ----------------------------------------------------------------------------------------------------
_UC = None
_RUN = {'shadow': False}
STACK, MAT, CBA, TEX, RET = 0x8000000, 0x9000000, 0x9100000, 0x9200000, 0x7000000


def _machine():
    """one emulator for every run: the executable mapped once, the stubs hooked once"""
    global _UC
    if _UC is None:
        code = open(CFG['exe'], 'rb').read()
        uc = Uc(UC_ARCH_ARM, UC_MODE_ARM)
        uc.mem_map(CFG['base'], (len(code) + 0xfff) & ~0xfff); uc.mem_write(CFG['base'], code)
        end = CFG['base'] + ((len(code) + 0xfff) & ~0xfff)
        page = CFG['clamp'] & ~0xffff
        if not (CFG['base'] <= CFG['clamp'] < end):
            uc.mem_map(page, 0x10000)
        uc.mem_write(CFG['clamp'], struct.pack('<4f', 1, 1, 1, 1))
        for a in (STACK, MAT, CBA, TEX, RET): uc.mem_map(a, 0x10000)
        # the VFP: enable it as the boot does (CPACR full access, FPEXC.EN)
        uc.reg_write(UC_ARM_REG_C1_C0_2, uc.reg_read(UC_ARM_REG_C1_C0_2) | (0xf << 20))
        uc.reg_write(UC_ARM_REG_FPEXC, 0x40000000)

        def stub(uc, addr, size, _):
            if addr == CFG['find_cb']: uc.reg_write(UC_ARM_REG_R0, CBA)
            elif addr == CFG['find_tex']: uc.reg_write(UC_ARM_REG_R0, TEX if _RUN['shadow'] else 0)
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))
        for a in (CFG['find_cb'], CFG['find_tex']): uc.hook_add(UC_HOOK_CODE, stub, begin=a, end=a)
        _UC = uc
    return _UC


def run_apply(cb, frag, cols, shadow_bound=False):
    """the apply on a stand-in material holding `frag` / `cols` and the CB -> (fragment state, colours, CB after)"""
    uc = _machine()
    for a in (STACK, MAT, CBA, TEX): uc.mem_write(a, bytes(0x10000))
    uc.mem_write(MAT + CFG['frag_off'], frag); uc.mem_write(MAT + CFG['cols_off'], cols)
    uc.mem_write(CBA, cb)
    uc.mem_write(TEX + 0x24, struct.pack('<I', CFG['base'] if shadow_bound else 0))
    _RUN['shadow'] = shadow_bound
    uc.reg_write(UC_ARM_REG_R0, MAT); uc.reg_write(UC_ARM_REG_SP, STACK + 0x8000); uc.reg_write(UC_ARM_REG_LR, RET)
    uc.emu_start(CFG['apply'], RET, count=20000)
    return (bytes(uc.mem_read(MAT + CFG['frag_off'], 0x84)), bytes(uc.mem_read(MAT + CFG['cols_off'], 0x14)),
            bytes(uc.mem_read(CBA, len(cb))))


# ---- decoding (game-free) --------------------------------------------------------------------------------------------
SRC = {0: 'vtx', 1: 'light.pri', 2: 'light.sec', 3: 'tex0', 4: 'tex1', 5: 'tex2', 6: 'tex3', 0xd: 'buffer',
       0xe: 'const', 0xf: 'prev'}
OPRGB = {0: '', 1: '1-', 2: '.a', 3: '1-.a', 4: '.r', 5: '1-.r', 8: '.g', 9: '1-.g', 0xc: '.b', 0xd: '1-.b'}
OPA = {0: '.a', 1: '1-.a', 2: '.r', 3: '1-.r', 4: '.g', 5: '1-.g', 6: '.b', 7: '1-.b'}
COMB = {0: 'replace(s0)', 1: 's0*s1', 2: 's0+s1', 3: 's0+s1-0.5', 4: 'lerp(s0,s1,s2)', 5: 's0-s1', 6: 'dot3',
        7: 'dot3a', 8: 's0*s1+s2', 9: '(s0+s1)*s2'}


def stages(frag):
    hdr = struct.unpack_from('<3I', frag, 0)
    out = []
    for n in range(6):
        src, op, comb, col, scale = struct.unpack_from('<5I', frag, 0xc + 0x14 * n)
        rs = [(src >> (4 * k)) & 0xf for k in range(3)]; as_ = [(src >> (16 + 4 * k)) & 0xf for k in range(3)]
        ro = [(op >> (4 * k)) & 0xf for k in range(3)]; ao = [(op >> (12 + 4 * k)) & 0x7 for k in range(3)]
        out.append({'stage': n,
                    'rgb': COMB.get(comb & 0xf, comb & 0xf), 'rgbSrc': [SRC.get(s, s) + OPRGB.get(o, '?%d' % o) for s, o in zip(rs, ro)],
                    'a': COMB.get((comb >> 16) & 0xf, (comb >> 16) & 0xf), 'aSrc': [SRC.get(s, s) + OPA.get(o, '?') for s, o in zip(as_, ao)],
                    'const': '#%02x%02x%02x%02x' % tuple(struct.pack('<I', col)),
                    'scale': (1 << (scale & 3), 1 << ((scale >> 16) & 3)),
                    'raw': '%08x %08x %08x %08x %08x' % (src, op, comb, col, scale)})
    return hdr, out


def colours(cols):
    return [(name, ((w >> 20) & 0x3ff, (w >> 10) & 0x3ff, w & 0x3ff))
            for name, w in zip(('ambient', 'emission', 'diffuse', 'specular0', 'specular1'), struct.unpack('<5I', cols))]


def lighting(words):
    """the six lighting words, named (3dbrew's fragment-lighting registers)"""
    c0, c1, ab, sel, sc, w5 = struct.unpack('<6I', words)
    return {'CONFIG0': '%08x' % c0, 'CONFIG1': '%08x' % c1, 'LUTINPUT_ABS': '%08x' % ab, 'LUTINPUT_SELECT': '%08x' % sel,
            'LUTINPUT_SCALE': '%08x' % sc, 'word5 (unidentified)': '%08x' % w5,
            'env config': (c0 >> 4) & 0xf, 'fresnel selector': (c0 >> 2) & 3, 'clamp highlights': (c0 >> 27) & 1}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('mrl'); ap.add_argument('material', nargs='?', type=int, default=0)
    ap.add_argument('--profile', default='mh4u'); ap.add_argument('--exe'); ap.add_argument('--lfx')
    num = lambda s: int(s, 0)
    for k in ('base', 'apply', 'find-cb', 'find-tex', 'clamp', 'frag-off', 'cols-off'):
        ap.add_argument('--' + k, type=num)
    ap.add_argument('--technique', default='TMaterialStd'); ap.add_argument('--cb', default=CB_NAME)
    a = ap.parse_args()
    configure(a.profile, exe=a.exe, lfx=a.lfx, base=a.base, apply=a.apply, find_cb=a.find_cb, find_tex=a.find_tex,
              clamp=a.clamp, frag_off=a.frag_off, cols_off=a.cols_off)
    prog = technique_program(a.technique)
    light, frag, cols = program_defaults(prog)
    word = param_word(a.cb)
    cb, w = mrl_cb(a.mrl, a.material, word)
    f = struct.unpack('<%df' % (len(cb) // 4), cb)
    print('technique %s -> program %d; %s parameter word %08x' % (a.technique, prog, a.cb, word))
    print('CB', [round(x, 3) for x in f[:28]], 'switches', [round(x, 3) for x in f[28:]])
    print('lighting', lighting(light))
    hdr, st = stages(frag)
    print('DEFAULT header', ' '.join('%08x' % x for x in hdr))
    for s in st: print('  ', s)
    nf, nc, _ = run_apply(cb, frag, cols)
    hdr, st = stages(nf)
    print('APPLIED header', ' '.join('%08x' % x for x in hdr))
    for s in st: print('  ', s)
    print('colours', colours(nc))


if __name__ == '__main__':
    main()
