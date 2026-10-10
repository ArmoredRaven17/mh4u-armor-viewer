r"""Where MH4U puts each weapon part during a motion, frame by frame -- by running the game's own code (the MH3U
Armor Viewer's mh3u_weapon_state.py, ported).

    import weapon_state as WS
    h = WS.Harness()
    h.place(cls=8, part=0, model=1, motion=0x502, frame=10, sheathed=False)
        -> ({'state': 1, 'bone': 8, 'pos': [...], 'rot': [...], 'scale': 1.0, ...}, calls)

Each frame the game calls 0x34c5d8(callback) per weapon part (from the weapon unit's update, 0xb07d64). It takes the
part's STATE (by type, the motion id and the motion's frame -- 0x350438, frame tests through 0xb0b0b0 / 0xb064d4),
the hunter BONE for the state, the {pos, rot} record (0x3553b8) and the scale, writes them into the callback
(+0xc bone, +0x11 state, +0x108 scale, +0x118 pos, +0x128 rot), and tail-calls the type's joint code (0x35243c
sheathed, 0x34eac4 drawn). This runs that on stand-ins carrying the fields the code reads -- found by running it:
an unmapped read stops the run and names the address.

  player        [+0] a vtable whose methods answer from `self.answers` (+0x84 the motion id, bank << 8 | index:
                banks 0-4 = co_0, co_1, co_2, -, co_4 in the field, 5 = the class's wNN list -- the list table
                at 0xef50e0), +0x284 the motion's frame (float), +0xe30 the player data
  player data   +0x30 the sheathed flag, +0x31 the class, +0x34 gender, +0x1c0 the weapon item {type, -, u16 id}
  weapon unit   the callback is embedded at +0xe30: +4 the player, +0x10 the part type
and the boot-time memory filled by every static initialiser first (static_init.run_all).
"""
import struct
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import static_init as S
from unicorn import UcError, UC_HOOK_CODE, UC_HOOK_MEM_UNMAPPED
from unicorn.arm_const import (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP,
                               UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_S0)

PLACE = 0x34c5d8
REQUEST = 0x351798                     # the joint code sampling a weapon motion (see _request)
TIMED = 0x3541c0                       # the same on the motion's own clock (see _timed)
HEAP = 0x20000000
PLAYER, PDATA, WOBJ, VT, STUB = HEAP, HEAP + 0x10000, HEAP + 0x30000, HEAP + 0x50000, HEAP + 0x51000
PMOT = HEAP + 0x60000                 # [player +0xa29c]: an object whose +0x5c float, +0x174 / +0x514 bytes are read
JTAB = HEAP + 0x62000                 # the weapon-motion slots' joint tables (player data +0x5bf8 + 0x10f8 * slot, +0x224 / +0x228)
STUB_N = 0x400
# the per-slot weapon models in the player data (0x351798's slot structures): slot k at +0x5bf8 + 0x10f8 * k
SLOT0, SLOT_STRIDE, MASK_BYTES = 0x5bf8, 0x10f8, 0x10
CB = WOBJ + 0xe30
TYPES = {0: [0], 1: [1, 2], 2: [3], 3: [4, 10], 4: [5], 6: [5], 7: [8, 18], 8: [9],
         9: [11, 16], 10: [12, 19], 11: [13, 14], 12: [15], 13: [17, 22], 14: [20, 21]}
# pointers to game singletons the placement code dereferences: [0xfb6b7c] +0x2b (a game mode; 2 = one where
# the weapon is hidden), [0xedbe90] +0x6c
SINGLETONS = [0xfb6b7c, 0xedbe90, 0x105718c]
SINGLETONS_AT = 0x30000000
ITEM_TYPE = {0: 7, 1: 8, 2: 9, 3: 10, 6: 11, 4: 12, 7: 13, 8: 14, 9: 15, 10: 16, 11: 17, 12: 18, 13: 19, 14: 20}


