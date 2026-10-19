"""PICA200 vertex / geometry shader disassembler for the shader binaries in any file that embeds them (DVLB / DVLP /
DVLE, the 3DS SDK's shader binary format): an MT Framework shader package (MH4U's LtShaderPackage.lfx; MH3U's 3DS one
is the same MFX v52 format), a .shbin, anything. Game-free: the game's own vertex programs read rather than guessed.

    python scripts/pica.py <file> [DVLE offset (hex) ...]      every DVLE, or the ones named
    import pica
    for e in pica.dvles(data): print(pica.listing(data, e))

The instruction set is the PICA200's, as documented on 3dbrew ("Shader Instruction Set"):
  opcode bits 26-31.  Format 1 (ADD, DP3, DP4, DPH, DST, EX2, LG2, LITP, MUL, SGE, SLT, FLR, MAX, MIN, RCP, RSQ, MOVA, MOV):
  dst 21-25, idx 19-20, src1 12-18 (7 bits), src2 7-11 (5 bits), desc 0-6.  Format 1i (DPHI, DSTI, SGEI, SLTI): src1 14-18
  (5 bits), src2 7-13 (7 bits).  Format 1c (CMP, 0x2e/0x2f): cmpx 24-26, cmpy 21-23.  Format 2 (CALL, CALLC, CALLU, IFU,
  IFC, LOOP, JMPC, JMPU, BREAKC): dst offset 10-21, num 0-7, condition / bool / int uniform in the high bits.  Format 5
  (MAD 0x38-0x3f, MADI 0x30-0x37): dst 24-28, idx 22-23, src1 17-21, src2 10-16 (MAD: 7 bits; MADI 12-16, 5 bits),
  src3 5-9 (MADI 5-11, 7 bits), desc 0-4.
  Registers: 7-bit source 0x00-0x0f v (inputs), 0x10-0x1f r (temporaries), 0x20-0x7f c0-c95 (float uniforms); 5-bit
  source v / r only; destination 0x00-0x0f o (outputs), 0x10-0x1f r.
  Operand descriptor (DVLP table, 8 bytes each): mask 0-3 (x = bit 3), src1 negate 4, swizzle 5-12 (x in 11-12), src2
  negate 13, swizzle 14-21, src3 negate 22, swizzle 23-30.
"""
import struct, re

OPS1 = {0x00: 'add', 0x01: 'dp3', 0x02: 'dp4', 0x03: 'dph', 0x04: 'dst', 0x05: 'ex2', 0x06: 'lg2', 0x07: 'litp',
        0x08: 'mul', 0x09: 'sge', 0x0a: 'slt', 0x0b: 'flr', 0x0c: 'max', 0x0d: 'min', 0x0e: 'rcp', 0x0f: 'rsq',
        0x12: 'mova', 0x13: 'mov'}
ONE_SRC = {'ex2', 'lg2', 'litp', 'flr', 'rcp', 'rsq', 'mova', 'mov'}
OPS1I = {0x18: 'dphi', 0x19: 'dsti', 0x1a: 'sgei', 0x1b: 'slti'}
OPS2 = {0x24: 'call', 0x25: 'callc', 0x26: 'callu', 0x27: 'ifu', 0x28: 'ifc', 0x29: 'loop', 0x2c: 'jmpc', 0x2d: 'jmpu',
        0x2b: 'breakc'}
OPS0 = {0x20: 'break', 0x21: 'nop', 0x22: 'end', 0x23: 'end2', 0x2a: 'emit', 0x2b: 'breakc'}
CMPOP = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', '?6', '?7']
OUT_TYPES = {0: 'pos', 1: 'quat', 2: 'color', 3: 'tc0', 4: 'tc0w', 5: 'tc1', 6: 'tc2', 8: 'view', 9: 'dummy'}


def dvles(l):
    return [m.start() for m in re.finditer(b'DVLE', l)]


def _dvlp_for(l, e):
    o = max(m.start() for m in re.finditer(b'DVLB', l) if m.start() < e)
    n = struct.unpack_from('<I', l, o + 4)[0]
    return o + 8 + 4 * n


def _swz(bits):
    return ''.join('xyzw'[(bits >> s) & 3] for s in (6, 4, 2, 0))


def _mask(m):
    return ''.join(c for c, b in zip('xyzw', (8, 4, 2, 1)) if m & b)


