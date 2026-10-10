r"""Ship MH4U's weapons into the viewer: every weapon model, the game's weapon tables and its weapon mount.

    python scripts/build_weapons.py              # models, textures, materials.json `weapons`, weapons.json, mount.json
    python scripts/build_weapons.py --json-only  # weapons.json and mount.json only

Reads <EXTRACT>\conv\weapon\ (convert_models.py) and the executable. Writes docs/:
  models/weapons/<dir>/<part><id>.glb   every weapon model, with the armour's 3DS fixes (build_armor.ship)
  materials.json                         adds `weapons` (keyed w/<dir>/<part><id>) beside the armour
  weapons.json                           classes, their parts, every weapon's name, model and pigment, Kinsects
  mount.json                             how the game hangs each part on the hunter

THE TABLES (READ unless marked):
  * weapon records: the MH4U Collection Tracker's decode -- melee item types [0xf5884c + 4 * type], 0x18-byte
    records; gunners (11 LBG, 12 HBG, 16 Bow) [0xf58884 + 4 * type], 0x28 bytes; counts u32 [0xf3fc38 + 4 * type];
    names LMD <Class>Name at the record index. `model` = record +0 u16 (every record's model is on the cart but
    one Dual Blades', so the field is the model; its getter is not traced)
  * class = byte [0xf5f2fc + item type] (READ 0x2f13b4): GS 0, SnS 1, Hammer 2, Lance 3, HBG 4, LBG 6, LS 7,
    SA 8, GL 9, Bow 10, DB 11, HH 12, IG 13, CB 14 -- the player\mot\wNN numbering
  * part names: [0xfb8984 + 4 * class] -> the loader's names (two; one, sld; ham; lan, sld; hbg; lbg; ken, saya;
    axe; gun, sld; bow, ya; sou_l, sou_r; hue; rod, mus; blade, sld). Folders: weapon\<dir>\<dir>NNN\<part>NNN,
    the Kinsect weapon\mus\musNNN\musNNN (0x33d488)
  * pigment (0x2f854c): melee RGB 0xf57822 + 3 * record[0x12]; gunners 0xf5784f + 3 * record[0x1b]
  * Kinsect model (0x2f52a8): u16 [0xf58a02 + 14 * kinsect]; Kinsect names LMD InsectName
THE MOUNT (READ; see mount.json `_about`):
  * part type: 0x3506d8(callback, class, part) -- the switch below (TYPES)
  * per frame 0x34c5d8: state, hunter bone, record and scale per part; the record getter 0x3553b8 reads
    0x18-byte {pos xyz, rot xyz} records from tables a static initialiser (0xd4518c) fills at boot, run here
    in an emulator (static_init.py)
"""
import argparse, datetime, glob, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mh4u
import static_init
from build_armor import ship, CONV

REPO = os.path.dirname(HERE)
WCONV = os.path.join(CONV, 'weapon')

# item type, class, folder, name table
CLASSES = [(7, 0, 'two', 'LswordName'), (13, 7, 'swo', 'Lsword2Name'), (8, 1, 'one', 'SwordName'),
           (17, 11, 'sou', 'WswordName'), (9, 2, 'ham', 'HammerName'), (18, 12, 'hue', 'Hammer2Name'),
           (10, 3, 'lan', 'LanceName'), (15, 9, 'gun', 'Lance2Name'), (14, 8, 'axe', 'AxeName'),
           (20, 14, 'gaxe', 'GaxeName'), (19, 13, 'rod', 'RodName'),
           (11, 6, 'lbg', 'LightName'), (12, 4, 'hbg', 'HeavyName'), (16, 10, 'bow', 'BowName')]
GUNNER_TYPES = {11, 12, 16}
MELEE_TABLES, GUNNER_TABLES = 0xf5884c, 0xf58884
CLASS_OF = 0xf5f2fc
PART_NAMES = 0xfb8984
PIG_MELEE, PIG_GUNNER = 0xf57822, 0xf5784f
KINSECT_MODEL, KINSECTS = 0xf58a02, 35
# 0x3506d8: class -> part types (part 0, part 1)
TYPES = {0: [0], 1: [1, 2], 2: [3], 3: [4, 10], 4: [5], 5: [5], 6: [5], 15: [5], 7: [8, 18], 8: [9],
         9: [11, 16], 10: [12, 19], 11: [13, 14], 12: [15], 13: [17, 22], 14: [20, 21]}
GUNNER_CLASSES = {4, 5, 6, 15}

