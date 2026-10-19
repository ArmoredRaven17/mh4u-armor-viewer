"""MH4U's DEFAULT HUNTER COLOURS (CharMake's Reset colours), as the game computes them -- the source of adapter.js
CHAR_DEFAULTS.

    python scripts/char_defaults.py          # prints the JSON the adapter holds

THE COLOUR TABLE: 51 RGBA words filled at boot by the static initialiser 0xd33004 (run here, scripts/static_init.py)
from 0x10b5144; the getters index it from 0x10b5164 (entry 0 below).
THE GETTERS (read, decompiled) and the Reset that calls each with the player data's own bytes:
  skin      0xc0eec0: the constant (233, 214, 204, 255)                            Reset 0x22c994 -> +0x44
  hair      0xc0eea0(out, obj, 0): table[0x30 / 4] = entry 12                         Reset 0x22c958 -> +0x3c
  clothing  0xc0f258(out, obj, 0, type): table[0x44 / 4 + byte[0xe063f0 + type]]      Reset 0x22ca10 -> +0x40
            (type = player data +0x35, the clothing)
  Features  0xc10a78(out, obj, gender, feat): table[byte[0xe063e6 + byte[0xe064f8 + 13 gender + feat]]]
            (gender = +0x34, 0 male, 1 female; feat = +0x3a, 0 none)              Reset 0x22ca8c -> +0x48
The second argument 1 of 0xc0eea0 / 0xc0f258 (0xc0eebc / 0xe063e4) is the Palico's (the character creation's own
init, 0xb7ab14, reads both); this viewer has no Palico.
"""
import json, os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import static_init as S

INIT, TABLE = 0xd33004, 0x10b5164
CLOTH_IDX, FEAT_ROWS, FEAT_IDX = 0xe063f0, 0xe064f8, 0xe063e6
N_CLOTH, N_FEAT = 6, 13


def byte(a):
    return S.CODE[a - S.BASE]


def main():
    m = S.run(INIT)
    raw = bytes(m.uc.mem_read(TABLE, 0xc0))
    col = lambda i: list(raw[4 * i:4 * i + 3])
    out = {
        'skin': [233, 214, 204],
        'hair': col(0x30 // 4),
        'cloth': [col(0x44 // 4 + byte(CLOTH_IDX + t)) for t in range(N_CLOTH)],
        'feat': {g: [col(byte(FEAT_IDX + byte(FEAT_ROWS + 13 * gi + f))) for f in range(N_FEAT)]
                 for gi, g in enumerate(('m', 'f'))},
    }
    print(json.dumps(out))


if __name__ == '__main__':
    main()
