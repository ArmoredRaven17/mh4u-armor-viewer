r"""Build the MH4U Armor Viewer's data from the unpacked cart.

    python scripts/build_armor.py                 # everything
    python scripts/build_armor.py --json-only     # armor.json only (models and textures already shipped)

Reads  <EXTRACT>\conv\player\   (convert_models.py: RevilToolset output + the .mod/.mrl it came from)
       <EXTRACT>\conv\tex\      (every texture by internal path, converted to DDS)
       <EXTRACT>\conv\poses.json (build_poses.py)
       the executable and the English text (mh4u.py)
Writes docs/:
  models/<g>/<g>_<slot><id>.glb      every player model: armour pieces, inner wear, faces, hairs
  tex/<md5[:16]>.webp                each unique base map once
  ui/colorscale.png                  the game's own colour board
  armor.json, materials.json

The model fixes are the MH3U viewers' (mtlib.py), for the same converter on the same platform:
v -> 1 - v, ETC1A4 alpha by replication, and the proxy layer read from the mesh table's draw bit.

What the game decides, READ unless marked (notes in README / armor.json _about):
  * which model a piece draws: armour record +0 (m) / +2 (f), 0x2f4108
  * an empty chest, arms or legs draws the inner wear (0x2f4108: 0xf3fc8c / 0xf3fc98 / 0xf3fca4)
  * who may wear a piece: record +4
  * which hair and face parts a helm leaves, per hairstyle (0xb0ad80), and the Features parts
  * each piece's own pigment: record +0x13 into 0xf57750 (0x2f854c)
"""
import argparse, collections, datetime, glob, json, os, re, shutil, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mh4u
import mrl
from mtlib import (glb_read, glb_write, merge_skins, flip_v, compact, joints_of, mod_info,
                   prim_rows, stage_tex, MASK_DRAWN, BLEND, STATE)

EXTRACT = mh4u.EXTRACT
CONV = os.path.join(EXTRACT, 'conv')
PL = os.path.join(CONV, 'player')
TOOL = r'C:\MHGU-Extract\tools\reviltoolset\revil_toolset.exe'     # run read-only
REPO = os.path.dirname(HERE)
GENDERS = ['m', 'f']                      # the game's order: gender 0 = m, 1 = f (char +0)
SLOTS = ['helm', 'body', 'arm', 'wst', 'leg']
N_FACE, N_HAIR = 16, 28

# ---- an empty slot (READ 0x2f4108) ------------------------------------------------------------
# getModel(mgr, item, gender, inner): record +0 / +2; if 0, chest -> u16 [0xf3fc8c + 2 * inner],
# arms -> 0xf3fc98, legs -> 0xf3fca4 (inner >= 6 -> 0); waist and head return 0, which no file has.
INNER = {'body': 0xf3fc8c, 'arm': 0xf3fc98, 'leg': 0xf3fca4}
N_INNER = 6

# ---- hair and face under a helm (READ 0xb0ad80) ------------------------------------------------
# v = u32 [table[gender] + 4 * helm model] (0x100ca20 m / 0x100d33c f, 583 each); if v & 0x8000,
# v = u32 [0x100dc58 + 0x70 * ((v & 0x7fff) - 1) + 4 * hair model] (rows of 28, one per hairstyle).
# Low half: hair parts 0-9 drawn (data +0x3fa0 unit); high half: face parts 0-6 (+0x4dc8 unit);
# face bit 5 also decides whether the Features part is drawn (0xb08778).
HELM_MASK = {'m': 0x100ca20, 'f': 0x100d33c}
HELM_ROWS, ROW_STRIDE = 0x100dc58, 0x70
N_HELM = 583

# ---- colours ----------------------------------------------------------------------------------
PIGMENTS, N_PIGMENTS = 0xf57750, 70       # armour: record +0x13 -> RGB triple (READ 0x2f854c)
BOARD_TEX = os.path.join(EXTRACT, 'arcx', 'eng', 'data', 'core_title', 'lyt', 'lobby', 'texture',
                         'lby_colorscale_BM_HQ_NOMIP.241f5deb')


