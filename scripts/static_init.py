r"""Run MH4U static initialisers in an emulator and read back the memory they fill (the MH3U Armor Viewer's
mh3u_static_init.py, pointed at 4U's executable).

Some tables the game reads at run time are written at boot by C++ static initialisers, into .bss or
into .data the file leaves zero, from literal-pool constants. This runs that code on the executable's own
bytes (unicorn, ARM11 + VFP) and returns the memory, with every address it wrote.

    import static_init as S
    m = S.run(0xd4518c)             # one initialiser
    m.f32(0x109f6a0, 8)             # eight floats from a table it filled
    m.written                       # the set of word addresses it wrote

A call that leaves the code for a helper in `stubs` returns at once.
"""
import struct
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_CODE, UC_HOOK_MEM_WRITE, UcError
from unicorn.arm_const import UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_FPEXC, UC_ARM_REG_C1_C0_2

CODE = open(r'C:\MH4U-Extract\exefs\code.decompressed.bin', 'rb').read()
BASE = 0x100000
MEM_END = 0x01200000                      # the image ends near 0x10f0000; .bss runs past it
STACK, STACK_SIZE = 0x0f000000, 0x100000
RET = 0x0e800000                          # where an initialiser returns to: the run ends there


class Mem:
    def __init__(self, uc):
        self.uc = uc
        self.stub_calls = []
        self.written = set()

    def raw(self, va, n):
        return bytes(self.uc.mem_read(va, n))

    def u32(self, va, n=1):
        return list(struct.unpack('<%dI' % n, self.raw(va, 4 * n)))

    def f32(self, va, n=1):
        return list(struct.unpack('<%df' % n, self.raw(va, 4 * n)))


def machine(stubs=()):
    uc = Uc(UC_ARCH_ARM, UC_MODE_ARM)
    uc.mem_map(BASE, (MEM_END - BASE + 0xfff) & ~0xfff)
    uc.mem_write(BASE, CODE)
    uc.mem_map(STACK, STACK_SIZE)
    uc.mem_map(RET & ~0xfff, 0x1000)
    uc.reg_write(UC_ARM_REG_C1_C0_2, uc.reg_read(UC_ARM_REG_C1_C0_2) | (0xf << 20))
    uc.reg_write(UC_ARM_REG_FPEXC, 0x40000000)
    m = Mem(uc)

    def stub(uc, addr, size, _):
        m.stub_calls.append(addr)
        uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

    def wrote(uc, access, addr, size, value, _):
        if addr < STACK:
            for a in range(addr & ~3, addr + size, 4):
                m.written.add(a)

    for a in stubs:
        uc.hook_add(UC_HOOK_CODE, stub, begin=a, end=a)
    uc.hook_add(UC_HOOK_MEM_WRITE, wrote)
    return m


def run(entry, stubs=(), max_steps=5_000_000):
    m = machine(stubs)
    uc = m.uc
    uc.reg_write(UC_ARM_REG_SP, STACK + STACK_SIZE - 0x100)
    uc.reg_write(UC_ARM_REG_LR, RET)
    try:
        uc.emu_start(entry, RET, count=max_steps)
    except UcError as e:
        raise RuntimeError('emulation stopped at %#x: %s' % (uc.reg_read(UC_ARM_REG_PC), e))
    return m


INIT_ARRAY = (0xebee78, 0xebfd5c)         # RVCT's PREL32 init array: entry + word = the initialiser (found
                                          # by solving entry + word == 0xd4518c, the mount tables' initialiser)


def init_entries():
    out = []
    for va in range(INIT_ARRAY[0], INIT_ARRAY[1] + 4, 4):
        w = struct.unpack_from('<i', CODE, va - BASE)[0]
        out.append((va + w) & 0xffffffff)
    return out


def run_all(stubs=(), max_steps=5_000_000):
    """every static initialiser in the game's order, on one machine; one that stops is recorded in m.failed"""
    m = machine(stubs)
    m.failed = []
    uc = m.uc
    for entry in init_entries():
        uc.reg_write(UC_ARM_REG_SP, STACK + STACK_SIZE - 0x100)
        uc.reg_write(UC_ARM_REG_LR, RET)
        try:
            uc.emu_start(entry, RET, count=max_steps)
        except UcError as e:
            m.failed.append((entry, uc.reg_read(UC_ARM_REG_PC), str(e)))
    return m


def runs(written):
    """the written word addresses as [start, end) runs"""
    out, s = [], sorted(written)
    for a in s:
        if out and out[-1][1] == a:
            out[-1][1] = a + 4
        else:
            out.append([a, a + 4])
    return out
