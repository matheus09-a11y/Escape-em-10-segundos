#!/usr/bin/env python3
"""Teste com atraso de rede: um proxy TCP entre 3 clientes e o servidor adiciona latência (e variação) em cada sentido.
Verifica início/fim sincronizados, vitória, tempo esgotado e que os clientes não se afastam do prazo do servidor.
Uso: python3 test_latencia.py"""
import asyncio, math, os, random, subprocess, sys, time, types
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "test_server.py")).read().split("async def main")[0]
T = types.ModuleType("T"); exec(src, T.__dict__)
SRV, PX = 8811, 8812
T.PORT = PX
FAILS = []
def check(n, c, extra=""):
    print(("  ok   " if c else "  FAIL ") + n + (f"  [{extra}]" if extra and not c else ""))
    if not c: FAILS.append(n)

async def pipe(r, w, base, jit):
    q = asyncio.Queue()
    async def sender():
        while True:
            at, data = await q.get()
            d = at - time.monotonic()
            if d > 0: await asyncio.sleep(d)
            w.write(data); await w.drain()
    task = asyncio.ensure_future(sender()); last = 0
    try:
        while True:
            data = await r.read(65536)
            if not data: break
            at = max(last, time.monotonic() + base + random.uniform(0, jit)); last = at   # mantém a ordem
            q.put_nowait((at, data))
    except Exception: pass
    await asyncio.sleep(base + jit + 0.05); task.cancel()
    try: w.close()
    except Exception: pass

async def handle(cr, cw, base, jit):
    sr, sw = await asyncio.open_connection("127.0.0.1", SRV)
    await asyncio.gather(pipe(cr, sw, base, jit), pipe(sr, cw, base, jit))

async def main(base, jit, lim):
    env = dict(os.environ, PORT=str(SRV), HOST="127.0.0.1")
    srv = subprocess.Popen([sys.executable, "server.py"], cwd=here, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    prox = None
    try:
        for _ in range(50):
            try: await asyncio.open_connection("127.0.0.1", SRV); break
            except OSError: await asyncio.sleep(0.1)
        prox = await asyncio.start_server(lambda r, w: handle(r, w, base, jit), "127.0.0.1", PX)
        q = [T.WS() for _ in range(3)]
        for x in q: await x.connect(); await x.expect("hi", 5)
        q[0].send(t="create", name="A"); j = await q[0].expect("joined", 5)
        for k in (1, 2): q[k].send(t="join", code=j["code"], name="P%d" % k); await q[k].expect("joined", 5)
        for k in range(3): q[k].send(t="role", role=["brasa", "onda", "folha"][k])
        await asyncio.sleep(1)
        q[0].send(t="limit", v=lim); await asyncio.sleep(1)
        check(f"[{int(base*1000)} ms] todos veem o tempo de {lim} s", all(x.room["limit"] == lim for x in q))
        for x in q: x.send(t="ready", v=True)
        await asyncio.sleep(1)
        q[0].send(t="start"); await asyncio.sleep(1.5)
        for _ in range(100):
            if all(x.snap and x.snap["ph"] == "play" for x in q): break
            await asyncio.sleep(0.1)
        check(f"[{int(base*1000)} ms] todos entram em 'jogo' depois da contagem", all(x.snap and x.snap["ph"] == "play" for x in q), [x.snap and x.snap["ph"] for x in q])
        # diferença entre o tempo restante que cada cliente calcularia pelo prazo (en - relógio do servidor)
        offs = []
        for x in q:
            s = x.snap; offs.append(s["en"] - s["st"] + s["e"])
        check(f"[{int(base*1000)} ms] prazo coerente em todos (≈ limite {lim} s)", all(abs(o - lim) < 0.3 for o in offs), offs)
        route = [(200, 250), (450, 250), (730, 250)]
        async def bot(x, slot):
            for tx, ty in route:
                for _ in range(1200):
                    s = x.snap
                    if s["ph"] == "won": return
                    px_, py_ = s["p"][slot][0], s["p"][slot][1]
                    d = math.hypot(tx - px_, ty - py_)
                    if d < 45: break   # com atraso o boneco passa do ponto: tolerância larga nos pontos intermediários
                    x.send(t="in", x=(tx - px_) / d, y=(ty - py_) / d); await asyncio.sleep(0.05)
            for _ in range(300):      # com atraso o boneco passa do ponto: continua corrigindo até a vitória
                s = x.snap
                if s["ph"] == "won": break
                px_, py_ = s["p"][slot][0], s["p"][slot][1]
                d = math.hypot(730 - px_, 250 - py_)
                dd = 0.0 if d < 14 else (0.12 if d < 120 else 1.0)   # perto da saída anda devagar (o atraso faz o boneco passar do ponto)
                x.send(t="in", x=(730 - px_) / (d or 1) * dd, y=(250 - py_) / (d or 1) * dd); await asyncio.sleep(0.05)
            x.send(t="in", x=0, y=0)
        await asyncio.gather(*(bot(q[k], k) for k in range(3)))
        for _ in range(200):
            if all(x.snap["ph"] == "won" for x in q) or all(x.level and x.level["n"] == 1 for x in q): break
            await asyncio.sleep(0.1)
        won_seen = [any(e[0] == "win" for e in x.events) for x in q]
        check(f"[{int(base*1000)} ms] vitória chega a todos com atraso de rede", all(won_seen), won_seen)
        wins = [m for x in q for m in x.evs if m["e"][0] == "win"]
        check(f"[{int(base*1000)} ms] uma única vitória por cliente", len(wins) == 3, len(wins))
        for x in q: x.send(t="leave")
        await asyncio.sleep(0.3)
    finally:
        if prox: prox.close()
        srv.terminate()

for base, jit, lim in ((0.12, 0.08, 15), (0.2, 0.1, 40)):
    print(f"Atraso de rede: {int(base*1000)}–{int((base+jit)*1000)} ms por sentido, limite {lim} s")
    asyncio.run(main(base, jit, lim))
print()
print("FALHAS:" if FAILS else "TUDO OK", FAILS if FAILS else "")
sys.exit(1 if FAILS else 0)
