"""THE GAME'S SKIN TONE STRIP: docs/ui/skin-strip.json, from MH4U's own texture (2026-10-19; Raven: "Skin Tone also uses a
color board that is restricted to natural skin tones").

    python scripts/build_skin_strip.py

THE TEXTURE (read): core_title.arc lyt\\demo\\texture\\demo_hadairo_BM_HQ_NOMIP ("hadairo", skin colour), 256 x 8, a strip
of skin tones from dark (x 0) to pale (x 188), then white and black; the character creation's layout lyt\\demo\\ui800
places it (panes ui800_l_hadairo / ui800_g_hadairo / ui800_b_g_hadairo; the layout table 0xefe120, index 0, used by the
character-creation UI at 0xc0f410 / 0xc1109c). The picker reads row 4 (the rows differ by one step at x 0 only).

THE RULE (READ from 4U's code, 2026-10-19; traced back from the stored colour):
  * the commit: the character-creation scene (0xb75acc, at 0xb75cb4 / 0xb75df4) hands the colour to 0xb09a8c, which
    stores it in the player data's skin word ([unit + 0xe30] + 0x44) and applies it (0xb09a9c -> 0xb0541c, type 2);
  * the colour is 0x5a1900(&rgba, page + 0x150): position p = the page's u16 +0x30; the strip pane (page +0x910 -> +8)
    gives width = scale x size (+0x20 x +0x28) and its texture rect; u = u0 + (p / width) x du, clamped to [0, 1]
    (constants 0x5a1a30 / 0x5a1a38 = 0, 1); v = v0 + 0.5 x dv (0x5a1a34); the texel is (trunc(texture width x u),
    trunc(texture height x v)), fetched by 0xd0d0ac;
  * the position: 0x22c404 mode 2 (the skin page, called with 2 at 0xb75dac) steps +0x30 by one, 0 .. 0xef: 240
    positions (mode 1 is the 2-D colour board, x 0 .. 0xae, y 0 .. 0x31);
  * the pane: ui800_sprite_002 in lyt\\demo\\ui800 (record 0x1ee8): size 240 x 44, scale 1 x 1, texture rect u 0 .. 189/256
    (0.738281), v 0 .. 1 -- the only rect in the layout spanning 189 texels, the strip's coloured extent;
  * so position p = texel (trunc(256 x (p / 240) x 189 / 256), 4), in float32 as the game computes it;
  * a new or reset character's skin is NOT a strip position: 0xc0eec0 writes the constant (233, 214, 204, 255) (the
    character creation's start, 0xb7ab14, and the page's Reset, 0x22c994); it lies between texels 184 and 185.
MHGU differs (184 positions, texel i + 2, default 183): its own picker, read there.
"""
import json, os, shutil, subprocess

EXTRACT = r'C:\MH4U-Extract'
TEX = os.path.join(EXTRACT, 'arcx', 'eng', 'data', 'core_title', 'lyt', 'demo', 'texture', 'demo_hadairo_BM_HQ_NOMIP.241f5deb')
TOOL = r'C:\MHGU-Extract\tools\reviltoolset\revil_toolset.exe'     # run read-only
WORK = os.path.join(EXTRACT, 'conv', 'gui')
POSITIONS, WIDTH, U1, ROW = 240, 240.0, 189 / 256, 4    # 0x22c404 mode 2; ui800_sprite_002


def main():
    from PIL import Image
    os.makedirs(WORK, exist_ok=True)
    dst = os.path.join(WORK, 'demo_hadairo.tex')
    shutil.copy2(TEX, dst)
    subprocess.run([TOOL, 'mtf_tex_to_dds', '--platform', 'N3DS', dst], cwd=os.path.dirname(TOOL), capture_output=True)
    im = Image.open(dst + '.dds').convert('RGB')
    assert im.size == (256, 8), im.size
    px = im.load()
    import numpy as np
    f32 = np.float32
    xs = []
    for p in range(POSITIONS):                        # 0x5a1900, in float32
        u = f32(0.0) + (f32(p) / f32(WIDTH)) * f32(U1)
        u = min(max(u, f32(0.0)), f32(1.0))
        xs.append(int(f32(256.0) * u))
    cols = [list(px[x, ROW]) for x in xs]
    out = {
        'source': 'core_title.arc lyt/demo/texture/demo_hadairo_BM_HQ_NOMIP (256 x 8; layout lyt/demo/ui800, ui800_sprite_002)',
        'rule': 'position p (0..239, 0x22c404 mode 2) = texel (trunc(256 * p / 240 * 189 / 256), 4) (0x5a1900); a new '
                'character is not a position: (233, 214, 204) (0xc0eec0)',
        'first': 0, 'colours': cols, 'texels': xs,
    }
    docs = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs')
    path = os.path.join(docs, 'ui', 'skin-strip.json')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, separators=(',', ':'))
    print(path, len(cols), 'first', cols[0], 'last', cols[-1], 'texels', xs[:6], '...', xs[-4:])


if __name__ == '__main__':
    main()