def hair_face_tables():
    out = {}
    for g in GENDERS:
        masks = []
        for h in range(N_HELM):
            v = mh4u.word(HELM_MASK[g] + 4 * h)
            if v & 0x8000:
                row = HELM_ROWS + ROW_STRIDE * ((v & 0x7fff) - 1)
                masks.append([mh4u.word(row + 4 * k) for k in range(N_HAIR)])
            else:
                masks.append(v)
        out[g] = masks
    return out


# ---- models ----------------------------------------------------------------------------------

def dds_for(internal):
    p = os.path.join(CONV, 'tex', *internal.replace('/', '\\').lower().split('\\')) + '.tex.dds'
    return p if os.path.isfile(p) else None


def ship_model(g, d, stem, docs, tex_pool, mats_db, notes):
    return ship(os.path.join(PL, g, d, stem), 'models/%s/%s.glb' % (g, stem), '%s/%s' % (g, stem),
                'pieces', docs, tex_pool, mats_db, notes)


def ship(src, rel, ref, section, docs, tex_pool, mats_db, notes):
    """one converted model -> docs/<rel> with the 3DS fixes, and its materials into mats_db[section][ref]
    (build_weapons.py ships the weapons through this too)"""
    stem = os.path.basename(src)
    info = mod_info(src + '.mod')
    js, bin_ = glb_read(src + '.glb')
    merge = merge_skins(js, bin_)
    flip_v(js, bin_)
    prims, hide, unmatched, ambiguous = prim_rows(js, info['table'])
    if unmatched:
        notes.append('%s: primitives with no mesh-table row %s' % (stem, unmatched[:4]))
    if ambiguous:
        notes.append('%s: rows sharing part+verts with different masks %s' % (stem, ambiguous[:4]))
    dst = os.path.join(docs, rel.replace('/', os.sep))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    js['asset'] = dict(js.get('asset', {}), generator='revil_toolset mod_to_gltf + ' + os.path.basename(sys.argv[0]))
    compact(js, bin_)
    glb_write(dst, js, bin_)
    m = mrl.read(src + '.mrl')
    words = mrl.words(src + '.mrl')
    tex = []
    for p in m['textures']:
        dds = dds_for(p) if p else None
        if p and not dds:
            notes.append('%s: texture %s not found' % (stem, p))
        tex.append(stage_tex(dds, docs, tex_pool) if dds else None)
    mats = {}
    for mt in js.get('materials', []):
        name = mt.get('name', '')
        h = mrl.name_hash(name)
        r = m['mats'].get(h)
        if not r:
            notes.append('%s: material %s is not in its .mrl' % (stem, name))
            continue
        rec = {'t': {'albedo': r['slots'].get('tAlbedoMap', 0) or None}}
        b = BLEND.get(r['blend'])
        if b is None:
            notes.append('%s: material %s has blend state %s' % (stem, name, r['blend']))
        else:
            rec['s'] = STATE.index(b)
        if r['slots'].get('tExtendMap'):
            rec['extendMap'] = True
        ct = mrl.colour_type(words[h])
        if ct:
            rec['ct'] = ct
        mats[name] = rec
    mats_db.setdefault(section, {})[ref] = {'tex': tex, 'mats': mats}
    mats_db['glb'][rel] = ref
    return {'glb': rel, 'joints': joints_of(js), 'hideIdx': hide, 'prims': len(prims),
            'bones': info['bones'], 'verts': info['verts'],
            'parts': sorted({e['part'] for e in info['table'] if e['mask'] & MASK_DRAWN}),
            'skinsMerged': merge['skins'] if merge['merged'] else None}


