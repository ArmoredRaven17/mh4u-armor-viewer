"""MH4U's Guild Card title words and connectors -> docs/guild-card-titles.json (the shared viewer base's Guild Info,
base/ui/guild-panel.js; the same shape as the MHGU Armor Viewer's file).

The text is the game's own: GuildCard_eng (lobby message file 23 of the table at 0xf007e4), read by message id:
    742          (None)       the head of the word pool
    743 .. 1668  the title WORDS, in the file's order
    1669         (None)       the head of the connector pool
    1670 .. 1769  the CONNECTORS (words such as "of", "and", then symbols and the letters A-Z)
    1770 .. 2145  unlock texts (1770 = "Available from the start.") ("Reached Hunter Rank 6.", "Hunted 40 Diablos." ...)
The pools' ends are where the file's own sections change (1668 "Shonen" is followed by the connectors' "(None)"; 1769
"Z" by the first unlock text). Entries the file marks as unused ("Invalid Message", "DUMMY") are dropped.

EACH WORD'S UNLOCK TEXT is the game's own choice: the Guild Card's requirement line (0xa53204) takes the title id -- the
word's position, message 742 + id -- through a compare chain (ids below 0x47 -> 1770 "Available from the start.",
0x47-0x58 -> 1771, ... ids 0x100-0x1ec -> id + 0x5f7, ...; downloads -> 261 "Acquired via download.") and hands the
message to the text setter 0x298430(1, 23, msg). Here that chain runs in an emulator (unicorn) for every word.
Checked: Diablos -> "Hunted 20 Diablos.", Gogmazios -> "Slew 10 Gogmazios.", Kirin -> "Hunted 10 Kirin.". Connectors
carry no requirement text.

THE MENU'S ORDER AND PAGES: the title menu lists the words in the order of the u32 table at 0xeda8d0 (927 title ids, a
permutation of 0..926 starting with (None); read at 0xa52cd8), eight to a page -- the menu turns a position into page =
index >> 3 and row = index & 7 (0xa52d0c), and fills a page while its row is below 8 (0xa5d220 / 0xa5d2a8). The words
here are in that order.

    python scripts/build_guild_titles.py
"""
import json, os, struct

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(os.path.dirname(HERE), 'docs')
SRC = os.path.join(r'C:\MH4U-Extract', 'arcx', 'eng', 'data', 'core_lobby', 'eng', 'msg', 'lobby',
                   'GuildCard_eng.62440501')
WORDS = (743, 1668)          # inclusive message ids
JOINS = (1670, 1769)
NONE_WORD, NONE_JOIN = 742, 1669
UNUSED = {'Invalid Message', 'DUMMY', ''}


def messages(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'lmd\0', path
    nmsg, nops, nstr = struct.unpack_from('<3I', b, 8)
    oops, ostr = struct.unpack_from('<2I', b, 0x18)
    pool = []
    for i in range(nstr):
        p, n, _ = struct.unpack_from('<3I', b, ostr + 12 * i)
        pool.append(b[p:p + 2 * n].decode('utf-16-le'))
    out = []
    for i in range(nmsg):
        k = struct.unpack_from('<IHH', b, 0x24 + 8 * i)[1]
        s = ''
        while k != 0xffff and k < nops:
            op, arg = struct.unpack_from('<2I', b, oops + 16 * k)
            if op == 22:
                break
            if op == 1:
                s += pool[arg]
            k += 1
        out.append(s)
    return out


EXE = r'C:\MH4U-Extract\exefs\code.decompressed.bin'
REQ_CHAIN, TEXT_SET = 0xa53204, 0x298430
MENU_ORDER, MENU_COUNT = 0xeda8d0, 927           # u32 title ids, the title menu's order
TITLE_PAGE = 8                                    # the menu's entries to a page (0xa52d0c: index >> 3, index & 7)


def requirement_msgs(ids):
    """{title id: the message the Guild Card's requirement line shows}, by running 0xa53204 to 0x298430"""
    from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_CODE
    from unicorn.arm_const import UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_IP, UC_ARM_REG_SP
    code = open(EXE, 'rb').read()
    base, stack, data, ret = 0x100000, 0x8000000, 0x9000000, 0x7000000
    uc = Uc(UC_ARCH_ARM, UC_MODE_ARM)
    uc.mem_map(base, (len(code) + 0xfff) & ~0xfff)
    uc.mem_write(base, code)
    for a in (stack, data, ret):
        uc.mem_map(a, 0x10000)
    got = {}

    def hook(uc, addr, size, _):
        got['msg'] = uc.reg_read(UC_ARM_REG_R2)
        uc.emu_stop()
    uc.hook_add(UC_HOOK_CODE, hook, begin=TEXT_SET, end=TEXT_SET)
    out = {}
    for tid in ids:
        # the record: +0x14 - 8 = row 0, +0x18 = the title id; ip (the list's kind) 0 = the words; a frame for the pop
        uc.mem_write(data, bytes(0x100))
        uc.mem_write(data + 0x14, struct.pack('<I', 8))
        uc.mem_write(data + 0x18, struct.pack('<H', tid))
        uc.reg_write(UC_ARM_REG_R1, data)
        uc.reg_write(UC_ARM_REG_IP, 0)
        sp = stack + 0x8000
        uc.mem_write(sp, struct.pack('<II', 0, ret))
        uc.reg_write(UC_ARM_REG_SP, sp)
        got.clear()
        uc.emu_start(REQ_CHAIN, ret, count=5000)
        out[tid] = got['msg']
    return out


def main():
    m = messages(SRC)
    assert m[NONE_WORD] == '(None)' and m[NONE_JOIN] == '(None)', (m[NONE_WORD], m[NONE_JOIN])
    req = requirement_msgs(range(0, WORDS[1] - NONE_WORD + 1))
    code = open(EXE, 'rb').read()
    order = [struct.unpack_from('<I', code, MENU_ORDER - 0x100000 + 4 * k)[0] for k in range(MENU_COUNT)]
    assert sorted(order) == list(range(MENU_COUNT)), 'the menu order is not a permutation'
    words = [{'w': m[NONE_WORD + t], 'req': m[req[t]], 'id': 'msg_%d' % (NONE_WORD + t)}
             for t in order if t and m[NONE_WORD + t].strip() not in UNUSED]
    joins = [{'w': m[i], 'id': 'msg_%d' % i} for i in range(JOINS[0], JOINS[1] + 1) if m[i].strip() not in UNUSED]
    out = {
        'version': 1,
        'src': 'romfs eng/data/core_lobby.arc eng\\msg\\lobby\\GuildCard_eng (LMD), message ids 743-1668 (words) and '
               '1670-1769 (connectors); scripts/build_guild_titles.py',
        'order': "the title menu's order (u32 title ids at 0xeda8d0; title id = message - 742)",
        'pages': 'the title menu shows %d to a page (0xa52d0c)' % TITLE_PAGE,
        'note': None,
        'noneReq': m[req[0]],
        'req': "each word's unlock text is the one the Guild Card shows for it (0xa53204 run per title id = the "
               "word's position, message 742 + id)",
        'words': words,
        'joins': joins,
    }
    p = os.path.join(DOCS, 'guild-card-titles.json')
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    print(len(words), 'words,', len(joins), 'connectors ->', p)


if __name__ == '__main__':
    main()
