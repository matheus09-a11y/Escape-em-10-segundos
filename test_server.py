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
                elif t == "level": self.level = m
                elif t == "room": self.room = m
                elif t == "joined": self.you, self.token, self.code = m["you"], m["token"], m["code"]
                elif t == "ev": self.events.append(m["e"])
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

async def main():
    here = os.path.dirname(os.path.abspath(__file__))
    env = dict(os.environ, PORT=str(PORT), HOST="127.0.0.1")
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
        hi = await a.expect("hi"); check("hello traz catálogo de fases e papéis", hi and len(hi["levels"]) == 5 and set(hi["roles"]) == {"brasa", "onda", "folha"})
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
        a.send(t="start"); await asyncio.sleep(0.5)
        check("todos recebem a fase ao começar", all(x.level and x.level["n"] == 0 for x in (a, b, c)))
        check("papéis chegam na ordem das vagas", a.level["roles"] == ["brasa", "onda", "folha"])

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
        c.w.close(); await asyncio.sleep(0.4)
        pz = await a.expect("paused", 1) or None
        check("quando alguém cai o jogo pausa para todos", a.room and a.room["paused"] is True, a.room)
        c2 = WS(); await c2.connect(); c2.send(t="rejoin", code=code, token="errado"); e = await c2.expect("err"); check("token errado não entra", e is not None)
        c3 = WS(); await c3.connect(); c3.send(t="rejoin", code=code, token=tok); j = await c3.expect("joined")
        check("com o token volta para a mesma vaga", j and j["you"] == sl and j.get("back"))
        await asyncio.sleep(0.4)
        check("o jogo despausa quando todos voltam", a.room["paused"] is False and c3.level is not None, a.room)
        a.send(t="lobby"); await asyncio.sleep(0.3); check("anfitrião volta ao lobby", a.room["phase"] == "lobby")
        b.send(t="leave"); await asyncio.sleep(0.3)
        check("quem sai libera a vaga", a.room["players"][1] is None)
        a.send(t="leave"); c3.send(t="leave"); await asyncio.sleep(0.3)
        d = json.loads((await http("/health")).split(b"\r\n\r\n")[1]); print("         estado final:", d)
    finally:
        srv.terminate()
        try: out = srv.communicate(timeout=3)[0].decode()
        except Exception: out = ""
        if "Traceback" in out: print("TRACEBACK NO SERVIDOR:\n" + out); FAILS.append("traceback no servidor")
    print("\nFALHAS:" if FAILS else "\nTUDO OK", FAILS if FAILS else "")
    return 1 if FAILS else 0

sys.exit(asyncio.run(main()))
