"""THE MODE EACH ACTION DECLARES, by the motion it plays -- 4U's counterpart of the MHGU viewer's MODES table
(render/weapon-fx.js), read by running every action's start in the emulator instead of walking its paths.

A class's actions are reached through one dispatcher: a jump table on the action index, u16 player data +0x372,
whose entries tail-call an action start with a sub-index in r1 (the Switch Axe's 0xcaba38: 75 actions over 20-odd
start functions). A start at phase 0 (player data +5) sets its phase, declares the weapon drawn through the player's
virtual +0xc8 (+0x6f9 = 1), writes the class's FORM byte -- [player +0xa29c] +0, which the class's "is sword mode"
query, virtual +0xac (the Switch Axe's 0xcab958, the Charge Blade's 0xcc249c), reads back -- and sets its motion
(0xb0c038 / 0xb0c148 / 0xb08864: r1 = the motion id, bank << 8 | index; or a descriptor through 0xb23b70). Here each start runs on the weapon harness's stand-ins;
every call that leaves the class's code is answered 0 and recorded, the form byte's writes are recorded, and the
motion is the r1 of the first motion-setter call.

    python scripts/action_modes.py w08        -> {action: [sub, motion, form or None]}
"""
import json, os, struct, sys
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE, UcError
from unicorn.arm_const import UC_ARM_REG_PC, UC_ARM_REG_LR, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_SP
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import weapon_state as WS
import static_init as S

TEXT = (0x100000, 0x100000 + 0xcec0c4)
ACTION_INDEX = 0x372                     # player data: the action index the dispatcher switches on
PHASE = 5                                # player data: the action's phase (0 = starting)
MOTION_SETTERS = {0xb0c038, 0xb0c148, 0xb08864}
SEQUENCE = 0xb23b70                      # (player, descriptor*, ...): a start's move, from a 32-byte descriptor
# per class: (dispatcher, number of actions, the class's own code [start, end))
CLASSES = {8: (0xcaba38, 0x4b, (0xcab000, 0xcaf9c0)),     # the Switch Axe
           9: (0xcb03d8, 0x3c, (0xcaf9c0, 0xcb6000)),     # the Gunlance (Wyvern's Fire 0xcb1b98)
           14: (0xcc2a00, 0x4e, (0xcc2400, 0xcc8000))}    # the Charge Blade
WATCH = {0: 'form', 0x5c: 'cooldown'}          # [player +0xa29c] offsets whose writes are recorded


def walk(cls):
    disp, n, (lo, hi) = CLASSES[cls]
    h = WS.Harness()
    uc = h.uc
    out = {}
    state = {}

    def code(uc, addr, size, _):
        if lo <= addr < hi or addr == S.RET:
            return
        r1 = uc.reg_read(UC_ARM_REG_R1)
        state['calls'].append((addr, r1))
        m = None
        if addr in MOTION_SETTERS:
            m = r1 & 0xffff
        elif addr == SEQUENCE and WS.HEAP > r1 >= 0x100000:
            # a 32-byte descriptor of two 12-byte moves {u16 motion, u32 frame | flags, s32 blend}: the first unless r2
            # asks for the second or the first is 0xffff (0xb23b88)
            m0, m1 = struct.unpack_from('<H10xH', S.CODE, r1 - 0x100000)
            m = m0 if (uc.reg_read(UC_ARM_REG_R2) == 0 and m0 != 0xffff) else m1
            state['next'] = m1
        if m is not None:
            if state['motion'] is None:
                state['motion'] = m
            state['motions'].append(m)
        uc.reg_write(UC_ARM_REG_R0, state['answer'])
        uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

    def wrote(uc, access, addr, size, value, _):
        if addr == WS.PMOT:
            state['form'].append(value & 0xff)
        elif addr == WS.PMOT + 0x5c:
            state['cooldown'] = struct.unpack('<f', struct.pack('<I', value & 0xffffffff))[0]

    uc.hook_add(UC_HOOK_CODE, code, begin=TEXT[0], end=TEXT[1])
    uc.hook_add(UC_HOOK_MEM_WRITE, wrote, begin=WS.PMOT, end=WS.PMOT + 0x60)
    def run(a, phase, answer):
        h.setup(cls, 0, 1, 0x501, 0, False)
        uc.mem_write(WS.PDATA + ACTION_INDEX, struct.pack('<H', a))
        uc.mem_write(WS.PDATA + PHASE, bytes([phase, 0]))
        uc.mem_write(WS.PMOT, bytes([0xee]))          # neither form: a start that writes nothing leaves it
        state.update(calls=[], motion=None, motions=[], form=[], next=None, cooldown=None, answer=answer)
        h.calls = []
        uc.reg_write(UC_ARM_REG_SP, S.STACK + S.STACK_SIZE - 0x100)
        uc.reg_write(UC_ARM_REG_LR, S.RET)
        uc.reg_write(UC_ARM_REG_R0, WS.PLAYER)
        err = None
        try:
            uc.emu_start(disp, S.RET, count=200_000)
        except UcError as e:
            err = '%s at %#x' % (e, uc.reg_read(UC_ARM_REG_PC))
        return err

    for a in range(n):
        err = run(a, 0, 0)
        if state['motion'] is None:          # a start that asks something first (answered 0, it set nothing)
            err = run(a, 0, 1) or err
        drawn = [c[1] for c in h.calls if c[0] == 0xc8]
        out[a] = {'motion': state['motion'], 'next': state['next'], 'cooldown': state['cooldown'],
                  'form': state['form'][-1] if state['form'] else None,
                  'drawn': drawn[-1] if drawn else None, 'err': err,
                  'out': sorted({'%#x' % c[0] for c in state['calls']})}
        # LATER PHASES keep the start's declaration (as the MHGU viewer reads it): every motion they set, with the
        # calls out of the class answered 0 and then 1 (a frame test or a "motion ended" passing)
        later = set()
        for phase in range(1, 6):
            for answer in (0, 1):
                run(a, phase, answer)
                later.update(state['motions'])
        out[a]['later'] = sorted(later - {out[a]['motion']})
    return out


if __name__ == '__main__':
    cls = int(sys.argv[1][1:]) if len(sys.argv) > 1 else 8
    res = walk(cls)
    for a, r in res.items():
        m = r['motion']
        print('%2d motion %-6s form %-4s drawn %-4s %s%s' % (a, '%#x' % m if m is not None else '-', r['form'], r['drawn'],
              'cooldown %s ' % r['cooldown'] if r['cooldown'] is not None else '', r['err'] or ''))
