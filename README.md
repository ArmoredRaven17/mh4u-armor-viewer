# MH4U Armor Viewer

A fan-made 3D viewer for Monster Hunter 4 Ultimate (3DS) armour. Pick a piece for each slot, on
either gender, with the hunter's face, hair, clothing, features and colours, in the game's own
motions.

A port of the MH3U Armor Viewer, meant as the base for a fuller app along the lines of the MHGU
Armor Viewer. Live at https://armoredraven17.github.io/mh4u-armor-viewer/.

## What it does

- Every armour piece in the game (4,734 records over the five slots), both genders, mixed freely
  across sets, with the game's own names; Blademaster / Gunner filter from the game's own wearer
  flags. Relic armour templates are included
- The clothing (inner wear, six types) the game draws under an empty chest, arms or legs slot
- Faces (16) and hairstyles (28), with the hair and face parts each helm leaves visible, per
  hairstyle, from the game's own table; Features (Type 1-12), hidden by the helms that hide them
- Colours: each piece's own default pigment from the game's 70-colour table; Custom pigment, skin,
  hair, clothing and feature colours picked from the game's own colour board
- Every weapon in the game's tables (2,743 over the 14 classes), with the game's own names and
  pigment, hung on the hunter where the game hangs it, sheathed or drawn (the game's own mount, read
  from the executable): shields and the Kinsect on the forearm, the Long Sword in its scabbard, the
  Bow's arrows, the Charge Blade's shield on the arm in sword mode. Insect Glaives take any Kinsect
  (35, on 29 models); the glaives that bring their own show it. As in the MHGU viewer, the
  Hunter panel's Pose picks the hunter's own animation (field, lobby, character creation, Guild Card,
  Arena), the Weapon panel's Stance the class's own motions, played while the weapon is drawn, and the
  Animation panel scrubs, steps, plays / pauses and loops whichever is playing (the weapon follows)