def models(docs, json_only, notes):
    mats_path = os.path.join(docs, 'materials.json')
    cache = os.path.join(CONV, 'models.json')
    if json_only:
        return json.load(open(cache, encoding='utf-8')), json.load(open(mats_path, encoding='utf-8'))
    out, tex_pool = {}, {}
    mats_db = {'_about': 'MH4U .mrl v0x20 read through LtShaderPackage.lfx (MFX v52) by mrl.py: t.albedo is '
                         'the tAlbedoMap binding (1-based into tex), s the blend-state record (BSSolid / '
                         'BSBlendAlpha / BSAddAlpha), ct the colour type (record word +0x18 bits 23-30, '
                         'armor.json _about.colors). LUT and extend maps are not drawn.',
               'state': [{'blend': b} for b in STATE], 'pieces': {}, 'glb': {}}
    if os.path.isfile(mats_path):                    # the weapons' entries (build_weapons.py) stay
        old = json.load(open(mats_path, encoding='utf-8'))
        mats_db['weapons'] = old.get('weapons', {})
        mats_db['glb'].update({k: v for k, v in old.get('glb', {}).items() if v.startswith('w/')})
    mods = sorted(glob.glob(os.path.join(PL, '*', '*', '*.mod')))
    for i, mod in enumerate(mods):
        g = os.path.basename(os.path.dirname(os.path.dirname(mod)))
        d = os.path.basename(os.path.dirname(mod))
        stem = os.path.splitext(os.path.basename(mod))[0]
        if not os.path.isfile(mod[:-4] + '.glb'):
            notes.append('%s/%s: not converted' % (g, stem))
            continue
        out['%s/%s' % (g, stem)] = ship_model(g, d, stem, docs, tex_pool, mats_db, notes)
        if i % 500 == 0:
            print('models', i, '/', len(mods), flush=True)
    json.dump(mats_db, open(mats_path, 'w', encoding='utf-8'), separators=(',', ':'))
    json.dump(out, open(cache, 'w', encoding='utf-8'))
    print('%d models, %d textures' % (len(out), len(tex_pool)))
    return out, mats_db


def colour_data(docs, notes):
    import numpy as np
    from PIL import Image
    work = os.path.join(CONV, 'gui')
    os.makedirs(work, exist_ok=True)
    dst = os.path.join(work, 'lby_colorscale.tex')
    shutil.copy2(BOARD_TEX, dst)
    subprocess.run([TOOL, 'mtf_tex_to_dds', '--platform', 'N3DS', dst], cwd=os.path.dirname(TOOL), capture_output=True)
    px = np.array(Image.open(dst + '.dds').convert('RGBA'))
    # the board proper: inside its one-texel black frame (x 1-176, y 1-51 of 256 x 64)
    op = np.where(px[..., 3] > 0)
    x0, y0, x1, y1 = int(op[1].min()) + 1, int(op[0].min()) + 1, int(op[1].max()) - 1, int(op[0].max()) - 1
    px[..., 3] = 0
    px[y0:y1 + 1, x0:x1 + 1, 3] = 255
    rel = 'ui/colorscale.png'
    os.makedirs(os.path.join(docs, 'ui'), exist_ok=True)
    Image.fromarray(px, 'RGBA').save(os.path.join(docs, rel.replace('/', os.sep)))
    pig = [list(mh4u.raw(PIGMENTS + 3 * i, 3)) for i in range(N_PIGMENTS)]
    return {'board': {'png': rel, 'w': px.shape[1], 'h': px.shape[0], 'region': [x0, y0, x1, y1]},
            'pigments': pig}


# ---- armor.json --------------------------------------------------------------------------------

def stem_of(g, slot, mid):
    return '%s_%s%03d' % (g, slot, mid)


def inner_models(slot):
    if slot not in INNER:
        return None
    return [mh4u.half(INNER[slot] + 2 * i) for i in range(N_INNER)]



# ---- the helms' Blademaster / Gunner (Settings -> Equipment, base/ui/armor-panel.js headBoth) -------------------------

def helm_types():
    """{helm record id: 'b' | 'g' | 'bg'}. Nearly every helm record is wearable by both (+4 bits 4 and 8); its own
    type is its SET's, read from the records: the u16 at +0x1c is the set id the pieces of a set share (Rathalos Helm S
    and Rathalos Mail S: 0xf6), or, in the sets numbered piece by piece, the listing index that runs helm, chest, arms,
    waist, legs (GX Hunter's Casque 0x5dd, its Armor .. Cuisses 0x5de .. 0x5e1). A helm takes the type its set's other
    pieces all have; a helm with no such set (masks, feathers, earrings ...) or a set whose pieces are all both (Derring,
    Leather, Chainmail, Chakra) stays 'bg', listed under both types."""
    recs = {s: [r for r in mh4u.armor_records(s) if r['id'] and r['name'] and not r['name'].upper().startswith('DUMMY')]
            for s in SLOTS}
    sid = lambda r: struct.unpack_from('<H', bytes.fromhex(r['raw']), 0x1c)[0]
    wear = lambda r: ('b' if r['wear']['blade'] else '') + ('g' if r['wear']['gunner'] else '')
    by = {}
    for s in SLOTS:
        for r in recs[s]:
            by.setdefault(sid(r), []).append((s, r))
    rest = [s for s in SLOTS if s != 'helm']
    out = {}
    for r in recs['helm']:
        w = wear(r)
        if w in ('b', 'g'):
            out[r['id']] = w; continue
        ws = {wear(x) for s, x in by.get(sid(r), []) if s != 'helm'}
        if len(ws) == 1 and ws <= {'b', 'g'}:
            out[r['id']] = ws.pop(); continue
        seq = [[x for t, x in by.get(sid(r) + k, []) if t == s] for k, s in enumerate(rest, 1)]
        if all(len(v) == 1 for v in seq):
            ws = {wear(v[0]) for v in seq}
            if len(ws) == 1 and ws <= {'b', 'g'}:
                out[r['id']] = ws.pop(); continue
        out[r['id']] = 'bg'
    return out

