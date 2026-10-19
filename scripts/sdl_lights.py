"""MH4U scheduler (.sdl, type 4c0db839) files: print each object and its members' first key.

    python scripts/sdl_lights.py <file.4c0db839> [...]

A stage's light set lives in its "-f" scheduler (stage\\vNN\\vNNaNN\\sdl\\vNNaNN-f, path at 0x234208), the character
creation scene's in player\\char_make-f (core_title.arc; path at 0xb7ad90 / 0xbe0bb0). The objects are uLight-family
units (base01-InfiniteLight, base02-InfiniteLight, base01-HemiSphereLight, CameraLight, ...) and filters; the game
finds them by name (0x6c1080: StageDataSet, base01/base02-InfiniteLight, base01-HemiSphereLight, MhFilter, ColorFog).

Layout: 'SDL\\0', u16 version (0x15), u16 entry count, ..., u32 string table offset (+0x14); entries of 0x18 bytes from
+0x30: u8 kind, u8 member type, u16 is-member, u32 owner/flags, u32 name (string table), u32 class hash, u32 key
header offset, u32 value offset. Kind 2 is an object, 9/6/7/8/0xe/5 are its members (bool, int, vector, float, curve,
sub-object). Values are read at the value offset: a member here is a key list, and this prints the first key only.
"""
import struct, sys

FMT = {9: ('bool', '<I'), 6: ('int', '<I'), 7: ('vec', '<4f'), 8: ('float', '<f'), 0xe: ('curve', '<4f')}


def read(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'SDL\0', path
    n = struct.unpack_from('<H', d, 6)[0]
    st = struct.unpack_from('<I', d, 0x14)[0]

    def name(o):
        return d[st + o:d.index(b'\0', st + o)].decode('latin1')
    objs, cur = [], None
    for i in range(n):
        kind, typ, member, owner, nm, hsh, a, b = struct.unpack_from('<BBHIIIII', d, 0x30 + 0x18 * i)
        if kind in (2, 3):
            cur = (name(nm), '%08x' % hsh, []); objs.append(cur)
        elif member and cur and kind in FMT and b:
            label, f = FMT[kind]
            v = struct.unpack_from(f, d, b)
            cur[2].append((name(nm), v[0] if len(v) == 1 else tuple(round(x, 4) for x in v)))
    return objs


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print('==', p)
        for nm, h, mem in read(p):
            print('  %s (%s)' % (nm, h))
            for k, v in mem:
                print('     %-22s %s' % (k, v))
