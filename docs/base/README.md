# The shared viewer base

One base for the Armor and Monster Viewers (GU, 3U, 4U; MHFU and 3U HD later). The plan is
`C:\Coding Repos\VIEWER-BASE-PLAN.md`, approved by Raven on 2026-10-18.

The GU Armor Viewer (`C:\Coding Repos\mhgu-armor-viewer`) is UPSTREAM for every file here. A consumer copies the folder
with `python dev/sync-base.py --pull --source "<upstream>/docs/base"` and keeps it honest with `--check`. A fix is made
upstream and pulled, never made in a copy. `SOURCE.json` records the upstream commit and every file's sha256 (LF).

No file here names a game, an em id or a storage key, except in comments. `palettes.json` and its `boards/` are the one
exception: they are the combined picker's data, a tab per game.

## What a viewer supplies

- **`docs/game.js`** is a CLASSIC script that sets `window.VIEWER_GAME`. The page loads it before `base/ui/shell.js`,
  so the theme and the view preferences apply before the first paint. Its fields:
  - `storagePrefix`: every key the base writes is the prefix plus a name (`-theme`, `-stage`, `-ui`, `-tab`, `-capture`);
  - `themes`, `themeDefault`, `themeIcon(name)`, `themeIconFallback`;
  - `paneTabs` (`[tab id, pane id]`, the first the default) and `aimJoints` (`{ head, chest }` gids);
  - `setFileName`, `setFileLabel`;
  - `colourNames` (`[name, '#rrggbb' or null]`), `colourParts` / `colourPartsPalico` (`[select id, part, { names?, off? }?]`:
    a row's own name list -- a choice held as its index in it -- and an Off choice) and `colourRows` (per part: `board`
    `{ image, region, label? }`, `rgb: false`, `default: true` -> the app's `ctx.defaultColour(part)`, `untinted: label`;
    `ctx.applyColours(charColor, t)` replaces the built-in tint when the app gives one), and
    `colourChannel` (`{ channel, part }`: the part a material colour channel takes);
  - `pigmentSlotLabels`, `pigmentCloth`, `pigmentPalico`, `pigmentBoard` (`{ image, region }`: the game's colour board, at
    the bottom of the selector's first tab: `boards/...` is the base's copy, any other path the APP's own image under its
    docs/ -- e.g. the MH3U Armor Viewer HD's Wii U board -- which `sync-base.py` never touches), `pigmentRainbow` (`{ name, table: [[r,g,b]...],
    unitsPerColour, unitsPerSecond }`, only where the game's code is read: 4U), `pigmentDeviants` + `pigmentTabLabels`
    (GU: the Deviant pigments as tab two);
  - `clothingNone` (false: no bare Clothing choice), `weaponHint` (the Weapon panel's note; none: no note),
    `aimHeadLift` (the head aim above the joint; GU 0.1), `aimRefreshSkinBounds` (recompute skinned bounds before the
    aim casts; opt-in);
  - board `region`s are INCLUSIVE `[x0, y0, x1, y1]` (x1 / y1 the board's last column / row);
  - `weaponRows` (`[{ field, kind: 'check' | 'select' | 'box', input, label, title?, options?, after?, classes }]`): the
    Weapon panel's class rows in panel order, each shown for its weapon classes; a game lists only the rows it has (3U:
    no Charge Blade class, so no Charge Blade rows). Class, Weapon, Carry, Stance and the Attachment / Form row are the
    panel's own markup in every app;
  - Hunter rows, 2026-10-18 (Raven): a check row may be `hidden` and `always` (held on: GU's Face / Hair / Body -- "hide
    the Face, Hair, Body toggles and keep them enabled at all times"); every select carries a label ("add text labels to
    indicate what the drop down is for"; the game's own menu words where it has them); the Clothing Color row has no tick
    ("it should be pigmented like armors") and, as every colour row, shows its CURRENT colour ("Instead we would want to
    display the current color");
  - `hunterRows` (`[{ kind: 'select' | 'check' | 'colour' | 'box' | 'strip', input / id, label?, title?, options?, checked? }]`;
    a `strip` row also takes `min, max, step?, default?, chip?` -- a range over the game's colour strip, painted from the
    app's `ctx.strip(id)` and reported to `ctx.onStrip(id, value)` by `hunter-panel.js`; `setStrip(id, value)` restores; with
    `rgb: true` an RGB... picker sets any colour, the value then '#rrggbb' instead of an index): the
    Hunter panel's rows in panel order (GU: Gender, Face, Face Paint, the colour rows, Hair, Body, Skin Tone, Clothing,
    Clothing Color, Pose, the skill switches); `hunterNewTitle`: the Hunter Slots New button's tooltip.
  - `guildInfo` (`{ hrBands: [{ hr, max, color, label }], titles: url | null, titlePage, icons, iconCell, iconCells, font }`):
    the Guild Info panel and its name plate -- the game's Hunter Rank bands and colours, its Guild Card title words (null:
    no title rows, no Unlock Requirements modal), the title menu's page size, the weapon glyph strip and the font. Each
    game's own read (Raven, 2026-10-18: "each game's guild card titles, the colors for HR ranges").
    Without `hrBands` (unread) there is NO plate: no plate toggle, Name, Hunter Rank or Shows rows and no sprite -- never a
    stand-in colour, font or glyph; the title rows, the modal and the saved title words stay (MH3U, Phase 1.3).
- **The Hunter tab** (Raven, 2026-10-18: "ensure the Hunter tabs are more consistent"): `base/ui/hunter-tab.js`, a CLASSIC
  script loaded after `game.js` and BEFORE `base/ui/shell.js` (which wires the accordion), replaces
  `<div id="hunterTab"></div>` with Hunter Slots, Armor Pieces, Pigment, Weapon, Hunter and Guild Info (and the titles modal) -- GU's names, order and
  markup in every app, filled from `weaponRows`, `hunterRows` and `guildInfo`. The shared Animation, Lighting, Camera and
  Effects panels follow.
- **`docs/adapter.js`** maps the viewer's own data files onto what the base asks for (`setApp(appObjects)`, then e.g.
  `defaultPigHex(slot)`, `dyeable(slot)`, `armorOptions(slot, type)`, `armorSpecials(slot)`, `legacyModel(slot, v)`,
  `charStyles(part)`, `paintCount()`, `clothingOptions()`, `poseOptions()`). `setApp` runs at the top of the page:
  its getters are lazy, and the panels ask the adapter during the boot.
- **The markup.** The modules wire controls by id. GU's `index.html` is the reference for each panel's ids, and each
  module's header names the ones it uses.

`dev/sync-base.py` normalises line endings in TEXT files only (.js .css .md .json .py .html .txt .svg); every other file
(the board PNGs) is hashed and copied as raw bytes. WHEN THE TOOL ITSELF CHANGES, copy the new `dev/sync-base.py` in
by hand before `--pull`: an older tool hashes by its own rules and refuses the files (the MH3U agent met this with the
binary fix, 2026-10-18). A stance entry may carry `stance: true` (a weapon stance wherever its
file lives).

## render/ (ES modules)

stage, assets (`setNoMipmap(files)` hook), skeleton, material (`romLinear`, `setChannelColor`), materials-db, pose, fx,
lens, grid, colour-space, rom/specular, plate (the Guild Info name plate; `hrColor(bands, hr)`).

## ui/

`shell.js` is a classic script. The rest are ES modules, each `createX(game, ctx)` returning its panel object. `ctx`
holds the app's objects as lazy getters, so a factory can be called before those objects exist.

| module | factory | ctx (the app's objects) |
|---|---|---|
| shell.js | (runs on load) | About / Links modals, view preferences, pane tabs, theme engine, wheel-steps-a-dropdown, accordion |
| effects-panel.js | createEffectsPanel | fx(), focusLive(), onChange() |
| lighting-panel.js | createLightingPanel | stage, scene, camera(), onChange() |
| camera-panel.js | createCameraPanel | camera, controls, renderer, viewport, world, head, pose, figure, figureBounds, activeMounts, fitPlanes, fitRenderer, fx, fxPanel, playerBone, paintSpin, restoring, saveState, setIcon, setLabel, SCENE |
| camera-bar.js | createCameraBar | controls, floorGrid, camPanel, fxPanel, the camera panel's functions, saveState, setLabel, SCENE |
| capture.js | createCapture | camera, renderer, renderFrame, fx, head, camPanel, lightPanel, captureName(ext), setIcon, setLabel |
| animation-panel.js | createAnimationPanel | pose, SAVED, saveState, buildPoseList, and the weapon-stance hooks (weapon, weaponClassSel, applyWeaponState, the weapon selects) |
| save-open.js | createSaveOpen | currentSet(), isSet(d), applySet(d): the schema is the app's |
| pigment.js | createPigment | pigmentSections() (every in-game pigment list, [{ label, colours: [{ hex, name }] }] in the game's order; or pigmentColours() for one list), SLOTS, PIGMENTS, DEVIANTS, PALETTES, deviant, deviantMix, slotPigment, rgb255, saveState, defaultPigHex(slot), dyeable(slot), stepRegion(t) |
| colour-rows.js | createColourRows | scene, saveState |
| armor-panel.js | createArmorPanel | SAVED, SLOTS, gender, saveState, selectToken, setSlot, armorOptions, armorSpecials, legacyModel, onPieceChange(slot) |
| hunter-panel.js | createHunterPanel | charStyles, paintCount, clothingOptions, clothingDefault, poseOptions, facePaint (get/set), gender, saveState, setGender, refreshChar, applyFacePaint, setBody, setClothing, onPoseChange |
| (pigment.js) openCharacter(label, hex, onPick, onDefault) | | (Raven, 2026-10-18: "There is no need for a drop down to select Default or RGB") a hunter colour row is its label, the game's own control, a SWATCH ("Default" on its default) and the palette button; its select stays in the page, hidden, as the app's state; Default, every pigment, the board and RGB are chosen in the selector -- | the selector in its character mode, for a hunter colour row's palette button (ctx.openPalette in colour-rows.js / hunter-panel.js; Raven, 2026-10-18); a colourParts entry's `tip` is the row's game rule in its tooltip (MH3U: R = 0 switches a feature off) |
| colour-field.js | paintField(el, hex, text), wireField(el, onCommit, onSnap), parseHex(t) | THE COLOUR FIELD (Raven, 2026-10-18): one control on every pigment row (pgHex_*, no tick -- "keep the pigments enabled at all times"; an old unticked save loads as Default) and every colour / strip row (*Hex): a hex field showing its colour; one click selects it, a typed #abc / #aabbcc commits, anything else snaps back |
| rgb-picker.js | createRgbPicker({ value, native, onInput, onCommit }) | a TRUE RGB selection (Raven, 2026-10-18): R / G / B sliders + 0-255 boxes, hex, the native picker, a swatch, in step -- the pigment selector's RGB... ONLY (Raven, 2026-10-18: "the RGB sliders are handled in the modal, so no need for them to be in panel"); a Hunter row reaches it by its palette button (or RGB... / its swatch) |
| hunter-tab.js | (classic, runs on load) | game.weaponRows, game.hunterRows, game.hunterNewTitle -- builds the Hunter tab's five panels |
| weapon-panel.js (also `CLASS_ORDER`, `orderClasses(list, nameOf)`) | createWeaponPanel | (none: game.weaponRows) -- paintRows(cls) shows a class's rows; each row's effect is the app's, wired by id |
| guild-panel.js | createGuildPanel | scene, renderer, figure, figureCenter, playerBone, activeMounts, HUNTERS, hunterIndex, weaponClassSel, saveState -- the name plate (base/render/plate.js) and the titles modal |
| base.css | | the family's chrome; url()s point at the app's own `docs/assets` and `docs/fonts` |

## Armor Pieces with their pigments

One panel (Raven, 2026-10-18: "Let's combine Armor Piece and Pigment panels, list the pigment under each piece"):
pigment.js builds the pigment rows as before and MOVES them into the pieces' panel -- All above the first piece, each
slot's row (labelled with its piece -- Raven, 2026-10-19 -- the game's wording via game.js `pigmentRowLabels`
{ all, helm, ..., oall, ohelm, obody }, else "Pigment: Head" etc.) right under its piece select, the Dye mask last -- and hides the emptied Pigment panel.
The Palico pane does the same in its Equipment panel. Ids, handlers and the save are unchanged. In the selector's
character mode, a strip row shows its game strip first (openCharacter's opts.strip / onIndex: MH3U's skin). A colour
row can carry the game's strip too (game.colourRows[part].strip = an app JSON { first, default, colours }; GU's Skin
Tone, 2026-10-19: HD_demo_hadairo, 184 positions): a range in the row over its positions, the same strip first in the
selector, the colour held like a pick ('#rrggbb') so every save path carries it; the range shows the first position
whose colour equals the row's (as the game finds it back) and keeps its own while that still holds.

## The weapon classes' order

Every app lists its weapon classes in GU's Guild Card order (Raven, 2026-10-18; the GU Save Editor's WEAPON_DISPLAY):
Great Sword, Long Sword, Sword & Shield, Dual Blades, Hammer, Hunting Horn, Lance, Gunlance, Switch Axe, Charge Blade,
Insect Glaive, Light Bowgun, Heavy Bowgun, Bow (the Prowler is the Palico's, not a hunter class). By class identity:
the app's adapter maps its own class ids to these names and builds the Class list with
`orderClasses(classes, nameOf)`; a game shows only the classes it has, and each class's weapons keep the game's order.

## The pigment selector

One control in every app (Raven, 2026-10-18: "each game's pigments shows in a single control for all apps"), showing
the CURRENT game's colours only, laid out as the MH4U Armor Viewer's: Default; EVERY in-game pigment list as ONE
"Pigments" collection (Raven, 2026-10-18: "we can simply display them as one collection"; the app's sections are
flattened; each distinct colour ONCE, at its first place in the game's order, its title naming every source -- Raven,
2026-10-18: "dedup the color choices"; the game's Rainbow is the LAST tile of the grid -- "make Rainbow like the other
pigments selections, at the end"; pigPanel.pigmentCounts() -> { before, shown }) (Raven, 2026-10-18: "Any in game pigment should be listed" -- armour lists first, then the hunter's colour
lists, which are pigments too); the game's
Rainbow where it has one; "Color board" (always, even where the game never offered it for armour); then RGB...
(always). Raven's summary: "Right default armor colors, selectable colors for armor and non-armor pigments, the color
wheel as armor pigments even if they were not in game as armor pigments while providing the basic RGB choice". GU alone adds tab two, the Deviant pigments (the static halves,
then the animated pairs). No other game's colours are offered.

## palettes.json

Each game's colour data, one entry per game, built by `dev/build-palettes.py` from each game's own data (the selector no
longer shows other games' tabs; the file stays as the per-game source). `name: null` means the game gives none.

- colour-rows.js (2026-10-19): `game.colourChannel` may be a list of `{ channel, part, exceptSlot? }`; each part goes over
  fAlbedoColor (setChannelColor, the game's multiply) on every material of its channel, not the luminance tint; `exceptSlot`
  (a regex on the material's slot) leaves out another figure's materials on that channel. GU: paint 4, skin 2 (not the Palico).
- shell.js (2026-10-19): `game.panelsUntilReady: true` starts every side panel shut and locks the heads (body.booting)
  until the app dispatches `viewer-ready` on document once its model is drawn (GU: right after the boot overlay goes).
- guild-panel.js / hunter-tab.js (2026-10-19): `guildInfo.tag = { colour, font, icons, iconCell, iconCells }` gives a game
  WITHOUT hrBands a plate in that one colour (the weapon glyph, then the name) with the Name and Shows rows; the Hunter Rank
  row stays hidden without hrBands. Neither hrBands nor tag: titles only, no plate, as before.
