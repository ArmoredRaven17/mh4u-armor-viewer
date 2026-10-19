"""The 3DS fragment-lighting LUTs (tLutShininess / tLutFresnel) of an MT Framework .mrl, computed by the GAME'S OWN
generator in an emulator. Written for MH4U; takes any 3DS MT executable and generator address.

    python scripts/lut_gen.py <file.mrl> [--exe <code.bin>] [--gen 0xbe7388] [--base 0x100000]

GAME-FREE (the .mrl format and the PICA200): a .mrl texture entry whose type hash is 0 is not a file but a LUT
DEFINITION: { u32 type, u32 format (13), u32 width (512), u32 height (1), f32 p0, p1, p2, -, u16 x[8] (+0x20),
u16 y[8] (+0x30) } at entry + 0xc. The generator samples x = i / 256 for i = 0..256 and writes
v' = p0 + clamp(v, 0, 1) * (p1 - p0), then the 256 differences over the last sample: the PICA's LUT layout of 256
values and 256 deltas (the PICA reads entry + delta x fraction). Types (MH4U's generator, read and checked):
  type 0  v = p2 (constant)
  type 1  v = x
  type 2  v = pow(x, p2)               (MH4U 0xd13778 is powf, checked here against Python's)
  type 3  v = pow(x, p2)               (the same code as type 2)
  type 4  v = p2 + (1 - p2) * pow(1 - x, 5)   (Schlick's Fresnel, F0 = p2)
  type 5  v = a curve through 8 knots (x / 65535, y / 65535; 0xffff = 1.0), cubic between knots with tangents from
          the neighbours (MH4U 0xcde3fc)
The texture the engine makes of it holds the value x 4095 and the delta x 2048 (MH4U's encoder 0x6359e4 / 0x633ee4).

HOW THE GENERATOR WAS FOUND (MH4U, to repeat elsewhere): the material loader's texture loop (MH4U 0xbe6928, entries
0x4c apart) branches on a zero type hash and hands entry + 0xc to a function that switches on the definition's first
word -- that function is the generator (MH4U 0xbe7388) -- and makes a LUT texture of its output (0x6360b0, kind 1).
Running it rather than re-implementing it means every type comes out exactly as the game computes it.
"""
import struct, sys
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_C1_C0_2, UC_ARM_REG_FPEXC

CFG = {'exe': r'C:\MH4U-Extract\exefs\code.decompressed.bin', 'gen': 0xbe7388, 'base': 0x100000}   # MH4U
_uc = None


def configure(**kw):
    """exe, gen, base"""
    global _uc
    CFG.update({k: v for k, v in kw.items() if v is not None}); _uc = None


def _machine():
    global _uc
    if _uc is None:
        code = open(CFG['exe'], 'rb').read()
        uc = Uc(UC_ARCH_ARM, UC_MODE_ARM)
        uc.mem_map(CFG['base'], (len(code) + 0xfff) & ~0xfff); uc.mem_write(CFG['base'], code)
        for a in (0x8000000, 0x9000000, 0x9100000, 0x7000000): uc.mem_map(a, 0x10000)
        uc.reg_write(UC_ARM_REG_C1_C0_2, uc.reg_read(UC_ARM_REG_C1_C0_2) | (0xf << 20))
        uc.reg_write(UC_ARM_REG_FPEXC, 0x40000000)
        _uc = uc
    return _uc


def generate(desc):
    """desc: the 64 bytes of a LUT definition (texture entry + 0xc) -> (256 values, 256 deltas)"""
    uc = _machine()
    OUT, DESC = 0x9000000, 0x9100000
    uc.mem_write(OUT, bytes(0x1000)); uc.mem_write(DESC, bytes(desc).ljust(0x40, b'\0'))
    uc.reg_write(UC_ARM_REG_R0, OUT); uc.reg_write(UC_ARM_REG_R1, DESC)
    uc.reg_write(UC_ARM_REG_SP, 0x8008000); uc.reg_write(UC_ARM_REG_LR, 0x7000000)
    uc.emu_start(CFG['gen'], 0x7000000, count=2_000_000)
    # 257 samples are taken, but the 256 differences are written from index 256 on, over the last sample: the table
    # is 256 values (x = 0 .. 255/256) and 256 deltas, the PICA's LUT layout
    w = struct.unpack('<I', desc[8:12])[0] // 2        # 256
    vals = struct.unpack('<%df' % w, bytes(uc.mem_read(OUT, 4 * w)))
    deltas = struct.unpack('<%df' % w, bytes(uc.mem_read(OUT + 4 * w, 4 * w)))
    return list(vals), list(deltas)


def mrl_luts(path):
    """[(texture index, type, params, values)] for every LUT definition in a .mrl"""
    d = open(path, 'rb').read()
    _, _, nmat, ntex, _, toff, moff = struct.unpack_from('<4sIIIIII', d, 0)
    out = []
    for k in range(ntex):
        e = d[toff + 76 * k: toff + 76 * (k + 1)]
        if struct.unpack_from('<I', e)[0] != 0:
            continue
        desc = e[12:76]
        typ = struct.unpack_from('<I', desc)[0]
        p = struct.unpack_from('<3f', desc, 16)
        vals, _ = generate(desc)
        out.append((k, typ, p, vals))
    return out


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description="a .mrl's LUTs, by the game's own generator")
    ap.add_argument('mrl'); ap.add_argument('--exe'); num = lambda v: int(v, 0)
    ap.add_argument('--gen', type=num); ap.add_argument('--base', type=num)
    a = ap.parse_args()
    configure(exe=a.exe, gen=a.gen, base=a.base)
    for k, typ, p, vals in mrl_luts(a.mrl):
        print('LUT tex %d: type %d params %s' % (k, typ, [round(x, 4) for x in p]))
        print('   x=0..15/16 step 1/16:', [round(vals[i], 4) for i in range(0, 256, 16)])
