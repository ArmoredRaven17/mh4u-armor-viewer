"""MH3U (LMT v66) rotation tracks of types 11/12/13, decoded as the game decodes them, patched into
the viewer's motion-list glbs.

mod_to_gltf's lmt_to_gltf emits only [reference, zero] for these tracks (27,341 of them library
wide), so after the first frame those bones fell to their raw local frames. Read from the 3U code:

  keyframe-type table 0xb3cb88 (12-byte records: key size, frame reader, decoder):
    type 11 -> 4-byte keys, decoder 0x87bba8 (XW)     type 12 -> 0x87bd7c (YW)     type 13 -> 0x87bf44 (ZW)
  a key (u32): bits 0-13 and 14-27 are SIGNED 14-bit (`sxth(key << 2)`, `asr((key << 4) & 0xFFFC0000, 16)`),
  each times 1/16384 after the x4 shift = signed14 / 4096; bits 28-31 = frames to the next key.
  XW: (f0, ref.y, ref.z, f1)   YW: (ref.x, f0, ref.z, f1)   ZW: (ref.x, ref.y, f0, f1), then normalised;
  `ref` is the track's float4 at +0x10. Between keys the decoder normalised-lerps, negating the second
  key when the dot product is negative.

LMT v66 layout (32-bit): 'LMT\\0', u16 66, u16 count, u32 offsets[count] (0 = empty slot); motion
0x40 bytes: u32 tracks, u32 trackCount, u32 frames, s32 loopFrame, ...; track 0x24 bytes: u8 type,
u8 usage (0 = local rotation), u8 jointType, u8 bone (gid), f32 weight, u32 bufSize, u32 bufOffset,
f32 ref[4], u32 bounds.

    python lmt_fix.py <mot.lmt> <motion index>     # print the decoded per-frame curve of each 11/12/13 track
"""
import struct
import numpy as np

KINDS = {11: 0, 12: 1, 13: 2}       # which component the first stored field replaces


def s14(v):
    v &= 0x3FFF
    return v - 0x4000 if v & 0x2000 else v


def motions(lmt):
    ver, cnt = struct.unpack_from('<HH', lmt, 4)
    assert lmt[:4] == b'LMT\0' and ver in (66, 67), (lmt[:4], ver)     # 66 = 3U, 67 = 4U
    out = {}
    for i in range(cnt):
        mo = struct.unpack_from('<I', lmt, 8 + 4 * i)[0]
        if not mo:
            continue
        to, n, frames, loop = struct.unpack_from('<IIIi', lmt, mo)
        tracks = []
        for k in range(n):
            o = to + 0x24 * k
            typ, usage, jt, bone = struct.unpack_from('<BBBB', lmt, o)
            size, off = struct.unpack_from('<II', lmt, o + 8)
            ref = struct.unpack_from('<4f', lmt, o + 16)
            tracks.append({'type': typ, 'usage': usage, 'bone': bone, 'size': size, 'off': off, 'ref': ref})
        out[i] = {'frames': frames, 'loop': loop, 'tracks': tracks}
    return out


def decode_keys(lmt, tr):
    """[(frame, quat xyzw)] for a type 11/12/13 track, exactly as the decoder builds each key."""
    ci = KINDS[tr['type']]
    ref = np.array(tr['ref'], float)
    keys, frame = [], 0
    for k in struct.unpack_from('<%dI' % (tr['size'] // 4), lmt, tr['off']):
        q = ref.copy()
        q[ci] = s14(k) / 4096.0
        q[3] = s14(k >> 14) / 4096.0
        keys.append((frame, q / np.linalg.norm(q)))
        frame += k >> 28
    return keys


def sample(keys, nframes):
    """One quaternion per frame 0..nframes-1: the decoder's normalised lerp between keys."""
    out = np.zeros((nframes, 4))
    for f in range(nframes):
        i = max(j for j in range(len(keys)) if keys[j][0] <= f) if f >= keys[0][0] else 0
        f0, q0 = keys[i]
        if i + 1 >= len(keys) or f == f0:
            q = q0
        else:
            f1, q1 = keys[i + 1]
            t = (f - f0) / float(f1 - f0) if f1 > f0 else 0.0
            if np.dot(q0, q1) < 0:
                q1 = -q1
            q = q0 * (1 - t) + q1 * t
        out[f] = q / np.linalg.norm(q)
    return out


if __name__ == '__main__':
    import sys
    lmt = open(sys.argv[1], 'rb').read()
    m = motions(lmt)[int(sys.argv[2])]
    print('frames', m['frames'], 'loop', m['loop'])
    for tr in m['tracks']:
        if tr['usage'] == 0 and tr['type'] in KINDS:
            keys = decode_keys(lmt, tr)
            print('bone %3d type %d keys %d first %s last %s ref %s' % (
                tr['bone'], tr['type'], len(keys), np.round(keys[0][1], 4), np.round(keys[-1][1], 4),
                np.round(tr['ref'], 4)))
