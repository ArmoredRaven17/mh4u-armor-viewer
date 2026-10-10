r"""MH4U's executable, text and equipment tables, read the way the game reads them.

    python scripts/mh4u.py                  # summary per slot
    python scripts/mh4u.py head 1 2 3       # dump armour records

The equipment tables are the MH4U Collection Tracker's decode (its scripts/build_data.py, notes in
C:\MH4U-Extract\notes\weapons.md); this module reads the same records for the model side.

ARMOUR (item types 1-5 = chest, arms, waist, legs, head): 0x28-byte records at [0xf588d8 + 4 * type]
(READ 0x2f5724), count u32 [0xf3fc38 + 4 * type]; names: LMD <Slot>Name at the record index.
    +0 u16 male model  +2 u16 female model  +4 wearer bits (1 m, 2 f, 4 Blademaster, 8 Gunner)
    +5 rarity - 1  +6 flags (0xc0 = relic)  +0x13 dye index  ...
WEAPONS (item types 7-20): melee [0xf5884c + 4 * type] 0x18-byte records, gunner (11, 12, 16)
[0xf58884 + 4 * type] 0x28-byte records; +0 u16 = the model number (see build_weapons.py).
"""
import os, struct, sys

EXTRACT = r'C:\MH4U-Extract'
CODE = open(os.path.join(EXTRACT, 'exefs', 'code.decompressed.bin'), 'rb').read()
BASE = 0x100000          # .text 0x100000, .rodata 0xded000, .data 0xec0000; file offset = VA - BASE
MSG = os.path.join(EXTRACT, 'arcx', 'eng', 'data', 'core_common', 'eng', 'msg')


def word(va): return struct.unpack_from('<I', CODE, va - BASE)[0]
def half(va): return struct.unpack_from('<H', CODE, va - BASE)[0]
def raw(va, n): return CODE[va - BASE:va - BASE + n]
def s8(x): return x - 256 if x > 127 else x


def lmd_messages(name):
    """LMD (type 62440501) -> messages by the id the game asks for (the tracker's reader: message i
    -> its first op; op 1 = string pool index, 2 = inline tag, 22 = end)."""
    b = open(os.path.join(MSG, name + '_eng.62440501'), 'rb').read()
    assert b[:4] == b'lmd\0', name
    nmsg, nops, nstr = struct.unpack_from('<3I', b, 8)
    oops, ostr = struct.unpack_from('<2I', b, 0x18)
    pool = []
    for i in range(nstr):
        p, n, _ = struct.unpack_from('<3I', b, ostr + 12 * i)
        pool.append(b[p:p + 2 * n].decode('utf-16-le'))
    out = []
    for i in range(nmsg):
        k = struct.unpack_from('<IHH', b, 0x24 + 8 * i)[1]
        s = ''
        while k != 0xffff and k < nops:
            op, arg = struct.unpack_from('<2I', b, oops + 16 * k)
            if op == 22:
                break
            s += pool[arg] if op == 1 else ''
            k += 1
        out.append(s)
    return out


COUNTS = 0xf3fc38
ARMOR_TABLES, ARMOR_STRIDE, ARMOR_RELIC = 0xf588d8, 0x28, 0xc0
# the viewer's slot keys (the model file names, <g>_<slot>NNN) -> item type, name table
SLOTS = {'helm': (5, 'HeadName'), 'body': (1, 'BodyName'), 'arm': (2, 'ArmName'),
         'wst': (3, 'WaistName'), 'leg': (4, 'LegName')}


def armor_records(slot):
    t, msg = SLOTS[slot]
    names = lmd_messages(msg)
    n = word(COUNTS + 4 * t)
    tab = word(ARMOR_TABLES + 4 * t)
    out = []
    for i in range(n):
        r = raw(tab + ARMOR_STRIDE * i, ARMOR_STRIDE)
        m, f = struct.unpack_from('<HH', r, 0)
        out.append({'id': i, 'name': names[i] if i < len(names) else '', 'raw': r.hex(),
                    'model': {'m': m, 'f': f},
                    'wear': {'m': bool(r[4] & 1), 'f': bool(r[4] & 2), 'blade': bool(r[4] & 4),
                             'gunner': bool(r[4] & 8)},
                    'rarity': r[5] + 1, 'relic': bool(r[6] & ARMOR_RELIC), 'dye': r[0x13]})
    return out


if __name__ == '__main__':
    if len(sys.argv) > 2:
        recs = armor_records(sys.argv[1])
        for i in sys.argv[2:]:
            print(recs[int(i)])
        sys.exit()
    for s in SLOTS:
        recs = armor_records(s)
        for g in 'mf':
            ids = sorted({r['model'][g] for r in recs})
            print(s, g, len(recs), 'records,', len(ids), 'models, max', max(ids), 'first', ids[:12])