def build(docs, json_only):
    notes = []
    mdl, mats_db = models(docs, json_only, notes)
    armor = {}
    ht = helm_types()
    for slot in SLOTS:
        rows = []
        for r in mh4u.armor_records(slot):
            if r['id'] == 0 or not r['name'] or r['name'].upper().startswith('DUMMY'):
                continue
            row = {'id': r['id'], 'name': r['name'], 'm': r['model']['m'], 'f': r['model']['f'],
                   'wear': ''.join(k for k, on in (('m', r['wear']['m']), ('f', r['wear']['f']),
                                                   ('b', r['wear']['blade']), ('g', r['wear']['gunner'])) if on),
                   'pig': r['dye'], 'rar': r['rarity']}
            if r['relic']:
                row['relic'] = 1
            if slot == 'helm':
                row['ht'] = ht.get(r['id'], 'bg')       # the helm's own type, from its set (helm_types)
            rows.append(row)
        armor[slot] = rows
    pieces = {}
    for g in GENDERS:
        for slot in SLOTS:
            ids = {r[g] for r in armor[slot] if g in r['wear']} | set(inner_models(slot) or [])
            for mid in sorted(ids):
                key = '%s/%s' % (g, stem_of(g, slot, mid))
                if key in mdl:
                    pieces[key] = mdl[key]
                elif mid:
                    notes.append('%s: no model on the cart' % key)
    chars = {}
    for g in GENDERS:
        chars[g] = {}
        for part, n in (('face', N_FACE), ('hair', N_HAIR)):
            lst = []
            for i in range(n):
                key = '%s/%s_%s%03d' % (g, g, part, i)
                if key in mdl:
                    lst.append(dict(mdl[key], id=i))
                else:
                    notes.append('%s: missing' % key)
            chars[g][part] = lst
    inner = {s: inner_models(s) for s in SLOTS if inner_models(s)}
    cts = collections.Counter(m.get('ct', 0) for e in mats_db['pieces'].values() for m in e['mats'].values())
    print('colour types', dict(sorted(cts.items())))
    colors = colour_data(docs, notes)
    poses = {}
    pj = os.path.join(CONV, 'poses.json')
    if os.path.isfile(pj):
        for g, p in json.load(open(pj, encoding='utf-8')).items():
            base = mdl.get(p['base'])
            poses[g] = {'model': base['glb'], 'joints': base['joints'],
                        'lists': [{k: v for k, v in l.items() if k in ('id', 'group', 'file', 'clips')}
                                  for l in p['lists'] if l['clips']]}
    else:
        notes.append('no conv/poses.json: run build_poses.py')
    about = {
        'armor': 'the game\'s armour tables (mh4u.py, the MH4U Collection Tracker\'s decode): 0x28-byte records '
                 'at [0xf588d8 + 4 * item type] (types 1-5 = chest, arms, waist, legs, head). `m`/`f` = the model '
                 'each gender draws (record +0 / +2, READ at 0x2f4108); `wear` = record +4: m, f, b = Blademaster, '
                 'g = Gunner; `pig` = record +0x13, the piece\'s pigment (READ 0x2f854c); `rar` = rarity; '
                 '`relic` = record +6 & 0xc0, the relic armour templates. Names: LMD <Slot>Name at the record '
                 'index. Records named DUMMY and the (None) record 0 are left out.',
        'inner': 'models drawn for an empty chest / arms / legs slot by the Clothing choice (0x2f4108 falls back to '
                 'u16 tables 0xf3fc8c / 0xf3fc98 / 0xf3fca4, six entries, indexed by the character\'s inner-wear '
                 'byte, char +4 at 0xaf9124). An empty helm or waist draws model 0, which has no file: nothing.',
        'hairFace': 'per gender, per HELM MODEL (0-582): either one u32 or 28 (one per hairstyle). Low 16 bits: '
                    'hair parts 0-9 drawn; high 16 bits: face parts 0-6 drawn, and bit 5 of that half also '
                    'decides whether the Features part is drawn (READ 0xb0ad80 / 0xb08778: table 0x100ca20 m, '
                    '0x100d33c f; a value with bit 0x8000 picks row (v & 0x7fff) of 0x100dc58, 28 u32 per row).',
        'features': 'Features (CharMake: Features, Type 1-12) are face parts 200-211: 0xb08778 shows part '
                    '200 + (char +0x3a) - 1 and hides the rest; 0 = none. Their materials take colour type 4.',
        'ht': "a helm row's own Blademaster / Gunner type (b, g, or bg for both): its set's, from the records (+0x1c "
              "set id, or the helm-to-legs listing index; build_armor.py helm_types): 469 b, 469 g, 32 bg. The Head list "
              "filters by it unless Settings -> Equipment treats head armour as both (the game's own rule: wear bits).",
        'colors': 'each material carries a colour type (materials.json `ct` = .mrl record +0x18 bits 23-30, the '
                  'same layout as MH3U) that multiplies its albedo map: 1 hair (the hair models), 2 skin (f_skin_BM / m_skin_BM '
                  'everywhere, and the face), 3 pigment (armour, and the inner wear, so Clothing Color is the '
                  'inner wear\'s pigment -- INFERRED from the files, the 4U colour loop is not read), 4 the '
                  'Features (make000-011), 5 a female face layer (not identified; drawn untinted). `pigments` = '
                  'the 70 armour pigment colours at 0xf57750 (READ 0x2f854c; melee weapons use 0xf57822 + 3 * '
                  'record +0x12, gunners 0xf5784f + 3 * record +0x1b). `board` = the game\'s colour board '
                  'lyt\\lobby\\texture\\lby_colorscale (core_title.arc), drawn inside its black frame; that the '
                  'Skin Tone / Hair / Clothing / Feature menus sample it, and their presets, are NOT read -- the '
                  'viewer uses it as its picker.',
        'poses': 'the hunter\'s motion lists (build_poses.py): co_* field, lco_* lobby, pl_make, pl_gc, pl_arena '
                 'and the weapon classes\' wNN, converted per gender onto the inner-wear body, played on that '
                 'body as a proxy and copied to every piece by bone id. The clips carry no names in the game data.',
        'models': 'v flipped and ETC1A4 alpha replicated as in the MH3U viewers; `hideIdx` = primitives whose '
                  'mesh-table row lacks the draw bit (+0 bit 0), the proxy layer. Seven models exist only in '
                  'romfs/loc/data, with a leading loc\\ on their internal path (249, 316, 317, 569, 570, 581, '
                  '582); the path builder clears id bit 0x8000 (0xaf7c58), likely that flag -- not traced.',
    }
    index = {'version': 1, 'generated': datetime.datetime.now().isoformat(timespec='seconds'),
             '_about': about, 'genders': GENDERS, 'slots': SLOTS, 'armor': armor, 'inner': inner,
             'pieces': pieces, 'chars': chars, 'hairFace': hair_face_tables(), 'features': list(range(200, 212)),
             'colors': colors, 'poses': poses}
    json.dump(index, open(os.path.join(docs, 'armor.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    print('armor rows %s, pieces %d' % ({s: len(armor[s]) for s in SLOTS}, len(pieces)))
    for n in notes[:60]:
        print('  NOTE', n)
    print(len(notes), 'notes')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--json-only', action='store_true')
    opt = ap.parse_args()
    docs = os.path.join(REPO, 'docs')
    os.makedirs(docs, exist_ok=True)
    build(docs, opt.json_only)
