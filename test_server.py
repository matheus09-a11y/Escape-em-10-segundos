#!/usr/bin/env python3
"""Teste de integração do servidor: sobe server.py numa porta livre e joga a fase 1 com 3 clientes WebSocket reais
(só biblioteca padrão). Também testa HTTP estático, erros e reconexão. Uso: python3 test_server.py"""
import asyncio, base64, hashlib, json, os, secrets, struct, subprocess, sys, time, math

PORT = 8799
FAILS = []
def check(name, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: FAILS.append(name)

class WS:
    def __init__(self): self.q = asyncio.Queue(); self.snap = None; self.level = None; self.room = None; self.events = []; self.you = None; self.token = None; self.code = None
    async def connect(self, origin=None):
        self.r, self.w = await asyncio.open_connection("127.0.0.1", PORT)
        key = base64.b64encode(os.urandom(16)).decode()
        extra = f"Origin: {origin}\r\n" if origin else ""
        self.w.write(f"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n{extra}\r\n".encode())
        head = await self.r.readuntil(b"\r\n\r\n")
        self.status = head.split(b"\r\n")[0].decode()
        if "101" not in self.status: return False
        want = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        assert want in head, "accept errado"
        self.task = asyncio.ensure_future(self.loop())
        return True
    def raw(self, op, payload):
        mask = os.urandom(4); n = len(payload)
        h = bytes([0x80 | op]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n)) + mask
        self.w.write(h + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
    def send(self, **m): self.raw(1, json.dumps(m).encode())
    async def loop(self):
        try:
            while True:
                h = await self.r.readexactly(2); op = h[0] & 15; n = h[1] & 127
                if n == 126: n = struct.unpack(">H", await self.r.readexactly(2))[0]
                elif n == 127: n = struct.unpack(">Q", await self.r.readexactly(8))[0]
                p = await self.r.readexactly(n)
                if op == 8: self.closed = True; return
                if op != 1: continue
                m = json.loads(p)
                t = m.get("t")
                if t == "s": self.snap = m
                elif t == "level":
                    self.level = m; self.levels_seen = getattr(self, "levels_seen", 0) + 1
                    if not getattr(self, "noload", False): self.send(t="loaded")   # como um navegador de verdade: avisa que carregou
                elif t == "room": self.room = m
                elif t == "joined": self.you, self.token, self.code = m["you"], m["token"], m["code"]
                elif t == "ev": self.events.append(m["e"]); self.evs = getattr(self, "evs", []) + [m]
                await self.q.put(m)
        except Exception: pass
    async def expect(self, t, timeout=3):
        end = time.monotonic() + timeout
        while True:
            left = end - time.monotonic()
            if left <= 0: return None
            try: m = await asyncio.wait_for(self.q.get(), left)
            except asyncio.TimeoutError: return None
            if m.get("t") == t: return m

async def http(path, method="GET", raw=None):
    r, w = await asyncio.open_connection("127.0.0.1", PORT)
    w.write(raw or f"{method} {path} HTTP/1.1\r\nHost: x\r\n\r\n".encode())
    data = await asyncio.wait_for(r.read(-1), 5); w.close()
    return data

async def duo_room(level_mid="duo-1", limit=60):
    """Sala de Dupla pronta e em jogo: devolve (anfitrião, parceiro). O parceiro fica parado e só mantém a conexão viva."""
    h, q = WS(), WS()
    await h.connect(); await q.connect(); await h.expect("hi"); await q.expect("hi")
    h.send(t="create", name="Host"); j = await h.expect("joined")
    q.send(t="join", code=j["code"], name="Par"); await q.expect("joined")
    h.send(t="size", n=2); await asyncio.sleep(0.15)
    h.send(t="limit", v=limit); h.send(t="level", mid=level_mid); await asyncio.sleep(0.15)
    h.send(t="ready", v=True); q.send(t="ready", v=True); await asyncio.sleep(0.15)
    h.send(t="start")
    for _ in range(80):
        if h.snap and h.snap["ph"] == "play": break
        await asyncio.sleep(0.1)
    return h, q

async def main():
    here = os.path.dirname(os.path.abspath(__file__))
    env = dict(os.environ, PORT=str(PORT), HOST="127.0.0.1", REQUIRE_BUILD="0")
    srv = subprocess.Popen([sys.executable, "server.py"], cwd=here, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try: await http("/health"); break
            except OSError: await asyncio.sleep(0.1)
        print("HTTP")
        d = await http("/health"); check("/health responde ok", b'"ok":true' in d, d[:100])
        d = await http("/"); check("/ serve index.html", d.startswith(b"HTTP/1.1 200") and b"Dez segundos" in d)
        d = await http("/game.js"); check("serve .js com tipo certo", b"application/javascript" in d.split(b"\r\n\r\n")[0])
        for bad in ("/server.py", "/coop_sim.py", "/../server.py", "/%2e%2e/server.py", "/tools/x", "/.git/config", "/test_server.py"):
            d = await http(bad); check(f"bloqueia {bad}", d.startswith(b"HTTP/1.1 404"), d[:40])
        d = await http("/", method="POST"); check("POST recusado (405)", d.startswith(b"HTTP/1.1 405"))
        d = await http("", raw=b"lixo\r\n\r\n"); check("requisição malformada não derruba", True)
        d = await http("/health"); check("servidor segue vivo depois de lixo", b'"ok":true' in d)

        print("WebSocket e salas")
        a, b, c = WS(), WS(), WS()
        for x in (a, b, c): check("handshake 101", await x.connect())
        hi = await a.expect("hi"); cat = hi["levels"]; BYMID = {x["mid"]: k for k, x in enumerate(cat)}; check("hello traz catálogo de fases e papéis", hi and len(hi["levels"]) == 56 and set(hi["roles"]) == {"brasa", "onda", "folha"})
        b.send(t="join", code="ZZZZ", name="x"); e = await b.expect("err"); check("sala inexistente dá erro", e and "não encontrada" in e["msg"])
        a.send(t="create", name="Ana", skin="robot"); j = await a.expect("joined"); check("criar sala devolve código de 4 letras", j and len(j["code"]) == 4 and j["you"] == 0)
        code = j["code"]
        b.send(t="join", code=code.lower(), name="Bia", skin="<script>"); j = await b.expect("joined"); check("entrar com o código (minúsculas)", j and j["you"] == 1)
        a.send(t="start"); e = await a.expect("err"); check("não começa com 2 jogadores", e and "3 jogadores" in e["msg"])
        c.send(t="join", code=code, name="<b>Caio</b>"); j = await c.expect("joined"); check("terceiro entra", j and j["you"] == 2)
        d4 = WS(); await d4.connect(); d4.send(t="join", code=code, name="Dani"); e = await d4.expect("err"); check("quarto jogador é recusado (sala cheia)", e and "cheia" in e["msg"])
        await asyncio.sleep(0.2)
        check("skin válida é repassada e inválida vira explorer", c.room and [p["skin"] for p in c.room["players"]] == ["robot", "explorer", "explorer"], c.room)
        c.send(t="skin", id="ninja"); await asyncio.sleep(0.15)
        check("jogador troca a própria skin", a.room["players"][2]["skin"] == "ninja")
        check("nomes são limpos (sem < >)", c.room and c.room["players"][2]["name"] == "bCaiob" or (c.room and "<" not in c.room["players"][2]["name"]), c.room)
        a.send(t="role", role="brasa"); b.send(t="role", role="brasa"); await asyncio.sleep(0.2)
        e = await b.expect("err"); check("papel repetido é recusado", e and "já foi escolhido" in e["msg"])
        b.send(t="role", role="onda"); c.send(t="role", role="folha"); await asyncio.sleep(0.2)
        b.send(t="start"); e = await b.expect("err", 0.5); check("só o anfitrião começa (silencioso)", e is None and (a.level is None))
        a.send(t="level", n=99); a.send(t="level", n="x"); await asyncio.sleep(0.1)
        check("fase inválida ignorada", a.room["level"] == 0)
        await asyncio.sleep(0.2)
        while not a.q.empty(): a.q.get_nowait()
        a.send(t="start"); e = await a.expect("err"); check("não começa sem todos prontos", e and "prontos" in e["msg"], e)
        for x in (a, b, c): x.send(t="ready", v=True)
        await asyncio.sleep(0.2)
        check("todos veem quem está pronto", all(p and p["ready"] for p in a.room["players"]), a.room)
        a.send(t="start"); await asyncio.sleep(0.5)
        check("todos recebem a fase ao começar", all(x.level and x.level["n"] == 0 for x in (a, b, c)))
        check("papéis chegam na ordem das vagas", a.level["roles"] == [["brasa"], ["onda"], ["folha"]])

        print("Jogando a fase 1 com 3 clientes")
        for _ in range(60):
            if a.snap and a.snap["ph"] == "play": break
            await asyncio.sleep(0.1)
        check("contagem termina e o jogo começa", a.snap and a.snap["ph"] == "play", a.snap)
        route = [(200, 250), (450, 250), (730, 250)]
        async def bot(x, slot):
            for tx, ty in route:
                for _ in range(400):
                    s = x.snap
                    if s["ph"] == "won": return
                    px, py = s["p"][slot][0], s["p"][slot][1]
                    d = math.hypot(tx - px, ty - py)
                    if d < 12: break
                    x.send(t="in", x=(tx - px) / d, y=(ty - py) / d)
                    await asyncio.sleep(0.05)
            x.send(t="in", x=0, y=0)
        t0 = time.monotonic()
        await asyncio.gather(bot(a, 0), bot(b, 1), bot(c, 2))
        for _ in range(60):
            if a.snap["ph"] == "won": break
            await asyncio.sleep(0.1)
        check("vitória detectada pelo servidor", a.snap["ph"] == "won", a.snap)
        check("eventos de chave e vitória chegaram", any(e[0] == "key" for e in a.events) and any(e[0] == "win" for e in a.events), a.events[-5:])
        check("todos chegaram à porta (3 escapados)", all(p[2] == 1 for p in a.snap["p"]), a.snap["p"])
        print(f"         partida de verdade levou {time.monotonic()-t0:.1f}s")
        b.send(t="next"); await asyncio.sleep(0.3); check("só o anfitrião avança de fase (manual)", a.level["n"] == 0)
        for _ in range(40):
            if a.level["n"] == 1: break
            await asyncio.sleep(0.1)
        check("avança sozinho para a fase 2 depois da vitória", a.level["n"] == 1 and b.level["n"] == 1 and c.level["n"] == 1, a.level["n"])

        print("Entradas e abuso")
        a.send(t="in", x="abc", y=None); a.send(t="in", x=1e99, y=float("inf")); await asyncio.sleep(0.2)
        check("entradas absurdas não derrubam o servidor", b'"ok":true' in await http("/health"))
        a.raw(1, b"{nao e json"); a.raw(1, b"[1,2,3]"); a.raw(1, b'{"t":"zzz"}'); await asyncio.sleep(0.2)
        check("JSON inválido/desconhecido é ignorado", not getattr(a, "closed", False))
        spam = WS(); await spam.connect()
        for _ in range(400):
            if spam.w.is_closing(): break
            spam.send(t="ping", ts=1)
            if _ % 50 == 49: await asyncio.sleep(0)
        await asyncio.sleep(0.5)
        check("quem inunda de mensagens é desconectado", getattr(spam, "closed", False) or spam.task.done())
        big = WS(); await big.connect(); big.raw(1, b"x" * 5000); await asyncio.sleep(0.3)
        check("mensagem enorme derruba só aquela conexão", b'"ok":true' in await http("/health"))
        await http("", raw=b"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
        check("handshake sem chave não derruba", b'"ok":true' in await http("/health"))

        print("Queda e volta")
        tok, sl = c.token, c.you
        stop_before = len([1 for _ in [0]])
        c.w.close(); await asyncio.sleep(0.5)
        st = await a.expect("stopped", 1)
        check("quando alguém cai a partida é encerrada e o grupo volta ao lobby com o motivo", st is not None and "desconectou" in st["why"] and a.room["phase"] == "lobby", st)
        check("quem caiu aparece como desconectado e ninguém fica pronto", a.room["players"][2]["on"] is False and not any(p["ready"] for p in a.room["players"] if p), a.room)
        a.send(t="start"); e = await a.expect("err"); check("não começa com participante ausente", e is not None and a.room["phase"] == "lobby", e)
        c2 = WS(); await c2.connect(); c2.send(t="rejoin", code=code, token="errado"); e = await c2.expect("err"); check("token errado não entra", e is not None)
        c3 = WS(); await c3.connect(); c3.send(t="rejoin", code=code, token=tok); j = await c3.expect("joined")
        check("com o token volta para a mesma vaga (no lobby)", j and j["you"] == sl and j.get("back"))
        await asyncio.sleep(0.3)
        check("depois de voltar todos estão conectados no lobby", all(p and p["on"] for p in a.room["players"]) and a.room["phase"] == "lobby", a.room)
        b.send(t="leave"); await asyncio.sleep(0.3)
        check("quem sai libera a vaga", a.room["players"][1] is None)
        a.send(t="leave"); c3.send(t="leave"); await asyncio.sleep(0.3)
        print("Modalidade Dupla: capacidade 2, mapas só de dupla, troca segura")
        p1, p2, p3 = WS(), WS(), WS()
        for x in (p1, p2, p3): await x.connect(); await x.expect("hi")
        p1.send(t="create", name="Ana"); j = await p1.expect("joined"); code2 = j["code"]
        check("sala nova começa em Trio (3) e mostra a modalidade a todos", p1.room and p1.room["size"] == 3 and "Trio" in p1.room["modality"], p1.room)
        p2.send(t="join", code=code2, name="Bia"); await p2.expect("joined")
        p2.send(t="size", n=2); await asyncio.sleep(0.15); check("só o anfitrião muda a modalidade", p1.room["size"] == 3)
        for bad in (1, 4, 0, -2, "x", None, 2.5, True):
            p1.send(t="size", n=bad)
        await asyncio.sleep(0.3)
        check("modalidades inválidas (1, 4, texto, decimal, booleano) são recusadas", p1.room["size"] == 3)
        while not p1.q.empty(): p1.q.get_nowait()
        p3.send(t="join", code=code2, name="Caio"); await p3.expect("joined"); await asyncio.sleep(0.15)
        p1.send(t="size", n=2); e = await p1.expect("err"); check("com 3 participantes presentes não dá para virar Dupla (explica o motivo)", e and "alguém precisa sair" in e["msg"] and p1.room["size"] == 3, e)
        p3.send(t="leave"); await asyncio.sleep(0.3)
        p1.send(t="level", mid="classic-1"); await asyncio.sleep(0.1); p1.send(t="ready", v=True); p2.send(t="ready", v=True); await asyncio.sleep(0.2)
        p1.send(t="size", n=2); await asyncio.sleep(0.3)
        check("virou Dupla: todos veem a nova modalidade", p1.room["size"] == 2 and p2.room["size"] == 2 and "Dupla" in p2.room["modality"], p2.room)
        check("o mapa de Trio escolhido foi desmarcado (nunca fica um mapa da outra modalidade)", p1.room["level"] is None and p2.room["level"] is None, p1.room["level"])
        check("o 'pronto' de todos foi invalidado", not any(p["ready"] for p in p1.room["players"] if p), p1.room["players"])
        check("a lista de mapas da sala só tem mapas de 2 jogadores (igual para todos)", p1.room["maps"] == p2.room["maps"] and all(cat[i]["players"] == 2 for i in p1.room["maps"]) and len(p1.room["maps"]) == 15, p1.room["maps"])
        p1.send(t="start"); e = await p1.expect("err"); check("sem mapa escolhido não começa", e and "Escolha um mapa" in e["msg"], e)
        p3b = WS(); await p3b.connect(); await p3b.expect("hi"); p3b.send(t="join", code=code2, name="Caio"); e = await p3b.expect("err"); check("terceiro é recusado: a Dupla tem 2 vagas", e and "cheia (2 jogadores)" in e["msg"], e)
        p3b.send(t="leave")
        for ref in (dict(n=3), dict(id=4), dict(mid="classic-4"), dict(n=11), dict(mid="trio-6"), dict(id=17)):
            p1.send(t="level", **ref); e = await p1.expect("err")
            check(f"mapa de Trio por {list(ref.items())[0]} é rejeitado pela autoridade", e and "exatamente 3" in e["msg"] and p1.room["level"] is None, e)
        for ref in (dict(n=999), dict(id=0), dict(id=99), dict(mid="nao-existe"), dict(n=-1), dict(n="x")):
            p1.send(t="level", **ref); e = await p1.expect("err", 0.6)
            check(f"identificador inválido {list(ref.items())[0]} é rejeitado", (e is not None) or ref.get("n") in (-1, "x") and p1.room["level"] is None)
        p1.send(t="level", mid="classic-3-duo"); await asyncio.sleep(0.2)
        check("mapa de Dupla (classic-3-duo) é aceito e visto por todos", p1.room["level"] == BYMID["classic-3-duo"] == p2.room["level"], p2.room["level"])
        p1.send(t="ready", v=True); p2.send(t="ready", v=True); await asyncio.sleep(0.2); p1.send(t="start"); await asyncio.sleep(0.8)
        check("Dupla começa com os papéis 🔥 e 💧 e 2 jogadores", p1.level and p1.level["roles"] == [["brasa"], ["onda"]] and p1.level["level"]["players"] == 2, p1.level and p1.level["roles"])
        for _ in range(60):
            if p1.snap and p1.snap["ph"] == "play": break
            await asyncio.sleep(0.1)
        check("snapshot tem só 2 jogadores", p1.snap and len(p1.snap["p"]) == 2, p1.snap)
        # durante uma tentativa não dá para trocar modalidade nem mapa
        p1.send(t="size", n=3); p1.send(t="level", mid="duo-1"); await asyncio.sleep(0.3)
        check("durante a tentativa a modalidade e o mapa ficam travados", p1.room["size"] == 2 and p1.room["level"] == BYMID["classic-3-duo"], p1.room)
        # desconexão: a Dupla NÃO vira outra coisa; todos voltam ao lobby esperando
        p2.w.close(); await asyncio.sleep(0.6)
        check("queda de um jogador da Dupla: volta ao lobby, continua Dupla e não aceita começar com 1", p1.room["phase"] == "lobby" and p1.room["size"] == 2 and p1.room["players"][1]["on"] is False, p1.room)
        p1.send(t="ready", v=True); await asyncio.sleep(0.1); p1.send(t="start"); e = await p1.expect("err"); check("não começa com 1 conectado numa Dupla", e and "exatamente 2" in e["msg"], e)
        p1.send(t="leave"); await asyncio.sleep(0.3)

        print("Tempo configurável, prontos, carga sincronizada, tentativas e marcações (3 clientes)")
        q = [WS() for _ in range(3)]
        for x in q: await x.connect(); await x.expect("hi")
        q[0].send(t="create", name="Ana"); j = await q[0].expect("joined"); code3 = j["code"]
        for k in (1, 2): q[k].send(t="join", code=code3, name="P" + str(k)); await q[k].expect("joined")
        await asyncio.sleep(0.2)
        check("tempo padrão é 25 s e todos veem", all(x.room["limit"] == 25 for x in q), q[0].room)
        q[1].send(t="limit", v=10); await asyncio.sleep(0.15); check("só o anfitrião altera o tempo", q[0].room["limit"] == 25)
        for bad in (4, 301, 0, -5, "abc", None, 12.5, True, [10], 1e9):
            q[0].send(t="limit", v=bad)
        await asyncio.sleep(0.3)
        errs = 0
        while not q[0].q.empty():
            m = q[0].q.get_nowait(); errs += 1 if m.get("t") == "err" else 0
        check("tempos inválidos (fora de 5..300, texto, decimal, booleano) são recusados", q[0].room["limit"] == 25 and errs >= 8, (q[0].room["limit"], errs))
        for v in (5, 10, 15, 20, 25, 30, 45, 60, 300, 137):
            q[0].send(t="limit", v=v); await asyncio.sleep(0.05)
            ok = q[0].room["limit"] == v and q[2].room["limit"] == v
            if not ok: check(f"tempo {v} s aceito e visto por todos", False, q[2].room); break
        else: check("5, 10, 15, 20, 25, 30, 45, 60, 137 e 300 s aceitos e todos veem o mesmo valor", True)
        for k in range(3): q[k].send(t="role", role=["brasa", "onda", "folha"][k])
        await asyncio.sleep(0.2)
        for x in q: x.send(t="ready", v=True)
        await asyncio.sleep(0.2)
        check("todos prontos antes de mexer no tempo", all(p["ready"] for p in q[0].room["players"]))
        q[0].send(t="limit", v=12); await asyncio.sleep(0.2)
        check("mudar o tempo faz todos confirmarem 'pronto' de novo", not any(p["ready"] for p in q[0].room["players"]) and q[0].room["limit"] == 12, q[0].room)
        q[0].send(t="limit", v=12); await asyncio.sleep(0.1)
        for x in q: x.send(t="ready", v=True)
        await asyncio.sleep(0.2)
        # carga: o terceiro cliente demora a carregar -> nenhum tempo corre
        q[2].noload = True
        q[0].send(t="start"); await asyncio.sleep(0.8)
        check("todos recebem a fase com o tempo da sala (12 s)", all(x.level and x.level["level"]["time"] == 12 and x.level["limit"] == 12 for x in q), q[0].level and q[0].level["limit"])
        await asyncio.sleep(1.5)
        check("sem todos carregados a fase fica em espera (sem contagem nem tempo)", q[0].snap["ph"] == "wait" and q[0].snap["e"] == 0 and q[0].snap["ld"] == [1, 1, 0], q[0].snap)
        check("quem ainda carrega aparece para todos", q[1].snap["ld"] == [1, 1, 0])
        q[2].send(t="loaded"); await asyncio.sleep(0.4)
        check("depois que todos carregam começa a contagem de 3 s", q[0].snap["ph"] == "count", q[0].snap)
        for _ in range(60):
            if q[0].snap["ph"] == "play": break
            await asyncio.sleep(0.1)
        check("contagem termina e o jogo começa para todos no mesmo estado", all(x.snap["ph"] == "play" for x in q) and all(x.snap["lim"] == 12 for x in q), q[1].snap)
        sn = [x.snap for x in q]
        check("prazo compartilhado: 'en' (fim) igual para todos dentro de 1 quadro", abs(sn[0].get("en", 0) - sn[1].get("en", 0)) < 0.15 and abs(sn[0]["st"] - sn[2]["st"]) < 0.2, [(s_["st"], s_.get("en")) for s_ in sn])
        check("o prazo corresponde ao limite (12 s)", abs((sn[0]["en"] - sn[0]["st"]) + sn[0]["e"] - 12) < 0.3, sn[0])
        att = q[0].snap["a"]
        q[1].send(t="restart", a=att); await asyncio.sleep(0.3)
        check("só o anfitrião reinicia", q[0].snap["a"] == att)
        q[0].send(t="restart", a=att + 7); await asyncio.sleep(0.3)
        check("reinício com número de tentativa errado (atrasado) é ignorado", q[0].snap["a"] == att, q[0].snap["a"])
        q[0].send(t="restart", a=att); await asyncio.sleep(0.4)
        check("reiniciar vale uma vez e mantém o limite escolhido", q[0].snap["a"] == att + 1 and q[0].snap["lim"] == 12 and q[2].snap["lim"] == 12, q[0].snap)
        q[0].send(t="restart", a=att); await asyncio.sleep(0.3)
        check("o mesmo pedido repetido (da tentativa anterior) não reinicia de novo", q[0].snap["a"] == att + 1, q[0].snap["a"])
        check("eventos levam o número da tentativa", all("a" in m for m in q[0].evs), q[0].evs[:3])
        # tempo esgota: um único evento de derrota, e um único reinício
        for _ in range(200):
            if any(e[0] == "lose" and e[2] == "time" for e in q[0].events): break
            await asyncio.sleep(0.1)
        loses = [m for m in q[0].evs if m["e"][0] == "lose"]
        check("tempo esgotado: exatamente uma derrota registrada", len(loses) == 1 and loses[0]["e"][2] == "time" and loses[0]["a"] == att + 1, loses)
        await asyncio.sleep(3.0)
        starts = [m for m in q[0].evs if m["e"][0] == "start"]
        check("e exatamente um reinício depois dela (tentativa seguinte)", q[0].snap["a"] == att + 2 and sum(1 for m in starts if m["a"] == att + 2) == 1, (q[0].snap["a"], starts))
        # marcações: tipos válidos, limite de frequência, posição limitada ao mapa
        for x in q: x.events.clear(); x.evs = []
        before = len([1 for _ in [0]])
        q[1].send(t="mark", k=0, x=123.4, y=222); q[1].send(t="mark", k=1, x=1, y=1); await asyncio.sleep(0.3)
        got = []
        while not q[0].q.empty():
            m = q[0].q.get_nowait()
            if m.get("t") == "mark": got.append(m)
        check("marcação chega a todos com autor, tipo e posição", len(got) == 1 and got[0]["s"] == 1 and got[0]["k"] == 0 and got[0]["x"] == 123.4, got)
        check("marcações seguidas do mesmo jogador são limitadas (1 por ~1,2 s)", len(got) == 1)
        await asyncio.sleep(1.3)
        q[1].send(t="mark", k=2, x=99999, y=-50); q[1].send(t="mark", k=7, x=1, y=1); q[1].send(t="mark", k="x", x=1, y=1); await asyncio.sleep(0.3)
        got = []
        while not q[0].q.empty():
            m = q[0].q.get_nowait()
            if m.get("t") == "mark": got.append(m)
        check("posição fora do mapa é limitada e tipos inválidos são ignorados", len(got) == 1 and got[0]["x"] == 800 and got[0]["y"] == 0, got)
        # entrada tardia: sala em partida recusa, com mensagem clara
        late = WS(); await late.connect(); await late.expect("hi"); late.send(t="join", code=code3, name="Atrasado"); e = await late.expect("err")
        check("entrada tardia durante a partida é recusada com mensagem clara", e and "meio de uma partida" in e["msg"], e)
        # vitória só com todos na saída (participantes fixos)
        # (a vitória de verdade com 3 robôs já é testada acima)
        # anfitrião sai: a sala continua com migração e a partida acaba com aviso
        q[0].send(t="leave"); await asyncio.sleep(0.5)
        st = await q[1].expect("stopped", 1)
        check("anfitrião sai: a partida acaba com mensagem clara e outro vira anfitrião", st is not None and "saiu" in st["why"] and q[1].room["host"] in (1, 2), (st, q[1].room))
        for x in q + [late]: x.send(t="leave")
        await asyncio.sleep(0.3)

        print("Comandos numerados de movimento (previsão no navegador, autoridade no servidor)")
        z, zp = await duo_room("duo-1", 60)
        check("Dupla em jogo", z.snap and z.snap["ph"] == "play" and z.snap["ak"] == [0, 0], z.snap)
        x0, y0 = z.snap["p"][0][0], z.snap["p"][0][1]
        z.send(t="mv", s=1, d=[1] * 8); await asyncio.sleep(0.5)
        dx = z.snap["p"][0][0] - x0
        check("8 comandos de 1/60 s andam 8*260/60 = 34,7 u (nem mais, nem menos)", abs(dx - 34.67) < 1.0, dx)
        check("o servidor confirma o último comando aplicado (ak = 8)", z.snap["ak"][0] == 8, z.snap["ak"])
        z.send(t="mv", s=1, d=[1] * 8); await asyncio.sleep(0.4)
        check("lote repetido/antigo é descartado (não anda de novo)", abs(z.snap["p"][0][0] - x0 - 34.67) < 1.0 and z.snap["ak"][0] == 8, (z.snap["p"][0][0] - x0, z.snap["ak"]))
        z.send(t="mv", s=6, d=[1] * 6); await asyncio.sleep(0.4)       # sobrepõe 6..8 (repetidos) e traz 9..11 (novos)
        check("lote que sobrepõe: só os números novos valem (3 comandos)", abs(z.snap["p"][0][0] - x0 - 34.67 - 3 * 260 / 60) < 1.0 and z.snap["ak"][0] == 11, (z.snap["p"][0][0] - x0, z.snap["ak"]))
        z.send(t="mv", s=12, d=[1] * 12); await asyncio.sleep(0.4)
        check("rajada maior que a fila (12 de uma vez): vale só o que cabe (8), sem andar a mais", abs(z.snap["p"][0][0] - x0 - 34.67 - 13 - 8 * 260 / 60) < 1.5, z.snap["p"][0][0] - x0)
        # tentativa de correr mais rápido: 150 comandos de uma vez (a fila só guarda os mais recentes e o servidor aplica 1 por quadro)
        xa = z.snap["p"][0][1]; ta = time.monotonic()
        for k in range(15): z.send(t="mv", s=24 + 10 * k, d=[3] * 10)
        await asyncio.sleep(1.0)
        moved = z.snap["p"][0][1] - xa; el = time.monotonic() - ta
        check("não dá para andar mais rápido mandando comandos demais (limite = velocidade normal)", 20 < moved <= 260 * el + 6, (moved, 260 * el))
        for bad in ({"s": "x", "d": [1]}, {"s": 1, "d": "abc"}, {"s": 1, "d": []}, {"s": 5, "d": [99, -3, None, 1.5, True]}, {"s": True, "d": [1]}, {"s": 1, "d": [1] * 500}):
            z.send(t="mv", **bad)
        await asyncio.sleep(0.4)
        check("comandos malformados não derrubam nada", b'"ok":true' in await http("/health") and z.snap["ph"] == "play")
        z.send(t="mv", s=999999, d=[0]); await asyncio.sleep(0.2)
        # robô antigo (direção por estado) continua funcionando em outra sala
        o, op = await duo_room("duo-1", 60)
        xo = o.snap["p"][0][0]; o.send(t="in", x=1, y=0); await asyncio.sleep(0.5); o.send(t="in", x=0, y=0); await asyncio.sleep(1.2)
        check("direção por estado (clientes antigos/robôs) continua funcionando", o.snap["p"][0][0] - xo > 80, o.snap["p"][0][0] - xo)
        # eventos: contador crescente e sem repetição
        ids = [m["i"] for m in z.evs if "i" in m]
        check("eventos têm contador crescente sem repetição", ids == sorted(set(ids)) and len(ids) >= 1, ids[:6])
        z.send(t="leave"); o.send(t="leave"); zp.send(t="leave"); op.send(t="leave"); await asyncio.sleep(0.3)

        print("Conjuntos Dupla e Trio: exatamente 2 / 3 jogadores, papéis fixos, partida de ponta a ponta")
        cat = hi["levels"]
        check("catálogo: 27 entradas de Dupla (2 jogadores) e 29 de Trio (3 jogadores), cada uma com UMA quantidade exata", sum(1 for x in cat if x["players"] == 2) == 9 + 18 and sum(1 for x in cat if x["players"] == 3) == 11 + 18 and all(x["players"] in (2, 3) for x in cat))
        duo_i, trio_i = BYMID["duo-1"], BYMID["trio-1"]
        g = [WS() for _ in range(3)]
        for x in g: await x.connect(); await x.expect("hi")
        g[0].send(t="create", name="G0"); j = await g[0].expect("joined"); cg = j["code"]
        for k in (1, 2): g[k].send(t="join", code=cg, name="G%d" % k); await g[k].expect("joined")
        await asyncio.sleep(0.2)
        g[0].send(t="level", n=duo_i); e = await g[0].expect("err"); check("fase de Dupla numa sala de 3 é recusada com o motivo", e and "exatamente 2" in e["msg"] and g[0].room["level"] != duo_i, e)
        g[0].send(t="level", n=trio_i); await asyncio.sleep(0.2); check("fase de Trio numa sala de 3 é aceita", g[0].room["level"] == trio_i, g[0].room)
        for x in g: x.send(t="role", role="brasa")
        await asyncio.sleep(0.2)
        check("em fases novas os papéis são fixos (escolha de papel ignorada)", all(not p["roles"] for p in g[0].room["players"] if p), g[0].room)
        for x in g: x.send(t="ready", v=True)
        await asyncio.sleep(0.2); g[0].send(t="start"); await asyncio.sleep(0.8)
        check("Trio começa com 3 jogadores e papéis por ordem de vaga", g[0].level and g[0].level["roles"] == [["brasa"], ["onda"], ["folha"]] and g[0].level["level"]["players"] == 3, g[0].level and g[0].level["roles"])
        # ---- partida de ponta a ponta no Trio 1 (Três posições) com 3 clientes e direção por estado
        sp = lambda snap, k: snap["p"][k]
        async def walk(x, k, tx, ty, tol=14):
            for _ in range(500):
                s_ = x.snap
                if s_["ph"] == "won": return
                px_, py_ = s_["p"][k][0], s_["p"][k][1]
                d_ = math.hypot(tx - px_, ty - py_)
                if d_ < tol: break
                x.send(t="in", x=(tx - px_) / d_, y=(ty - py_) / d_); await asyncio.sleep(0.04)
            x.send(t="in", x=0, y=0)
        async def until(x, cond, tmo=15):
            end = time.monotonic() + tmo
            while time.monotonic() < end and not cond(x.snap):
                await asyncio.sleep(0.05)
        for _ in range(80):
            if g[0].snap and g[0].snap["ph"] == "play": break
            await asyncio.sleep(0.1)
        async def a_(x):   # 🔥: placa 0 até soltar a porta H (gate 1)
            await walk(x, 0, 130, 80, 5)
            await until(x, lambda s_: s_["g"][1] == 1); await walk(x, 0, 310, 250); await walk(x, 0, 620, 100); await walk(x, 0, 740, 250, 6)
        async def b_(x):
            await walk(x, 1, 130, 250, 5)
            await until(x, lambda s_: s_["g"][1] == 1); await walk(x, 1, 310, 250); await walk(x, 1, 740, 250, 6)
        async def c_(x):
            await walk(x, 2, 200, 420); await until(x, lambda s_: s_["g"][0] == 1); await walk(x, 2, 340, 425); await walk(x, 2, 460, 420, 8); await walk(x, 2, 740, 250, 6)
        await asyncio.gather(a_(g[0]), b_(g[1]), c_(g[2]))
        await until(g[0], lambda s_: s_["ph"] == "won" or s_["a"] > 1, 10)
        check("Trio 1: vitória com os 3 clientes pela rede (placas, interruptor, porta, chave, saída)", any(e[0] == "win" for e in g[0].events), g[0].snap)
        # avança sozinho para a próxima fase do MESMO conjunto
        for _ in range(60):
            if g[0].level and g[0].level["n"] == trio_i + 1: break
            await asyncio.sleep(0.1)
        check("depois da vitória segue para a próxima fase do Trio (e não para outro conjunto)", g[0].level and g[0].level["n"] == trio_i + 1 and g[0].level["level"]["set"] == "trio", g[0].level and g[0].level["n"])
        for x in g: x.send(t="leave")
        await asyncio.sleep(0.3)
        # ---- Dupla: sala de 2
        d2 = [WS() for _ in range(2)]
        for x in d2: await x.connect(); await x.expect("hi")
        d2[0].send(t="create", name="D0"); j = await d2[0].expect("joined"); cd = j["code"]
        d2[1].send(t="join", code=cd, name="D1"); await d2[1].expect("joined")
        d2[0].send(t="size", n=2); await asyncio.sleep(0.2)
        d2[0].send(t="level", n=trio_i); e = await d2[0].expect("err"); check("fase de Trio numa sala de 2 é recusada com o motivo", e and "exatamente 3" in e["msg"], e)
        d2[0].send(t="level", n=duo_i); await asyncio.sleep(0.2); check("fase de Dupla numa sala de 2 é aceita", d2[0].room["level"] == duo_i)
        for x in d2: x.send(t="ready", v=True)
        await asyncio.sleep(0.2); d2[0].send(t="start"); await asyncio.sleep(0.8)
        check("Dupla começa com papéis 🔥 e 💧", d2[0].level and d2[0].level["roles"] == [["brasa"], ["onda"]], d2[0].level and d2[0].level["roles"])
        for _ in range(80):
            if d2[0].snap and d2[0].snap["ph"] == "play": break
            await asyncio.sleep(0.1)
        async def da(x):   # Revezamento: 🔥 segura a placa até o interruptor ser ligado, depois passa pela porta de cima
            await walk(x, 0, 130, 150, 5); await until(x, lambda s_: s_["g"][1] == 1); await walk(x, 0, 310, 85); await walk(x, 0, 400, 85); await walk(x, 0, 730, 250, 6)
        async def db(x):
            await walk(x, 1, 200, 250); await until(x, lambda s_: s_["g"][0] == 1); await walk(x, 1, 340, 250); await walk(x, 1, 480, 120, 8); await walk(x, 1, 620, 400); await walk(x, 1, 730, 250, 6)
        await asyncio.gather(da(d2[0]), db(d2[1]))
        await until(d2[0], lambda s_: s_["ph"] == "won" or s_["a"] > 1, 10)
        check("Dupla 1: vitória com 2 clientes pela rede", any(e[0] == "win" for e in d2[0].events), d2[0].snap)
        d2[0].send(t="restart", a=d2[0].snap["a"]); await asyncio.sleep(0.5)
        for x in d2: x.send(t="leave")
        await asyncio.sleep(0.3)
        # ---- aviso de reinício pelo anfitrião
        r3 = [WS() for _ in range(2)]
        for x in r3: await x.connect(); await x.expect("hi")
        r3[0].send(t="create", name="R0"); j = await r3[0].expect("joined"); r3[1].send(t="join", code=j["code"], name="R1"); await r3[1].expect("joined")
        r3[0].send(t="size", n=2); await asyncio.sleep(0.1); r3[0].send(t="level", n=duo_i); await asyncio.sleep(0.1)
        for x in r3: x.send(t="ready", v=True)
        await asyncio.sleep(0.2); r3[0].send(t="start")
        for _ in range(80):
            if r3[1].snap and r3[1].snap["ph"] == "play": break
            await asyncio.sleep(0.1)
        r3[1].evs = []; r3[0].send(t="restart", a=r3[0].snap["a"]); await asyncio.sleep(0.5)
        check("reinício do anfitrião é avisado a todos (evento rs com o autor)", any(m["e"][0] == "rs" and m["e"][1] == 0 for m in r3[1].evs), r3[1].evs[:3])
        for x in r3: x.send(t="leave")
        await asyncio.sleep(0.3)

        print("Várias tentativas seguidas: sem eventos duplicados")
        u, up = await duo_room("duo-1", 5)
        end = time.monotonic() + 36
        while time.monotonic() < end and not (u.snap and u.snap["a"] >= 4):
            await asyncio.sleep(0.3)
        att = u.snap["a"]
        ids = [m["i"] for m in u.evs]
        loses = [m for m in u.evs if m["e"][0] == "lose"]
        starts = [m for m in u.evs if m["e"][0] == "start"]
        check(f"chegou à tentativa {att} (≥ 4) só com o tempo esgotando", att >= 4, att)
        check("contador de eventos estritamente crescente (nenhum repetido)", ids == sorted(set(ids)), ids[:10])
        check("exatamente uma derrota por tentativa já terminada", sorted(m["a"] for m in loses) == list(range(1, len(loses) + 1)) and len(loses) >= att - 1, [(m["a"]) for m in loses])
        check("exatamente um 'início' por tentativa", [m["a"] for m in starts] == sorted(set(m["a"] for m in starts)), [m["a"] for m in starts])
        u.send(t="leave"); up.send(t="leave"); await asyncio.sleep(0.3)

        d = json.loads((await http("/health")).split(b"\r\n\r\n")[1]); print("         estado final:", d)
    finally:
        srv.terminate()
        try: out = srv.communicate(timeout=3)[0].decode()
        except Exception: out = ""
        if "Traceback" in out: print("TRACEBACK NO SERVIDOR:\n" + out); FAILS.append("traceback no servidor")
    print("\nFALHAS:" if FAILS else "\nTUDO OK", FAILS if FAILS else "")
    return 1 if FAILS else 0

sys.exit(asyncio.run(main()))