- Weapon stances: on every clip of the class's list the weapon follows the game's own per-frame
  placement -- a draw takes it off the back and into the hand mid-clip, a sheathe puts it back -- and
  plays its own motions on its own joints: the Bow unfolds, the Switch Axe and Charge Blade morph,
  the Long Sword's blade hides in the scabbard -- and shows the mesh parts the game's part mask
  leaves on (the Charge Blade's sword drops its axe housing in sword mode). Read by running the
  game's own weapon update for every frame of every clip in an emulator, per group of models the
  game treats differently. Weapons that fold unfold when drawn (the game's drawn flag). Each Switch
  Axe and Charge Blade clip plays in the form its action declares, read from the game's action code
  (no mode control: the clip decides, as in the MHGU viewer). The Gunlance's heat vent opens on the
  frame Wyvern's Fire fires
- The hunter's motion lists, clip by clip: field and lobby common motions, character creation,
  Guild Card, Arena, and each weapon class's own list
- Hunter slots, and the MHGU viewers' Lighting, Camera and Effects panels

**Lighting is generic three.js lighting, not the game's.** MH4U's shading is not decoded.

## Not done yet

- **Stances, what is left.** Switch Axe / Charge Blade clips that no action declares (the base
  player's idles, runs, steps, hit reactions; 33 of each) take the MHGU viewer's table for the
  Switch Axe (it agrees with every 4U declaration) and otherwise the form sheathing leaves (axe /
  sword); in the game they carry the previous action's form. No state carries from clip to clip: the
  Gunlance's vent stays open only through the Wyvern's Fire clip, and its folding back (a 5-frame
  snap with a sound when the cooldown ends) is not played. The common and lobby motions' own weapon
  handling (the weapon is shown in its sheathed look there) and the lobby weapon lists (wgNN_LB) are
  not played. No Kinsect motion list was found on the cart; the Kinsect perches unanimated. The hold
  state comes from the motion's group-0 events through 4U's own reader (the player's virtual
  +0xa0), which reads two event-id slots whose writer is not traced -- they are taken to be the
  clip's group-0 ids. Joint 0's tracks are applied while a part is held and
  not at rest -- judged by eye (the sheathed Charge Blade sword), 4U's own rule is not read
- The game's own colour presets and starting colours for Skin Tone, Hair, Clothing and Feature
  Color, and how those menus sample the board; the colour loop that hands each colour type to a
  unit (the MH3U Armor Viewer's rules are used); colour type 5, a layer on the female faces, is drawn untinted

## Running it

No build step for the page. Serve `docs/` with any static file server:

    python dev/serve.py 5596

## Contents

    docs/index.html       the app: markup, styles and logic
    docs/armor.json       the game's armour tables, every player model, the clothing drawn under an
                          empty slot, per helm the hair and face parts it leaves, the colours and the
                          motion lists; `_about` says where each comes from
    docs/materials.json   each material's base texture, blend state and colour type
    docs/models/<g>/      armour, clothing, face and hair meshes (.glb)
    docs/models/weapons/  every weapon model and Kinsect (.glb)
    docs/weapons.json     the game's weapon tables: classes and their parts, every weapon's name, model
                          and pigment, the Kinsects, the pigment colours
    docs/mount.json       how the game hangs each weapon part on the hunter, sheathed and drawn
    docs/stances/wNN.json per class, model group and clip: each part's placement and weapon motions on
                          every frame (segments), and the sheathed look
    docs/poses/weapons/   each class's own weapon motions (wgNN), tracked channels only
    docs/poses/<g>/       the motion lists, animations only
    docs/tex/             textures, deduplicated by content hash
    docs/ui/colorscale.png  the game's own colour board
    docs/render/          the render core, copied from the MH3U Armor Viewer

## Where the data comes from

The scripts read an unpacked cart image in `C:\MH4U-Extract` (romfs, `exefs\code.decompressed.bin`,
the English text under `arcx\`); RevilToolset does the model, texture and motion conversion:

    scripts/convert_models.py  every player and weapon model and every texture they bind, staged from
                               the cart's archives and converted, each model checked against its source
    scripts/mh4u.py            the executable, the LMD text and the equipment tables
    scripts/build_poses.py     the motion lists onto each gender's skeleton
    scripts/build_armor.py     the armour, the hunter, materials.json and armor.json
    scripts/build_weapons.py   the weapon models, weapons.json and mount.json
    scripts/weapon_state.py    runs the game's per-part weapon update (0x34c5d8) in an emulator on stand-in
                               objects: placement, carry state and the weapon motions it samples
    scripts/build_stances.py   every class's stances (docs/stances) and weapon motions (docs/poses/weapons)
    scripts/joint_coverage.py  the weapon joints no requested weapon motion moves, per class (the work list)
    scripts/action_modes.py    the form each Switch Axe / Charge Blade action declares, by its motion
    scripts/static_init.py     runs one of the game's static initialisers in an emulator (unicorn): the
                               weapon placement tables are filled at boot
    scripts/mrl.py, lmt_fix.py, reduce_keys.py, mtlib.py   the MH3U viewers' helpers (4U keeps the formats)

Run them in that order. Neither the extract nor the game's files are part of this repository.

### Decode notes (READ = the consuming code was read)

| what | where |
|---|---|
| armour records | `[0xf588d8 + 4 * type]`, 0x28 bytes (the MH4U Collection Tracker's decode); +0 / +2 male / female model, +4 wearer bits, +0x13 pigment |
| model for a slot | READ `0x2f4108(mgr, item, gender, inner)`: the record's model; 0 on a chest / arms / legs falls back to u16 `0xf3fc8c` / `0xf3fc98` / `0xf3fca4` [inner] = 60, 61, 62, 63, 70, 71 |
| model path | READ `0xaf7c58`: `player\mod\<f|m>\` + `pl%03d\` (or `%s%03d\` for hair / face) + `<g>_<slot>%03d`; slot names at `0xe06980`: body arm wst leg helm hair face; id bit 0x8000 cleared |
| character | READ `0xaf9080`: char +0 gender, +1 face, +3 hair, +4 inner wear, +0x32 weapon, +0x4e + 0x1c * n the armour |
| hair / face under a helm | READ `0xb0ad80`: u32 `[0x100ca20 m / 0x100d33c f + 4 * helm model]`; bit 0x8000 picks row `v & 0x7fff` of `0x100dc58` (28 u32 per row, one per hairstyle); low half = hair parts 0-9, high half = face parts 0-6 |
| Features | READ `0xb08778`: face parts 200-211; shows 200 + (char +0x3a) - 1 when face bit 5 is set, else none |
| pigment | READ `0x2f854c`: armour RGB `0xf57750 + 3 * rec[0x13]` (70); melee `0xf57822 + 3 * rec[0x12]`; gunner `0xf5784f + 3 * rec[0x1b]` |
| colour types | `.mrl` record word +0x18 bits 23-30 (the same layout as MH3U): 1 hair, 2 skin, 3 pigment (armour and inner wear), 4 Features, 5 female face layer |
| colour board | `lyt\lobby\texture\lby_colorscale` (core_title.arc), 256 x 64, the board inside a black frame at x 1-176, y 1-51 -- that the menus sample it is not read |
| weapon tables | the tracker's: melee `[0xf5884c + 4 * type]` 0x18 bytes, gunner `[0xf58884 + 4 * type]` 0x28; record +0 u16 = model (all but one on the cart); class = byte `[0xf5f2fc + type]` (READ `0x2f13b4`) = the wNN numbering |
| weapon parts | `[0xfb8984 + 4 * class]`: two; one, sld; ham; lan, sld; hbg; lbg; ken, saya; axe; gun, sld; bow, ya; sou_l, sou_r; hue; rod, mus; blade, sld |
| Kinsects | READ `0x2f52a8`: model = u16 `[0xf58a02 + 14 * kinsect]`; glaives 0x26 / 0x86 force model 1, 0x85 model 32 |
| part type | READ `0x3506d8(callback, class, part)`: GS 0; SnS 1, shield 2; Hammer 3; Lance 4, shield 10; bowguns 5; LS 8, scabbard 18; SA 9; GL 11, shield 16; Bow 12, arrows 19; DB 13, 14; HH 15; IG 17, Kinsect 22; CB 20, shield 21 |
| weapon mount | READ `0x34c5d8` per part per frame: state (sheathed flag = player data +0x30 -> 2; drawn = `0x350438`, default 1, DB's second blade 0; shields / Kinsect 4; scabbard / arrows 2; CB shield drawn 4), bone by state (0 -> 12, 1 -> 8, 4 -> 11, rest -> 1 / 2 by type, the arrows 0), scale (rest: 0.7-1.0 by class), record via `0x3553b8`: 0x18-byte {pos, rot} records in tables filled by the static initialiser `0xd4518c` (`0x109f6a0` states 0/4, `0x109f8c8` 1, `0x109faf0` 2, `0x109fd18` 3; bowguns `0x109ff40` / `0x109ff70`, LBG second by `0xb0925c`). Mount joint 0, 4 for the scabbard (its only joint) and the matrix order (ZYX degrees, cm) are MH3U's -- the shared types carry 3U's own numbers |
| stances | the per-part update `0x34c5d8` takes the hold state from the player's virtual `+0xa0` on its default path (`0x350438`) -- READ `0xb3e4a4`: the ids in `[player +0xa29c] +0x97c / +0x97e`, in order 1 -> 0, 2 -> 2 (back), 3 -> 1, 4-7 -> 5-8, 8 -> 10; none: drawn -> 1 (the Charge Blade's axe form -> 9), sheathed -> 2 -- tests the motion's frame (`0xb0b0b0` -> `0xb064d4`, player `+0x284`), and the per-type joint code (`0x34eac4` drawn / `0x35243c` sheathed, frame player `+0x290`) samples the weapon's own motions through `0x351798(callback, motion, slot, frame)`; slot = the part whose joints it drives. The weapon motion list is the callback's `+0x27c`, loaded from `0xef9100` (`weapon\<dir>\mot\wgNN`; lobby `0xef9140`). Per-model tables are read with the callback's `+0x264` = the weapon model (the Switch Axe: `0xdf8251` / `0xdf82b9` -> 42-byte blocks at `0xdf80d7`). Motion id = bank << 8 \| index; banks 0-4 = co_0, co_1, co_2, -, co_4 in the field, 5 = the class's wNN (list table `0xef50e0`). Joint 0's tracks compose on the mount while a part is held (not at rest). The part mask: the slot's weapon model at player data `+0x5bf8 + 0x10f8 * slot`, `+0x108` (one bit per mesh part; the Charge Blade's sword mode clears 2 and 4). At rest in the field the weapon goes through the DRAWN joint code with the drawn flag off and the hold on the back (the field idle's id 2) -- the Gunlance folded, its motion 0; the sheathed path (`0x35243c`, player data `+0x30`) is the town's, where it rests unfolded. The drawn flag: player data `+0x6f9` (`0xb07e58` tests it == 1), set by every class's draw actions through the player's virtual `+0xc8` (`0xb29f20`); with it, and the hold state not 2, the joint code unfolds a folding weapon (`+0x267`). The FORM (Switch Axe, Charge Blade): `[player +0xa29c] +0`, 1 = sword, read back by the class's "is sword mode" query, the player's virtual `+0xac` (`0xcab958` / `0xcc249c`); sheathing leaves the Switch Axe in axe (`0xcab934`) and the Charge Blade in sword (`0xcc2478`). Each action start writes it: the class's dispatcher (a jump table on player data `+0x372`; the Switch Axe `0xcaba38`, 75 actions; the Charge Blade `0xcc2a00`, 78) tail-calls a start with a sub-index, which at phase 0 (player data `+5`) writes the form and sets its motion (`0xb0c038` / `0xb0c148` / `0xb08864`, or a 32-byte descriptor of two moves through `0xb23b70`) -- `scripts/action_modes.py` runs every start and later phase in the emulator. The Switch Axe's 41 declarations all agree with the MHGU viewer's MODES table. Weapon motions on their OWN clock: `0x3541c0(callback, motion, timer*, slot)` waits while the timer is below 0, then samples at it and advances it by the frame delta (`[0x105718c] +0x5c`), wrapping to the loop start or holding the last frame. The Gunlance's joint 2 (`0x34d690`, per-model 16-byte blocks via `0xdf8431`): while the Wyvern's Fire cooldown runs (`[player +0xa29c] +0x5c`; 7200 frames, 5400 / 4800 with Artillery, `0xcb1b98`) it plays its motion on the callback's `+0x274` and holds it open; when it ends, `0x2fcc34(2, 9)` and the motion runs from frame 5 back to 0. The Hunting Horn's recital (Motions 108-110) plays its block's first motion on `+0x26c` (`0x34fae0`). Weapon motion lists open many motions with a TAG track whose bone byte is not a joint; one that repeats a real (joint, property) is disowned before conversion (`untag`). Static initialisers: `0xebee78`-`0xebfd5c` (954) |
| motion lists | names at `0xe8aba8`; LMT v67, converted by RevilToolset as it is (rotation key types 11/12/13 included -- the MH3U viewers' re-decode does not apply) |

## Credits

The render core and the build helpers are the MH3U Armor Viewer's; the theme icons and the
equipment table decode come from the MH4U Collection Tracker. See NOTICE.md.