def info(l, e):
    """the DVLE's tables: uniforms {reg: name}, outputs [(type, reg, mask)], constants, main, symbol names"""
    h = struct.unpack_from('<16I', l, e)
    uoff, ucnt, soff, ssz = h[12], h[13], h[14], h[15]
    syms = l[e + soff:e + soff + ssz]
    # the uniform table's register ids: 0x10-0x6f float c0-c95, 0x70-0x73 integer i0-i3, 0x78-0x87 bool b0-b15
    uni, bools, ints = {}, {}, {}
    for k in range(ucnt):
        so, rs, re_ = struct.unpack_from('<IHH', l, e + uoff + 8 * k)
        nm = syms[so:syms.find(bytes(1), so)].decode('latin1')
        for r in range(rs, re_ + 1):
            lab = nm + ('[%d]' % (r - rs) if re_ > rs else '')
            if 0x10 <= r < 0x70: uni[r - 0x10] = lab
            elif 0x70 <= r < 0x74: ints[r - 0x70] = lab
            elif 0x78 <= r < 0x88: bools[r - 0x78] = lab
    outs = []
    for k in range(h[11]):
        t, reg, m = struct.unpack_from('<HHI', l, e + h[10] + 8 * k)
        outs.append((OUT_TYPES.get(t, t), reg, _mask(m & 0xf) if m else ''))
    consts = []
    for k in range(h[7]):
        # 20 bytes: u16 type (0 bool, 1 int, 2 float24 vector), u16 register, four u32 values x, y, z, w
        typ, reg, x, y, z, w = struct.unpack_from('<HHIIII', l, e + h[6] + 20 * k)
        consts.append((typ, reg, x, y, z, w))
    return {'main': h[2], 'end': h[3], 'uniforms': uni, 'bools': bools, 'ints': ints, 'outputs': outs, 'consts': consts}


def _f24(w):
    # a float24 packed into the constant table (s1 e7 m16); bias 63
    if w == 0: return 0.0
    s = (w >> 23) & 1; ex = (w >> 16) & 0x7f; m = w & 0xffff
    if ex == 0: return 0.0
    v = (1 + m / 65536.0) * 2.0 ** (ex - 63)
    return -v if s else v