def f32(u):
    return struct.unpack('<f', struct.pack('<I', u & 0xffffffff))[0]


class Harness:
    def __init__(self, trace=False):
        self.m = S.run_all()
        self.uc = uc = self.m.uc
        uc.mem_map(HEAP, 0x100000)
        self.answers = {}                     # vtable offset -> the value the method returns
        self.calls = []                       # (vtable offset, r1, r2, r3) of every method called
        # every vtable slot points at its own stub word; a hook answers and returns
        for k in range(STUB_N):
            uc.mem_write(VT + 4 * k, struct.pack('<I', STUB + 4 * k))
        uc.hook_add(UC_HOOK_CODE, self._stub, begin=STUB, end=STUB + 4 * STUB_N)
        self.trace = trace
        self.requests = []
        uc.hook_add(UC_HOOK_CODE, self._request, begin=REQUEST, end=REQUEST)
        uc.hook_add(UC_HOOK_CODE, self._timed, begin=TIMED, end=TIMED)
        # the singletons the code reads, each a zeroed stand-in (0 = the normal game mode, no special state)
        uc.mem_map(SINGLETONS_AT, 0x10000 * len(SINGLETONS))
        for i, va in enumerate(SINGLETONS):
            uc.mem_write(va, struct.pack('<I', SINGLETONS_AT + 0x10000 * i))
        # [0x105718c] +0x5c: the frame step the weapon code's own timers advance by each update (one frame)
        uc.mem_write(SINGLETONS_AT + 0x10000 * SINGLETONS.index(0x105718c) + 0x5c, struct.pack('<f', 1.0))

    def _stub(self, uc, addr, size, _):
        off = addr - STUB
        self.calls.append((off, uc.reg_read(UC_ARM_REG_R1), uc.reg_read(UC_ARM_REG_R2), uc.reg_read(UC_ARM_REG_R3)))
        uc.reg_write(UC_ARM_REG_R0, self.answers.get(off, 0))
        uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

    def _request(self, uc, addr, size, _):
        """0x351798(callback, weapon motion, slot, frame): the joint code sampling one of the weapon's own motions
        (the wgNN list the callback holds at +0x27c) onto its joints; 0xff = none"""
        s0 = struct.unpack('<f', struct.pack('<I', uc.reg_read(UC_ARM_REG_S0)))[0]
        m = uc.reg_read(UC_ARM_REG_R1) & 0xff
        if m != 0xff:
            self.requests.append([m, uc.reg_read(UC_ARM_REG_R2) & 0xff, round(s0, 3)])

    def _timed(self, uc, addr, size, _):
        """0x3541c0(callback, weapon motion, timer*, slot): a weapon motion on its OWN clock -- the frame is the float
        at timer, which the call advances by the frame delta ([0x105718c] +0x5c) while it is below 0 and samples once
        it is not. Recorded like 0x351798's requests, at the frame it samples. The Gunlance's joint 2 (0x34d690) is
        the WYVERN'S FIRE READY CLICK: while the cooldown runs (the player's +0xa29c object, +0x5c: 7200 frames, 5400 /
        4800 with Artillery, set at 0xcb1b98) it samples its motion at frame 0 (= bind); on the frame the cooldown
        ends it plays a sound (0x2fcc34(2, 9)) and runs the motion from frame 5 back to 0 (0x34dabc: 5 - the time
        since). So it rests on frame 0 in every clip"""
        m = uc.reg_read(UC_ARM_REG_R1) & 0xff
        t = struct.unpack('<f', bytes(uc.mem_read(uc.reg_read(UC_ARM_REG_R2), 4)))[0]
        # it samples the motion at the timer's value, and only once that is >= 0 (0x3541f4)
        if m != 0xff and t >= 0:
            frames, loop = getattr(self, 'wframes', {}).get(m, (None, -1))
            self.requests.append([m, uc.reg_read(UC_ARM_REG_R3) & 0xff, round(min(t, frames) if frames else t, 3)])
            # then the clock moves on by the frame delta and wraps to the loop start past the end (0x354378; the
            # stand-in motion list makes the call return before it gets there, so it is done here). Without a loop it
            # runs on and the sample holds the last frame. `wframes`: {motion: (frames, loop)} from the wgNN list
            t += 1.0
            if frames and loop >= 0 and t > frames:
                t = t - frames + loop
            uc.mem_write(uc.reg_read(UC_ARM_REG_R2), struct.pack('<f', t))

    def setup(self, cls, part, wid, motion, frame, sheathed, hold=None, gender=1, model=0, fresh=True):
        uc = self.uc
        mode = getattr(self, 'mode', 0)
        ms = MODE_STATE.get(cls, {}).get(mode, {})
        flag = ms.get('flag', 0)
        t = TYPES[cls][part]
        uc.mem_write(PLAYER, bytes(0x10000))
        uc.mem_write(PLAYER, struct.pack('<I', VT))
        # the motion's frame: +0x284 for the frame tests (0xb064d4), +0x290 for the weapon motions (0x34eac4)
        uc.mem_write(PLAYER + 0x284, struct.pack('<f', float(frame)))
        uc.mem_write(PLAYER + 0x290, struct.pack('<f', float(frame)))
        uc.mem_write(PLAYER + 0xe30, struct.pack('<I', PDATA))
        uc.mem_write(PMOT, bytes(0x2000))
        uc.mem_write(PLAYER + 0xa29c, struct.pack('<I', PMOT))
        uc.mem_write(PDATA, bytes(0x20000))
        uc.mem_write(PDATA + 0x30, bytes([1 if sheathed else 0, cls]))
        uc.mem_write(PDATA + 0x34, bytes([gender]))
        # +0x6f9: the weapon's MODE (0xb07e58 tests it == 1: the Switch Axe's sword / the Charge Blade's axe -- TBC)
        uc.mem_write(PDATA + 0x6f9, bytes([flag]))
        uc.mem_write(PDATA + 0x1c0, bytes([ITEM_TYPE[cls], 0]) + struct.pack('<H', wid))
        uc.mem_write(JTAB, bytes([0xff]) * 0x1000)
        for slot in range(3):
            uc.mem_write(PDATA + 0x5bf8 + 0x10f8 * slot + 0x224, struct.pack('<II', JTAB, JTAB))
            # the slot's weapon model PART MASK (+0x108, one bit per mesh part, as 3U's uModel +0x108): every
            # part on, as a model starts; the joint code clears and sets bits (the Charge Blade in sword mode:
            # bic 0x14 / orr 2 -- the axe-mode blade 2 and housing 4 off, the sword blade 1 on)
            uc.mem_write(PDATA + SLOT0 + SLOT_STRIDE * slot + 0x108, bytes([0xff]) * MASK_BYTES)
        # the weapon unit keeps what its code wrote from frame to frame (mode bytes such as +0x267), as in the
        # game; a timeline starts it fresh
        if fresh:
            uc.mem_write(WOBJ, bytes(0x20000))
            uc.mem_write(WOBJ, struct.pack('<I', VT))
        uc.mem_write(CB + 4, struct.pack('<I', PLAYER))
        uc.mem_write(CB + 0x10, bytes([t]))
        # +0x264 the weapon's MODEL: the joint code reads per-model tables with it (the Switch Axe's
        # 0xdf8251 / 0xdf82b9 pick its block of weapon motion ids at 0xdf80d7)
        uc.mem_write(CB + 0x264, struct.pack('<H', model))
        # +0x84 the motion id; +0xa0 the HOLD STATE (0x350438 returns it on its default path): what the motion's
        # group-0 events set (hold_state) -- 1, the main grip, with none
        h = (0 if sheathed else 1) if hold is None else hold
        # THE CHARGE BLADE IN AXE MODE holds in state 9, not 1 (the main grip): the MHGU viewer's rule for its CB
        # (index17Rule: axe -> index 14, which 4U's state 9 is -- both the hand and both kept by the shield's rule,
        # GU typeIndexRule '22' / 4U 0x34c6e8), and 4U's CB records for state 9 put the shield 56 cm along the sword
        if cls == 14 and flag == 1 and h == 1:
            h = 9
        self.answers = {0x84: motion, 0xa0: h}
        # POKES: extra state for a class's own code, {(object, offset): bytes} -- object 'pmot' (the player's +0xa29c
        # object: the Gunlance's shells +0x514 / capacity +0x515 and the float +0x5c), 'pdata', 'player'
        for (obj, off), val in dict(ms.get('pokes', {}), **getattr(self, 'pokes', {})).items():
            uc.mem_write({'pmot': PMOT, 'pdata': PDATA, 'player': PLAYER}[obj] + off, val)
        self.calls = []
        self.requests = []

    def place(self, cls, part, wid, motion, frame, sheathed, hold=None, model=0, fresh=True):
        uc = self.uc
        self.setup(cls, part, wid, motion, frame, sheathed, hold, model=model, fresh=fresh)
        uc.reg_write(UC_ARM_REG_SP, S.STACK + S.STACK_SIZE - 0x100)
        uc.reg_write(UC_ARM_REG_LR, S.RET)
        uc.reg_write(UC_ARM_REG_R0, CB)
        try:
            uc.emu_start(PLACE, S.RET, count=2_000_000)
        except UcError as e:
            raise RuntimeError('stopped at %#x: %s (class %d part %d motion %#x frame %s)'
                               % (uc.reg_read(UC_ARM_REG_PC), e, cls, part, motion, frame))
        raw = bytes(uc.mem_read(CB, 0x300))
        sc = struct.unpack_from('<3f', raw, 0x108)
        pos = struct.unpack_from('<3f', raw, 0x118)
        rot = struct.unpack_from('<3f', raw, 0x128)
        out = {'state': raw[0x11], 'bone': struct.unpack_from('<I', raw, 0xc)[0],
               'pos': [round(x, 4) for x in pos], 'rot': [round(x, 4) for x in rot], 'scale': round(sc[0], 4)}
        if self.requests:
            out['wmot'] = self.requests
        # the parts each slot's mask leaves OFF (slot = the part index the code drives, as the motion requests)
        hide = {}
        for slot in range(3):
            m = bytes(uc.mem_read(PDATA + SLOT0 + SLOT_STRIDE * slot + 0x108, MASK_BYTES))
            off = [i for i in range(MASK_BYTES * 8) if not (m[i >> 3] >> (i & 7)) & 1]
            if off:
                hide[str(slot)] = off
        if hide:
            out['hide'] = hide
        return out, list(self.calls)

    def timeline(self, cls, part, wid, motion, f0, frames, sheathed, events=None, model=0):
        """The placement on every frame of a clip (its frames 0 .. frames; the motion's own frame f0 + k), as
        segments {f, ...} that start where anything changes. `events`: the clip's group-0 event timeline
        [[seconds, [ids]], ...] (lmt_to_json), which sets the hold state. `wmot` lists the weapon motions the code
        samples, in order, each [motion, slot, frame at the segment start, rate]: the frame moves by `rate` per
        hunter frame (1 = with the hunter, 0 = held), so a layer that keeps its pace is one segment."""
        out, cur = [], None
        # WARM-UP: the weapon unit's own timers run on before the clip, in the drawn idle (Motion[1], 0x501) that comes
        # before an action -- the Gunlance's cooling vent stands open, and a timer an action starts from 0 (the Hunting
        # Horn's recital, 0x34fc00) has been reset by the idle. A sheathed weapon warms up on its own motion
        for w in range(WARMUP):
            self.place(cls, part, wid, motion if sheathed else 0x501, 0 if not sheathed else f0, sheathed, None,
                       model, fresh=(w == 0))
        for k in range(0, int(frames) + 1):
            hold = hold_state(events, (f0 + k) / FPS) if events is not None else None
            pl, _ = self.place(cls, part, wid, motion, f0 + k, sheathed, hold, model, fresh=False)
            if cur is not None and continues(cur, pl, k):
                continue
            cur = dict(pl, f=k)
            if 'wmot' in cur:
                cur['wmot'] = [w + [None] for w in cur['wmot']]       # the rate, set by the next frame
            out.append(cur)
        for seg in out:
            for w in seg.get('wmot', []):
                if w[3] is None:
                    w[3] = 1                     # a one-frame segment: the hunter's pace
        return out