# ---- the mount ---------------------------------------------------------------------------------
INIT = 0xd4518c                      # the static initialiser that fills the record tables
T_BASE, T_DRAWN, T_REST, T_STATE3 = 0x109f6a0, 0x109f8c8, 0x109faf0, 0x109fd18
T_GUN_DRAWN, T_GUN_REST = 0x109ff40, 0x109ff70     # + 0x18 for the Light Bowgun (0xb0925c: item type 11)
REC = 0x18


def state_for(t, drawn):
    """0x34c5d8 with no special motion: the sheathed flag (player data +0x30) puts a part in state 2; drawn,
    0x350438 returns 1 -- 0 for the Dual Blades' second blade (type 14). Shields and the Kinsect (types 2, 10,
    16, 22) are held, state 4; the scabbard and the arrows (18, 19) always rest, state 2."""
    if t in (2, 10, 16, 22):
        return 4
    if t in (18, 19):
        return 2
    if not drawn:
        return 2
    if t == 21:
        # the Charge Blade's shield (0x34c6e8): 0x350438's state is kept only when it is 2, 5, 6, 7, 9 or 10;
        # its default 1 falls to state 4, the forearm (the sword-mode shield)
        return 4
    return 0 if t == 14 else 1


def bone_for(t, st):
    """0x34c7b0: state 0, 6, 8 -> bone 12; 1, 5, 7, 9 -> 8; 4 -> 11; a rest state (2, 3) -> 1 for types 1, 2, 9,
    13, 14, 20, 21, 0 for type 19 (the arrows), 2 for the rest"""
    if st in (0, 6, 8):
        return 12
    if st in (1, 5, 7, 9):
        return 8
    if st == 4:
        return 11
    if t in (1, 2, 9, 13, 14, 20, 21):
        return 1
    if t == 19:
        return 0
    return 2


def scale_for(cls, t, st, lbg):
    """0x34cb90: 1.0 but in a rest state (2, 3), where the class decides (0x34cbdc), and the Kinsect held (0.8)"""
    if st == 4:
        return 0.8 if t == 22 else 1.0
    if st not in (2, 3):
        return 1.0
    if cls in GUNNER_CLASSES:
        return 0.9 if lbg else 0.8
    if cls == 10:
        return 1.0 if t == 19 else 0.8
    if cls == 14:
        return 0.7 if t == 20 else 0.8
    return {0: 0.8, 1: 1.0, 2: 0.8, 3: 0.9, 7: 0.8, 8: 0.9, 9: 0.8, 11: 1.0, 12: 0.8, 13: 0.8}[cls]


def record(m, cls, t, st, lbg):
    """0x3553b8(callback, player, type, state)"""
    if cls in GUNNER_CLASSES and st != 3:
        va = (T_GUN_DRAWN if st == 1 else T_GUN_REST) + (REC if lbg else 0)
    else:
        va = {1: T_DRAWN, 2: T_REST, 3: T_STATE3}.get(st, T_BASE) + REC * t
    v = m.f32(va, 6)
    return {'pos': [round(x, 4) for x in v[:3]], 'rot': [round(x, 4) for x in v[3:]]}


def mount():
    m = static_init.run(INIT)
    classes = {}
    for _, cls, _, _ in CLASSES:
        lbg = cls == 6
        parts = []
        for k, t in enumerate(TYPES[cls]):
            e = {'index': k, 'type': t, 'mountJoint': 4 if t == 18 else 0}
            for carry in ('sheathed', 'drawn'):
                st = state_for(t, carry == 'drawn')
                e[carry] = dict(record(m, cls, t, st, lbg), state=st, joint=bone_for(t, st),
                                scale=scale_for(cls, t, st, lbg))
            parts.append(e)
        classes[str(cls)] = {'parts': parts}
    return {
        'order': 'ZYX', 'units': {'pos': 'cm', 'rot': 'degrees'},
        'compose': "world(the part model's mountJoint) = world(hunter bone `joint`) * T(pos) * R(rot, ZYX) * S(scale)",
        'classes': classes,
        '_about': {
            'mount': 'How the game hangs each weapon part on the hunter, read from the executable (build_weapons.py). '
                     'A part\'s type comes from 0x3506d8 (class, part index); each frame 0x34c5d8 picks its state, '
                     'hunter bone and scale and the getter 0x3553b8 its {pos, rot} record. `sheathed` and `drawn` '
                     'are the placement with no special motion playing: sheathed = player data +0x30 set (state 2); '
                     'drawn = 0x350438\'s default, 1 (0 for the Dual Blades\' second blade); shields and the Kinsect '
                     'held (state 4) -- the Charge Blade shield too while drawn --, the scabbard and the arrows always resting (state 2). Bones: 12 / 8 the '
                     'hands, 11 the forearm, 1 and 2 the waist and back, 0 the root (the arrows).',
            'records': 'The record tables are filled at boot by the static initialiser 0xd4518c, run in an emulator '
                       '(static_init.py): 0x109f6a0 states 0 / 4, 0x109f8c8 state 1, 0x109faf0 state 2, 0x109fd18 '
                       'state 3, 23 types each; the bowguns use 0x109ff40 (drawn) / 0x109ff70 (rest), the second '
                       'record for the Light Bowgun (0xb0925c). The shared types hold MH3U\'s own numbers, so the '
                       'matrix convention is taken from the MH3U Armor Viewer, which ran its joint method.',
            'inferred': 'mountJoint: the joint the record drives is the part\'s root joint, 0, and 4 for the Long Sword '
                        'scabbard (its only joint) -- 4U\'s per-type joint table is not read; 3U\'s says the same.',
            'notRead': 'Motion-specific placements (0x350438 switches on the motion id; the bowguns and others have '
                       'per-motion records at 0xf2e8bc), any per-model rest override (3U had one), the weapons\' '
                       'own joint animation and part masks while drawn, the female scabbard offset (0x34cb68).',
        },
    }


