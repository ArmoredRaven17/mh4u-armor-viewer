"""JOINT COVERAGE: the skinned joints of each weapon model that no weapon motion the stances request ever tracks,
per class / part / joint id, with the models -- the per-class work list (a joint the game moves only outside any
clip, as the Gunlance's cooling vent, shows here until a state covers it). python scripts/joint_coverage.py [wNN ...]"""
import json, os, re, sys
from collections import defaultdict
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import mtlib

W = json.load(open(os.path.join(ROOT, 'docs', 'weapons.json')))
only = sys.argv[1:]


def gid(name):
    m = re.match(r'^\d+:(\d+)', name or '')
    return int(m.group(1)) if m else None


for c in W['classes']:
    key = 'w%02d' % c['cls']
    if only and key not in only:
        continue
    sp = os.path.join(ROOT, 'docs', 'stances', key + '.json')
    if not os.path.exists(sp):
        continue
    S = json.load(open(sp))
    js, _ = mtlib.glb_read(os.path.join(ROOT, 'docs', S['weapon']['file']))
    tracked = {}
    for a in js['animations']:
        m = int(re.match(r'Motion\[(\d+)\]', a['name']).group(1))
        tracked[m] = {gid(js['nodes'][ch['target']['node']].get('name')) for ch in a['channels']}
    report = defaultdict(list)          # (part, gid) -> models
    for v, g in S['variants'].items():
        req = defaultdict(set)          # slot -> motions
        def take(tl):
            for k, segs in enumerate(tl):
                for sg in segs:
                    for w in sg.get('wmot', []):
                        req[w[1]].add(w[0])
        for cl in S['clips'].values():
            for setk in [k for k in cl if k == 'v' or re.match(r'm\d+$', k)]:
                take(cl[setk][v])
        take(S['rest'][v])
        for mode in (S.get('idle') or {}).values():
            for slot, ws in mode.get(v, {}).items():
                for w in ws:
                    req[int(slot)].add(w[0])
        for k, part in enumerate(c['parts']):
            moved = set().union(*[tracked.get(m, set()) for m in req[k]]) if req[k] else set()
            for model in g['models']:
                p = os.path.join(ROOT, 'docs', 'models', 'weapons', c['dir'], '%s%03d.glb' % (part, model))
                if not os.path.exists(p):
                    continue
                mj, _ = mtlib.glb_read(p)
                for j in mtlib.joints_of(mj):
                    if j['gid'] not in (None, 0) and j['gid'] not in moved:
                        report[(part, j['gid'])].append(model)
    print(key, c['name'], '-' if not report else '')
    for (part, gd), ms in sorted(report.items()):
        print('   %s joint %d: %d models %s' % (part, gd, len(ms), ms[:12]))