FPS = 60
# A CLASS'S STATES that carry over from action to action, which no clip declares: {class: {mode: {flag, pokes}}}, the
# viewer's per-class select (mode 0 = none of these). `flag` is player data +0x6f9 (0xb07e58 tests it == 1): the
# class's other form, set by actions in every class's code through the player's virtual +0xc8 (0xb29f20; on 0 the
# Switch Axe's 0xcab934 and the Charge Blade's 0xcc2478 reset their [+0xa29c] +0 byte) -- the Switch Axe's sword, the
# Charge Blade's axe. `pokes` as Harness.pokes: the Gunlance's Wyvern's Fire cooldown ([+0xa29c] +0x5c, 7200 frames)
WF_COOLDOWN = struct.pack('<f', 7200.0)
MODE_STATE = {8: {1: {'flag': 1}}, 14: {1: {'flag': 1}},
              9: {1: {'pokes': {('pmot', 0x5c): WF_COOLDOWN}}}}
# (the Hunting Horn reads the flag too -- with it, and the hold state not 2, its block's first motion instead of its
# sixth outside the recital (0x34fae0) -- but which of its actions set it is not read, so it is left at 0)
WARMUP = 30
# GROUP-0 EVENT ID -> HOLD STATE: the MHGU Armor Viewer's priority list (its mount-rom.js indexByState, read from
# MHGU's 0x00288008), whose "index" is 4U's state number -- the two agree on every bone (GU jointForIndex = 4U's
# 0x34c7b0) and on the Dual Blades rule (GU: id 3 -> index 0 for the second blade; 4U: 0x350438 type 14).
# 4U's own reader of these ids (the player's virtual +0xa0) is not traced: INFERRED. Ids not listed (10, and the
# Charge Blade's 8) leave the state as it is.
HOLD_BY_ID = [(7, 8), (6, 7), (5, 6), (4, 5), (1, 0), (2, 2), (3, 1)]     # in priority order


def hold_state(events, t):
    ids = set()
    for at, now in events or []:
        if at <= t + 1e-6:
            ids = set(now)
    for i, st in HOLD_BY_ID:
        if i in ids:
            return st
    return 1


def continues(seg, pl, k):
    """does frame k's placement carry segment `seg` on: the same placement, and every weapon-motion layer at its
    segment rate (the first frame after the start sets that rate)"""
    for key in ('state', 'bone', 'pos', 'rot', 'scale', 'hide'):
        if seg.get(key) != pl.get(key):
            return False
    wa, wb = seg.get('wmot') or [], pl.get('wmot') or []
    if len(wa) != len(wb):
        return False
    dk = k - seg['f']
    for x, y in zip(wa, wb):
        if x[0] != y[0] or x[1] != y[1]:
            return False
        step = (y[2] - x[2]) / dk
        if x[3] is None:
            if abs(step - round(step, 3)) > 1e-3:
                return False
        elif abs(step - x[3]) > 1e-3:
            return False
    for x, y in zip(wa, wb):
        if x[3] is None:
            x[3] = round((y[2] - x[2]) / dk, 3)
    return True