# ---- the tables ----------------------------------------------------------------------------------

def cstr(va):
    o = va - mh4u.BASE
    return mh4u.CODE[o:mh4u.CODE.find(b'\0', o)].decode('latin1')


def part_names(cls):
    arr = mh4u.word(PART_NAMES + 4 * cls)
    return [cstr(mh4u.word(arr + 4 * k)) for k in range(len(TYPES[cls]))]


def records(t):
    gun = t in GUNNER_TYPES
    tab = mh4u.word((GUNNER_TABLES if gun else MELEE_TABLES) + 4 * t)
    n = mh4u.word(mh4u.COUNTS + 4 * t)
    stride = 0x28 if gun else 0x18
    return [mh4u.raw(tab + stride * i, stride) for i in range(n)]


def ship_all(docs, notes):
    mats_path = os.path.join(docs, 'materials.json')
    mats_db = json.load(open(mats_path, encoding='utf-8'))
    for rel in [k for k, v in mats_db['glb'].items() if v.startswith('w/')]:
        del mats_db['glb'][rel]
    mats_db['weapons'] = {}
    tex_pool, models = {}, {}
    mods = sorted(glob.glob(os.path.join(WCONV, '*', '*.mod')))
    for i, mod in enumerate(mods):
        folder = os.path.basename(os.path.dirname(mod))           # two001, mus001
        d = folder.rstrip('0123456789')
        stem = os.path.splitext(os.path.basename(mod))[0]
        if not os.path.isfile(mod[:-4] + '.glb'):
            notes.append('%s/%s: not converted' % (folder, stem))
            continue
        key = '%s/%s' % (d, stem)
        models[key] = ship(mod[:-4], 'models/weapons/%s.glb' % key, 'w/' + key, 'weapons', docs, tex_pool,
                           mats_db, notes)
        if i % 500 == 0:
            print('weapon models', i, '/', len(mods), flush=True)
    json.dump(mats_db, open(mats_path, 'w', encoding='utf-8'), separators=(',', ':'))
    json.dump(models, open(os.path.join(CONV, 'weapon_models.json'), 'w', encoding='utf-8'))
    print('%d weapon models, %d new textures' % (len(models), len(tex_pool)))
    return models


