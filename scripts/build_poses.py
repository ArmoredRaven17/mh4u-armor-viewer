r"""The hunter's motion lists for the MH4U Armor Viewer.

    python scripts/build_poses.py

The lists, as the game names them (string table at 0xe8aba8):
  player\mot\co\co_0, co_1, co_2, co_4      field common       (romfs/loc/data/pl_base_0.arc)
  player\mot\co\lco_0..3, lco_0p/2p/3p      lobby common       (pl_mot_lco.arc / pl_mot_lcop.arc)
  player\mot\co\pl_make                     character creation (core_title.arc)
  player\mot\co\pl_gc                       Guild Card         (pl_base_1.arc)
  player\mot\co\pl_arena                    Arena              (core_arena.arc)
  player\mot\wNN\wNN                        each weapon class  (pl_wNN.arc; w05 does not exist)
The .lmt files are pulled out by scripts/convert_models.py's neighbour, conv\mot (see stage_lmts).

Each list is converted once per gender with RevilToolset's lmt_to_gltf onto that gender's inner-wear
body (<g>_body060), which carries bones 0-19 and the `reference` node -- every bone the lists drive.
Then, as in the MH3U viewers: strip_to_animation (nodes + animations only) and reduce_keys.
NO patch_xyzw_rotations here. In 3U (LMT v66) the converter emits only [reference, zero] for key types
11/12/13 and the MH3U viewers re-decode them (lmt_fix.py); for 4U's LMT v67 the converter decodes them
itself -- lco_0 Motion[1]_loop: 81-96 varying keys per knee / elbow, rotations about the reference's own
axis -- and 3U's decoder applied to v67 keys bent the knees ~95 degrees at idle. lmt_fix.py is kept for
inspection (it reads v67 tracks; its key decode is 3U's).
Writes docs/poses/<g>/<list>.glb and <EXTRACT>\conv\poses.json (read by build_armor.py).
"""
import json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reduce_keys
from mtlib import glb_read, strip_to_animation, clip_list

EXTRACT = r'C:\MH4U-Extract'
sys.path.insert(0, os.path.join(EXTRACT, 'tools'))
import arc4

TOOL = r'C:\MHGU-Extract\tools\reviltoolset\revil_toolset.exe'     # run read-only
CONV = os.path.join(EXTRACT, 'conv')
MOT = os.path.join(CONV, 'mot')
DOCS = os.path.join(os.path.dirname(HERE), 'docs')
BASE = 'body060'          # the inner wear's body: the skeleton every list is converted onto
SOURCES = [r'loc\data\pl_base_0.arc', r'data\pl_mot_lco.arc', r'data\pl_mot_lcop.arc',
           r'loc\data\pl_base_1.arc', r'eng\data\core_title.arc', r'eng\data\core_arena.arc'] + \
          [r'data\pl_w%02d.arc' % i for i in range(15) if i != 5]
# the order the viewer lists them in, and what each group is
GROUPS = [('co', ['co_0', 'co_1', 'co_2', 'co_4']),
          ('lco', ['lco_0', 'lco_1', 'lco_2', 'lco_3', 'lco_0p', 'lco_2p', 'lco_3p']),
          ('etc', ['pl_make', 'pl_gc', 'pl_arena']),
          ('weapon', ['w%02d' % i for i in range(15) if i != 5])]
T_LMT = 0x76820d81


def stage_lmts():
    os.makedirs(MOT, exist_ok=True)
    for s in SOURCES:
        p = os.path.join(EXTRACT, 'romfs', s)
        with open(p, 'rb') as f:
            for name, th, cs, ds, fl, off in arc4.entries(p):
                if th == T_LMT and name.startswith('player'):
                    open(os.path.join(MOT, name.split('\\')[-1] + '.lmt'), 'wb').write(arc4.read_entry(f, cs, ds, off))


def main():
    stage_lmts()
    work = os.path.join(CONV, '_poses')
    shutil.rmtree(work, ignore_errors=True)
    names_all = [n for _, ns in GROUPS for n in ns]
    out = {}
    for g in ('m', 'f'):
        base = os.path.join(CONV, 'player', g, 'pl060', '%s_%s.glb' % (g, BASE))
        js, _ = glb_read(base)
        names = {n.get('name', '') for n in js['nodes']}
        d = os.path.join(work, g)
        os.makedirs(d, exist_ok=True)
        pairs = []
        for n in names_all:
            shutil.copy2(base, os.path.join(d, n + '.glb'))
            shutil.copy2(os.path.join(MOT, n + '.lmt'), os.path.join(d, n + '.lmt'))
            pairs.append([n + '.glb', n + '.lmt'])
        json.dump(pairs, open(os.path.join(d, 'batch.json'), 'w'))
        r = subprocess.run([TOOL, 'lmt_to_gltf', os.path.join(d, 'batch.json')], cwd=os.path.dirname(TOOL),
                           capture_output=True, text=True, errors='replace', timeout=1800)
        open(os.path.join(d, 'lmt_to_gltf.log'), 'w', encoding='utf-8').write(r.stdout + r.stderr)
        lists = []
        for group, ns in GROUPS:
            for n in ns:
                src = os.path.join(d, n + '_out.glb')
                rel = 'poses/%s/%s.glb' % (g, n)
                dst = os.path.join(DOCS, rel.replace('/', os.sep))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                if not os.path.isfile(src):
                    lists.append({'id': n, 'group': group, 'file': rel, 'clips': [],
                                  'error': 'lmt_to_gltf produced nothing'})
                    print(g, n, 'NOTHING', flush=True)
                    continue
                dropped = strip_to_animation(src, dst, names)
                reduce_keys.fix(dst)
                rec = {'id': n, 'group': group, 'file': rel, 'clips': clip_list(dst)}
                if dropped:
                    rec['droppedChannels'] = dict(dropped)
                lists.append(rec)
                print(g, n, len(rec['clips']), 'clips',
                      'dropped', dict(dropped) if dropped else {}, flush=True)
        out[g] = {'base': '%s/%s_%s' % (g, g, BASE), 'lists': lists}
    json.dump(out, open(os.path.join(CONV, 'poses.json'), 'w', encoding='utf-8'), indent=1)


if __name__ == '__main__':
    main()