def listing(l, e, names=True):
    p = _dvlp_for(l, e)
    ver, coff, csz, doff, dcnt = struct.unpack_from('<5I', l, p + 4)
    code = struct.unpack_from('<%dI' % csz, l, p + coff)
    desc = [struct.unpack_from('<I', l, p + doff + 8 * k)[0] for k in range(dcnt)]
    I = info(l, e)
    uni = I['uniforms'] if names else {}
    # integer / bool constant registers in the DVLE are reported raw; float24 constants decoded
    cn = {}
    for typ, reg, a, b, c, d in I['consts']:
        if typ == 2:
            cn[reg] = 'const(%g,%g,%g,%g)' % tuple(_f24(x) for x in (b, c, d, a)) if False else 'cst%d' % reg

    def src(r, bits7, idx=0):
        if r < 0x10: s = 'v%d' % r
        elif r < 0x20: s = 'r%d' % (r - 0x10)
        else:
            c = r - 0x20
            s = uni.get(c, 'c%d' % c)
            if idx: s += '[%s]' % ['', 'a0.x', 'a0.y', 'aL'][idx]
        return s

    def dst(r):
        return ('o%d' % r) if r < 0x10 else ('r%d' % (r - 0x10))

    def opnd(r, neg, sw, idx=0):
        return ('-' if neg else '') + src(r, True, idx) + ('' if sw == 'xyzw' else '.' + sw)

    out = []
    for pc, w in enumerate(code):
        op = w >> 26
        txt = ''
        if op in OPS1:
            n = OPS1[op]; d = desc[w & 0x7f]
            dd, idx, s1, s2 = (w >> 21) & 0x1f, (w >> 19) & 3, (w >> 12) & 0x7f, (w >> 7) & 0x1f
            a = opnd(s1, (d >> 4) & 1, _swz((d >> 5) & 0xff), idx)
            b = opnd(s2, (d >> 13) & 1, _swz((d >> 14) & 0xff))
            txt = '%s %s.%s, %s' % (n, dst(dd), _mask(d & 0xf), a) + ('' if n in ONE_SRC else ', ' + b)
        elif op in OPS1I:
            n = OPS1I[op]; d = desc[w & 0x7f]
            dd, idx, s1, s2 = (w >> 21) & 0x1f, (w >> 19) & 3, (w >> 14) & 0x1f, (w >> 7) & 0x7f
            txt = '%s %s.%s, %s, %s' % (n, dst(dd), _mask(d & 0xf), opnd(s1, (d >> 4) & 1, _swz((d >> 5) & 0xff)),
                                        opnd(s2, (d >> 13) & 1, _swz((d >> 14) & 0xff), idx))
        elif (op >> 1) == 0x17:      # CMP
            d = desc[w & 0x7f]
            cx, cy, idx, s1, s2 = (w >> 24) & 7, (w >> 21) & 7, (w >> 19) & 3, (w >> 12) & 0x7f, (w >> 7) & 0x1f
            txt = 'cmp %s, %s, %s, %s' % (opnd(s1, (d >> 4) & 1, _swz((d >> 5) & 0xff), idx), CMPOP[cx], CMPOP[cy],
                                          opnd(s2, (d >> 13) & 1, _swz((d >> 14) & 0xff)))
        elif (op >> 3) in (6, 7):    # MADI (0x30-0x37) / MAD (0x38-0x3f)
            d = desc[w & 0x1f]
            dd, idx, s1 = (w >> 24) & 0x1f, (w >> 22) & 3, (w >> 17) & 0x1f
            if (op >> 3) == 7:
                s2, s3 = (w >> 10) & 0x7f, (w >> 5) & 0x1f; i2, i3 = idx, 0
            else:
                s2, s3 = (w >> 12) & 0x1f, (w >> 5) & 0x7f; i2, i3 = 0, idx
            txt = 'mad %s.%s, %s, %s, %s' % (dst(dd), _mask(d & 0xf), opnd(s1, (d >> 4) & 1, _swz((d >> 5) & 0xff)),
                                            opnd(s2, (d >> 13) & 1, _swz((d >> 14) & 0xff), i2),
                                            opnd(s3, (d >> 22) & 1, _swz((d >> 23) & 0xff), i3))
        elif op in OPS2:
            n = OPS2[op]
            dst_off, num = (w >> 10) & 0xfff, w & 0xff
            if n in ('callu', 'ifu', 'jmpu'):
                b = (w >> 22) & 0xf
                txt = '%s %s, -> %d (%d)' % (n, I['bools'].get(b, 'b%d' % b), dst_off, num) + (' not' if (n == 'jmpu' and (w & 1)) else '')
            elif n == 'loop':
                txt = 'loop i%d, -> %d' % ((w >> 22) & 3, dst_off)
            else:
                refx, refy, cop = (w >> 25) & 1, (w >> 24) & 1, (w >> 22) & 3
                cond = ['or', 'and', 'x', 'y'][cop]
                txt = '%s cc(%s rx=%d ry=%d) -> %d (%d)' % (n, cond, refx, refy, dst_off, num)
        elif op in OPS0:
            txt = OPS0[op]
        else:
            txt = '??? %08x' % w
        mark = ' <main' if pc == I['main'] else (' <end' if pc == I['end'] else '')
        out.append('%04d  %s%s' % (pc, txt, mark))
    hdr = ['outputs: ' + ', '.join('o%d=%s%s' % (r, t, ('.' + m) if m else '') for t, r, m in I['outputs']),
           'uniforms: ' + ', '.join('c%d=%s' % (r, n) for r, n in sorted(I['uniforms'].items())),
           'bools: ' + ', '.join('b%d=%s' % (r, n) for r, n in sorted(I['bools'].items())),
           'consts: ' + ', '.join('%s%d=(%s)' % ('bic'[t] if t < 3 else '?', r, ','.join('%g' % _f24(v) for v in (x, y, z, w)) if t == 2 else '%x %x %x %x' % (x, y, z, w)) for t, r, x, y, z, w in I['consts'])]
    return '\n'.join(hdr + out)


if __name__ == '__main__':
    import sys
    data = open(sys.argv[1], 'rb').read()
    for e in ([int(x, 16) for x in sys.argv[2:]] or dvles(data)):
        print('==== DVLE at 0x%x' % e)
        print(listing(data, e))