def build(docs, json_only):
    notes = []
    models = json.load(open(os.path.join(CONV, 'weapon_models.json'), encoding='utf-8')) if json_only \
        else ship_all(docs, notes)
    common = mh4u.lmd_messages(os.path.join('common', 'Common'))
    classes, weapons = [], {}
    for t, cls, d, msg in CLASSES:
        assert mh4u.CODE[CLASS_OF - mh4u.BASE + t] == cls, (t, cls)
        names = mh4u.lmd_messages(msg)
        parts = part_names(cls)
        gun = t in GUNNER_TYPES
        # the IG's second part is the Kinsect: its own folder and model number, chosen apart from the glaive
        own = [p for p in parts if p != 'mus']
        classes.append({'cls': cls, 'key': 'w%02d' % cls, 'type': t, 'name': common[36 + t], 'dir': d,
                        'parts': parts, 'gunner': gun})
        rows = []
        for i, r in enumerate(records(t)):
            name = names[i] if i < len(names) else ''
            if i == 0 or not name or name.lower().startswith('dummy'):
                continue
            model = struct.unpack_from('<H', r, 0)[0]
            if not any(('%s/%s%03d' % (d, p, model)) in models for p in own):
                notes.append('%s %s: model %d is not on the cart' % (d, name, model))
                continue
            row = {'id': i, 'name': name, 'model': model, 'pig': r[0x1b] if gun else r[0x12]}
            if cls == 13:              # three glaives force their Kinsect's model (0x2f52a8)
                force = {0x26: 1, 0x85: 32, 0x86: 1}.get(i)
                if force:
                    row['kinsect'] = force
            rows.append(row)
        weapons['w%02d' % cls] = rows
    kn = mh4u.lmd_messages('InsectName')
    kinsects = [{'id': k, 'name': kn[k], 'model': mh4u.half(KINSECT_MODEL + 14 * k)} for k in range(KINSECTS)]
    for k in kinsects:
        if 'mus/mus%03d' % k['model'] not in models:
            notes.append('Kinsect %s: model %d not on the cart' % (k['name'], k['model']))
    npm = 1 + max(r['pig'] for c in classes if not c['gunner'] for r in weapons[c['key']])
    npg = 1 + max(r['pig'] for c in classes if c['gunner'] for r in weapons[c['key']])
    pigments = {'melee': [list(mh4u.raw(PIG_MELEE + 3 * i, 3)) for i in range(npm)],
                'gunner': [list(mh4u.raw(PIG_GUNNER + 3 * i, 3)) for i in range(npg)]}
    used = {'%s/%s%03d' % (c['dir'], p, r['model']) for c in classes for r in weapons[c['key']] for p in c['parts']}
    used |= {'mus/mus%03d' % k['model'] for k in kinsects}
    about = {
        'weapons': "the game's weapon tables (build_weapons.py; the MH4U Collection Tracker's decode): melee "
                   '[0xf5884c + 4 * item type] 0x18-byte records, gunners [0xf58884 + 4 * item type] 0x28 bytes. '
                   '`model` = record +0 u16 (every record\'s model is on the cart but one, the getter is not traced); '
                   '`pig` = the pigment index (READ 0x2f854c: melee record +0x12 into pigments.melee, gunner +0x1b '
                   'into pigments.gunner); names LMD <Class>Name at the record index. Record 0 and DUMMY rows are out.',
        'classes': '`cls` = the class byte [0xf5f2fc + item type] (READ 0x2f13b4), the wNN of the motion lists; '
                   '`name` = Common message 36 + item type; `parts` = the loader\'s part names [0xfb8984 + 4 * cls]. '
                   'The Insect Glaive\'s second part, mus, is the Kinsect, from its own folder.',
        'kinsects': 'LMD InsectName; `model` = u16 [0xf58a02 + 14 * id] (READ 0x2f52a8). A glaive with `kinsect` '
                    'forces that model (glaive ids 0x26, 0x85, 0x86 in the same function).',
        'models': 'every weapon model on the cart, with the armour\'s 3DS fixes; keyed <dir>/<part><model>.',
    }
    out = {'version': 1, 'generated': datetime.datetime.now().isoformat(timespec='seconds'), '_about': about,
           'classes': classes, 'weapons': weapons, 'kinsects': kinsects, 'pigments': pigments,
           'models': {k: v for k, v in models.items() if k in used},
           'unlisted': sorted(k for k in models if k not in used)}
    json.dump(out, open(os.path.join(docs, 'weapons.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    mt = mount()
    json.dump(dict({'version': 1}, **mt), open(os.path.join(docs, 'mount.json'), 'w', encoding='utf-8'), indent=1)
    print('classes', [(c['key'], c['name'], c['parts'], len(weapons[c['key']])) for c in classes])
    print('models listed %d, on the cart but in no record %d' % (len(out['models']), len(out['unlisted'])))
    for cls, c in mt['classes'].items():
        for p in c['parts']:
            s, d = p['sheathed'], p['drawn']
            print('class %2s type %2d | sheathed st%d bone %2d %s %s x%.1f | drawn st%d bone %2d %s %s x%.1f'
                  % (cls, p['type'], s['state'], s['joint'], s['pos'], s['rot'], s['scale'],
                     d['state'], d['joint'], d['pos'], d['rot'], d['scale']))
    for n in notes[:40]:
        print('  NOTE', n)
    print(len(notes), 'notes')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--json-only', action='store_true')
    opt = ap.parse_args()
    build(os.path.join(REPO, 'docs'), opt.json_only)
