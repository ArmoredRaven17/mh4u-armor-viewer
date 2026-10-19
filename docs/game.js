// THIS VIEWER'S GAME, for the shared viewer base (docs/base; the plan: C:\\Coding Repos\\VIEWER-BASE-PLAN.md). Every value
// the base needs that differs between viewers lives here or in docs/adapter.js, never in a base file. A CLASSIC script,
// loaded before docs/base/ui/shell.js, so the theme and the saved view preferences apply before the first paint; the
// page's modules read the same object (window.VIEWER_GAME). The fields follow the GU Armor Viewer's game.js; a field
// this game has not got is left out or null, and every value below is the game's own read or says where it is not.
window.VIEWER_GAME = {
  id: 'mh4u',
  // every localStorage key the base writes is this prefix + '-' + a name: -theme, -stage, -ui, -tab, ...
  storagePrefix: 'mh4u-armor-viewer',
  // every side panel starts shut and locked until the hunter is drawn (app.js dispatches viewer-ready), as GU's
  panelsUntilReady: true,
  // THE THEMES: the MH apps family's palette, the hexes unchanged, named for MH4U monsters (white text clears every
  // swatch; see the shell's note before adding one). A name too long for a swatch is shortened, its full name in `icon`.
  themes: [
    { name: "Black Gravios", hex: "#570B0B" },
    { name: "Rathalos", hex: "#b51717" },
    { name: "Cephadrome", hex: "#783E0F" },
    { name: "Daimyo Hermitaur", hex: "#C7620E" },
    { name: "Desert Seltas", hex: "#74631D" },
    { name: "G. Rathian", hex: "#9C8328", icon: "Gold Rathian" },
    { name: "Seltas", hex: "#436713" },
    { name: "Genprey", hex: "#67922E" },
    { name: "Seltas Queen", hex: "#0B570F" },
    { name: "Rathian", hex: "#39993E" },
    { name: "Basarios", hex: "#14503d" },
    { name: "Blue Yian Kut-Ku", hex: "#279773" },
    { name: "A. Rathalos", hex: "#0C5D68", icon: "Azure Rathalos" },
    { name: "Tidal Najarala", hex: "#118898" },
    { name: "Velocidrome", hex: "#005984" },
    { name: "Gypceros", hex: "#0080c1" },
    { name: "Black Diablos", hex: "#0B2757" },
    { name: "Ash Kecha Wacha", hex: "#0b3f97" },
    { name: "Purple Gypceros", hex: "#1F0B57" },
    { name: "Great Jaggi", hex: "#4e2fa2" },
    { name: "Plum D. Hermitaur", hex: "#62008f", icon: "Plum Daimyo Hermitaur" },
    { name: "S. Nerscylla", hex: "#8e50ab", icon: "Shrouded Nerscylla" },
    { name: "P. Rathian", hex: "#D4358C", icon: "Pink Rathian" },
    { name: "Yian Kut-Ku", hex: "#C8679D" },
    { name: "Ruby Basarios", hex: "#5a411f" },
    { name: "D. Seltas Queen", hex: "#997c54", icon: "Desert Seltas Queen" },
    { name: "Kecha Wacha", hex: "#835A32" },
    { name: "Gravios", hex: "#B17A47" },
    { name: "S. Rathalos", hex: "#505358", icon: "Silver Rathalos" },
    { name: "White Monoblos", hex: "#7C879B" },
    { name: "Forbidden", hex: "#1E2025", icon: "Question Mark" },
  ],
  themeDefault: '#1E2025',             // Forbidden, the family default
  themeIcon: function (name) { return 'assets/MonsterIcons/MH4U-' + name.replace(/ /g, '_') + '_Icon.png'; },
  themeIconFallback: 'assets/MonsterIcons/MH4U-Question_Mark_Icon.png',
  // no pane tabs: the hunter alone (GU's second tab is its Palico), as the MH3U Armor Viewer
  paneTabs: [],
  // the joints the camera's aim takes (the depth of field's focus follow, the first-person face lock), by gid: 4 the head
  // (every helm model is skinned to it alone), 2 the chest (the bone a chest piece leans on most). Measured from the
  // models' own skin weights (f/m helm001, body001, body060), not read from the ROM.
  aimJoints: { head: 4, chest: 2 },
  // the head aim sits this far above the head joint (the skull's base): the default female face's middle, measured
  // (f_face000 bind pose: joint at y 0.509, face box centre 0.555), not read from the ROM
  aimHeadLift: 0.05,
  // the aim's cast recomputes the skinned meshes' bounds first (three keeps a skinned mesh's bounds from its first pose)
  aimRefreshSkinBounds: true,
  // Save / Save As / Open: the default file name and the file type the picker shows
  setFileName: 'mh4u-armor-set.json',
  setFileLabel: 'MH4U armor set',
  // THE CHARACTER COLOUR ROWS (docs/base/ui/colour-rows.js): Default, the game's named colours, RGB... MH4U names no
  // colours in these menus: CharMake's Skin Tone, Clothing Color, Hair Color and Feature Color pages (its page table
  // 0xdee3b8: pages 5, 4, 9, 11) show "(Touch the Reset button to reset to the default color.)" (CharMake 124, set by
  // 0x22d7e4 for exactly those pages) and offer no named list. What a pick samples and each page's default are NOT read.
  // CharMake 172-177 (White, Black, Red, Indigo, Yellow, Green) are not these menus' names: no CharMake page or code
  // path reaching them was found, and the one CharMake list of colours, Eye Color, has ten (below). So Default and RGB...
  // only. The player data holds each as RGBA: hair +0x3c, clothing +0x40, skin +0x44, Features +0x48, handed to
  // 0xb0541c(unit, rgba, type) as types 1, 3, 2 and 4 (the Features only while one is chosen, +0x3a).
  colourNames: [],
  // [select id, colour part] per row, and each row's own options (the game's colour board as its Custom choice, and
  // RGB..., since the save holds plain RGBA: Raven, 2026-10-18): set by app.js from armor.json colors once the data is in, as the MH3U Armor Viewer sets its own. The tint is
  // app.js's (ctx.applyColours: the colour types and the per-unit rules)
  colourParts: [],
  colourPartsPalico: [],
  // THE SKIN TONE'S STRIP (Raven, 2026-10-19: "Skin Tone also uses a color board that is restricted to natural skin
  // tones"): the character creation's own skin strip, core_title lyt/demo/texture/demo_hadairo, READ from 4U's code
  // (scripts/build_skin_strip.py): 240 positions (0x22c404 mode 2), position p sampling texel trunc(256 x p / 240 x
  // 189 / 256) of row 4 through the pane ui800_sprite_002 (0x5a1900); a new character's skin is not a position but
  // (233, 214, 204) (0xc0eec0). The board and RGB... stay (app.js adds them)
  // EVERY ROW'S Default is the game's own Reset colour (adapter.defaultColour; scripts/char_defaults.py): untinted is no
  // 4U choice (Raven's rule: Default gives the game's true default). The skin's is off the strip, so the strip marks no
  // position; the clothing's follows the clothing type, the Features' the gender and the Features chosen
  colourRows: { skin: { strip: 'ui/skin-strip.json', default: true }, hair: { default: true }, cloth: { default: true },
                feat: { default: true } },
  // no bare clothing choice: an empty Chest, Arms or Legs slot always draws the inner wear (0x2f4108)
  clothingNone: false,
  // no colour is carried in a material colour CHANNEL in this game: the Features are a colour type of their own (4)
  colourChannel: null,
  // THE MATERIALS' COLOUR TYPES (the app's, for its materials' tint class; the base does not read this): each material
  // carries a colour type (.mrl record +0x18 bits 23-30, materials.json `ct`, the same layout as MH3U's) that multiplies
  // its albedo map. 1 hair, 2 skin, 3 pigment (the armour's dye region AND the inner wear's, which takes the Clothing
  // Color), 4 the Features (Feature Color); 5 is on a few materials and not identified. A weapon's pigment is type 3.
  colourTypes: { 1: 'hair', 2: 'skin', 3: 'pigment', 4: 'feat' },
  // THE WEAPON PANEL'S CLASS ROWS (base/ui/weapon-panel.js), in panel order: what each class adds beside Class, Weapon,
  // Carry, Stance and the Attachment / Form row. The ids and labels are GU's; each row's effect is wired by id in
  // index.html. MH4U has none of GU's Hunter Arts, styles or skill-state rows, so the list is the Charge Blade's and the
  // Insect Glaive's. THE CHARGE BLADE (read 2026-10-18):
  //   Charge Gauge: player data +0x36c, a signed 0-100 shared with the Long Sword and Switch Axe (0xb33e9c adds a hit's
  // worth, scaled by skill; charging the phials takes 100). Its level (0xb43138): 1 from 30, 2 from 46, 3 from 72 -- GU's
  // thresholds. THE LOOK (0xb47f84, on every gauge change): the blade's animated colour-type-30 material (its `_add_`
  // layer, mesh group 24; picked at load by 0x2d6b98(blade, 30)) plays its own clip 1 from level 1 and clip 0 from level
  // 2 (0x2d6b1c) -- clips named 2ffb1360 / 059ea070, the same names as the shield's yellow / red files: a 120-frame loop
  // of colour (1, 0.7, 0) / (1, 0, 0) on member word 0x4980cc01, its fourth value pulsing 0.6 -> 0.1 -> 0.3 -> 0.6.
  // Level 3 also shows mesh part 3, the blade's `_emi_` mesh (part mask bit 3; cleared below 72). Below 30 the clip is
  // left as it was; a fresh blade has none.
  //   Shield Charge (Element Boost): a frame timer at [player +0xa29c] +0x60, phials x 1800 (30 s each), at most 18000
  // (0xcc5960). Every frame (0xcc25c4) it counts down and sets player data +0x36e: 3 while 1800 or more remain, 4 below
  // that, 0 at the end. On a change 0xcc2388 swaps the SHIELD's (weapon slot 1) colour-type 0 and 3 materials for the
  // game's glow material (0xb06ce0, mask 9: its LUTs, CBMaterialStd constants and auto-play clip; the shield keeps its
  // own maps): 3 -> weapon\common\gaxe_sld_power_up_red, 4 -> gaxe_sld_time_up_yellow (loc pl_base_0.arc). Each is a
  // 9-frame loop, keys 0 / 5 / 10, of two members: 0x49800c01 (0.45, 0.15, 0.15) -> red (1, 0.28, 0.2) / yellow (1, 0.76,
  // 0.2), and 0x4980cc01 (0.375, 0.125, 0.125) -> red (1, 0, 0) / yellow (1, 0.45, 0) -- GU's same files, which its decode
  // names fEmissionColor and fReflectiveColor. 0xcc38f4, every frame, gives the BLADE the same swap whenever its hold
  // state is not 2 (on the back). So yellow is 4U's "running out", the last 30 s.
  //   Phials: [player +0xa29c] +0x514, at most +0x515 (5; 6 with skill 0x79 or 0x115). The phial charge adds 3 (yellow
  // gauge) or 6 (red), capped (0xcc4878). NO PART CODE READS IT for the Charge Blade's parts (types 20 / 21; only the
  // Gunlance's and the bowguns' read +0x514): the model never shows the count. It sets the Shield Charge's length and
  // feeds the axe's bursts (one per discharge, 0xcc4f84), neither a resting look, so the row stays off (classes []).
  weaponRows: [
    { field: "cbGaugeField", kind: "select", input: "cbGauge", label: "Charge Gauge", title: "The Charge Blade's gauge (player data +0x36c, 0-100), filled by hits: level 1 from 30, 2 from 46, 3 from 72 (0xb43138); at 3 the blade's glowing mesh shows (0xb47f84). The glow is the game's own material animation", options: [["0", "Empty"], ["1", "Level 1"], ["2", "Level 2"], ["3", "Level 3"]], classes: ["w14"] },
    { field: "shieldChargeField", kind: "select", input: "shieldCharge", label: "Shield Charge", title: "Element Boost: phials x 30 s, at most 300 s ([player +0xa29c] +0x60). The shield, and the blade while it is not on the back, glow red, then yellow in the last 30 s (0xcc25c4, 0xcc2388). The glow is the game's own glow material", options: [["0", "Off"], ["1", "Charged (red)"], ["2", "Running out (yellow)"]], classes: ["w14"] },
    { field: "cbPhialsField", kind: "select", input: "cbPhials", label: "Phials", title: "The charged phials ([player +0xa29c] +0x514), up to 5, 6 with a skill (+0x515). The weapon model never shows the count", options: [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6 (skill)"]], classes: [] },
    { field: "kinsectField", kind: "select", input: "kinsect", label: "Kinsect", classes: ["w13"] },
  ],
  // THE HUNTER PANEL'S ROWS (base/ui/hunter-tab.js builds them; base/ui/hunter-panel.js and colour-rows.js wire them),
  // in panel order: GU's, with what MH4U's CharMake has in place of what it has not. MH4U has no face paint; its Features
  // (Type 1-12) sit where GU's Face Paint does, and the Feature Color where GU's paint colour does. The ids are GU's where
  // GU has the row (the Pose select is `pose`, as the base wires it); the Features rows are 4U's.
  //   EYE COLOR (CharMake page 7, message 13) is a CELL, not a tint: player data +0x39 offsets the UVs of the face's
  // colour-type-0 materials (the `_eye_` material) by (0.25 x (v & 3), -0.25 x (v >> 2)) -- 0xb08420 -> 0xb05ecc -- in a
  // 4 x 4 atlas whose cells 0-9 are drawn on both genders' eye maps (10-15 blank). A select, filled by the app (adapter
  // eyeOptions); the menu's own count and labels are not read, so it is Type 1-10 as the faces are.
  hunterRows: [
    { kind: 'select', input: 'genderSel', label: 'Gender', options: [['f', 'Female'], ['m', 'Male']] },
    // the Face / Hair / Body show-toggles are hidden and held on, as GU's are (Raven, 2026-10-18: "hide the Face, Hair, Body
    // toggles and keep them enabled at all times"); the labels are CharMake's own page names (CharMake 6-15)
    { kind: 'check', input: 'face', label: 'Face', checked: true, hidden: true, always: true },
    { kind: 'select', input: 'faceStyle', label: 'Face' },
    { kind: 'select', input: 'features', label: 'Features', title: 'The face parts the game draws over the face, 200-211 (0xb08778). In game they are Type 1 to Type 12' },
    { kind: 'colour', input: 'featColor', label: 'Feature Color', title: "The Features' own colour (colour type 4)" },
    { kind: 'select', input: 'eyeColor', label: 'Eye Color', title: "A cell of the eyes' own map (player data +0x39): the game moves the eye material's UVs, it does not tint" },
    { kind: 'check', input: 'hair', label: 'Hair', checked: true, hidden: true, always: true },
    { kind: 'select', input: 'hairStyle', label: 'Hairstyle' },
    { kind: 'colour', input: 'hairColor', label: 'Hair Color' },
    { kind: 'check', input: 'body', label: 'Body', checked: true, hidden: true, always: true },
    { kind: 'colour', input: 'skinColor', label: 'Skin Tone' },
    { kind: 'select', input: 'clothing', label: 'Clothing', title: 'The inner wear an empty Chest, Arms or Legs slot draws (0x2f4108)' },
    { kind: 'colour', input: 'clothColor', label: 'Clothing Color', title: "The inner wear's colour: its dye region (colour type 3) under an empty Chest, Arms or Legs" },
    { kind: 'select', input: 'pose', label: 'Pose', options: [['', 'Bind Pose']] },
  ],
  // what Hunter Slots' New makes (its tooltip)
  hunterNewTitle: 'A new hunter: no armor, the first face, hair and clothing, every Hunter option on its default',
  // GUILD INFO (base/ui/hunter-tab.js builds the panel, base/ui/guild-panel.js runs it, base/render/plate.js draws the
  // name plate): the game's own data. Raven, 2026-10-18: "Which will need to look into each game's guild card titles,
  // the colors for HR ranges". The title words are read; the rest is NOT read yet and left unset (no rank colours, no
  // weapon glyph, the base's font): hrBands, icons / iconCell / iconCells, font.
  guildInfo: {
    // the Guild Card's title words and connectors, each word with its unlock text, in the title menu's order
    // (scripts/build_guild_titles.py: GuildCard_eng messages 743-1668 / 1670-1769, the requirement chooser 0xa53204, the
    // menu order table 0xeda8d0)
    titles: 'guild-card-titles.json?v=20261018',
    // the title menu's entries to a page: 0xa52d0c turns a position into page = index >> 3 and row = index & 7
    titlePage: 8,
  },
  // PIGMENT (docs/base/ui/pigment.js): the five armour slots. Every worn piece takes a pigment (the item box's "Change your
  // armor color"); an empty Chest, Arms or Legs shows the clothing, whose dye region (colour type 3, the inner wear's own)
  // takes the Clothing Color -- a character colour picked on CharMake's board, so a Hunter panel colour row, as 3U's
  // (docs/adapter.js dyeable), not a pigment row
  pigmentSlotLabels: { helm: 'Head', body: 'Chest', arm: 'Arms', wst: 'Waist', leg: 'Legs' },
  pigmentCloth: false,
  pigmentPalico: false,
  // the game's colour board, at the bottom of the Pigment modal's first tab (lyt\lobby\texture\lby_colorscale, 256 x 64,
  // inside its black frame)
  pigmentBoard: { image: 'boards/mh4u-colorscale.png', region: [1, 1, 176, 51] },
  // THE ARMOUR RAINBOW, read from the game's code: an equipment entry's +0x12 mode bits 0x8000 (written 0x2f78c8, read
  // 0x2f1618) take the colour pick 0xb0a2c0, which blends colour (t >> 4) & 7 of the eight at 0xb097f8 into the next by
  // (t & 15) / 16 and hands it to 0xb0541c(player, rgba, 3). t is the player's u32 at +0x54, advanced by the frame delta
  // (1/60 s units) each frame and reset past 1e7: one timer, so every Rainbow piece shows the same colour at once. The
  // same table and blend as GU's. Offered always: what unlocks it in game is not read.
  pigmentRainbow: { name: 'Rainbow', unitsPerColour: 16, unitsPerSecond: 60,
    table: [[227, 126, 237], [193, 159, 255], [154, 204, 241], [121, 229, 133], [189, 243, 102], [245, 236, 99],
            [240, 141, 92], [232, 120, 161]] },
  // no Deviant pigments in MH4U: the modal has one tab
  pigmentDeviants: false,
};
