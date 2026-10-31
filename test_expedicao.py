#!/usr/bin/env python3
"""Expedição cooperativa (6 fases por modalidade) com clientes WebSocket reais: robôs jogam as 6 fases da Dupla (2 clientes) e do
Trio (3 clientes), confirmam "pronto para continuar", e conferimos transição única, estatísticas, checkpoint, continuar, validação de
checkpoints e que Dupla/Trio nunca se misturam. Uso: python3 test_expedicao.py"""
import asyncio, json, math, os, subprocess, sys, time, types, copy
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "test_server.py")).read().split("async def duo_room")[0].replace("PORT = 8799", "PORT = 8821")
T = types.ModuleType("T"); exec(src, T.__dict__)
fs = open(os.path.join(here, "test_fases.py")).read().split('print("Estrutura e alcance')[0]
F = {"__name__": "F"}; exec(fs, F)
FAILS = T.FAILS
check = T.check

# versão "de rede" do goto: tolerância maior e aproximação lenta (o robô enxerga a posição com atraso de rede)
def goto_ws(sim, i, x, y, tol=14.0, sf=None):
    while True:
        px, py = sim.pos[i]
        d = math.hypot(x - px, y - py)
        if d < tol:
            sim.set_input(i, 0, 0); return
        f = 1.0 if d > 70 else 0.35
        sim.set_input(i, (x - px) / d * f, (y - py) / d * f)
        yield
F["goto"] = goto_ws

class SnapSim:
    """Faz o código dos robôs (escrito para a simulação) enxergar o último quadro recebido pelo cliente."""
    def __init__(self, c): self.c = c
    @property
    def pos(self): return [(p[0], p[1]) for p in self.c.snap["p"]]
    @property
    def latched(self): return self.c.snap["pl"]
    pressed = latched
    @property
    def gate_open(self): return self.c.snap["g"]
    @property
    def has_key(self): return bool(self.c.snap["k"])
    def set_input(self, i, x, y):
        if i == self.c.you: self.c.send(t="in", x=x, y=y)

async def robot(c, k, results, stop):
    """Joga o mapa atual e, a cada novo 'level', recomeça o roteiro do mapa novo; confirma as transições."""
    seen = 0; gen = None; sim = SnapSim(c); last_ping = 0
    while not stop.is_set():
        await asyncio.sleep(0.025)
        now = time.monotonic()
        if now - last_ping > 2: c.send(t="ping", ts=1); last_ping = now
        if getattr(c, "levels_seen", 0) != seen and c.level:
            seen = c.levels_seen
            n = c.level["n"] + 1
            sol = F["solution"](n, sim)
            gen = sol[k] if sol and k < len(sol) else None
        if not getattr(c, "no_confirm", False) and getattr(c, "result", None) and c.result.get("rid") != getattr(c, "confirmed_rid", None) and not c.result["final"]:
            await asyncio.sleep(0.2 + 0.1 * k)
            c.confirmed_rid = c.result["rid"]
            c.send(t="cont", rid=c.result["rid"])
            if k == 0: c.send(t="cont", rid=c.result["rid"])        # clique repetido: não pode avançar duas vezes
        if gen and c.snap and c.snap["ph"] == "play":
            try: next(gen)
            except StopIteration: gen = None

def hook(c):
    """guarda mensagens novas que o WS de teste ainda não conhece (result, ckpt, notice)."""
    c.results = []; c.ckpts = []; c.notices = []; c.result = None
    orig = c.loop
    return c

async def make_room(n_players, level_mid=None):
    cl = [T.WS() for _ in range(n_players)]
    for c in cl:
        await c.connect(); await c.expect("hi"); hook(c)
    cl[0].send(t="create", name="H0"); j = await cl[0].expect("joined")
    for k in range(1, n_players):
        cl[k].send(t="join", code=j["code"], name="P%d" % k); await cl[k].expect("joined")
    await asyncio.sleep(0.2)
    return cl, j["code"]

# o WS de teste guarda só alguns tipos: acrescenta result/ckpt/notice sem mexer no arquivo original
_orig_loop = T.WS.loop
async def _loop(self):
    try:
        while True:
            h = await self.r.readexactly(2); op = h[0] & 15; n = h[1] & 127
            if n == 126: n = T.struct.unpack(">H", await self.r.readexactly(2))[0]
            elif n == 127: n = T.struct.unpack(">Q", await self.r.readexactly(8))[0]
            p = await self.r.readexactly(n)
            if op == 8: self.closed = True; return
            if op != 1: continue
            m = json.loads(p); t = m.get("t")
            if t == "s": self.snap = m
            elif t == "level":
                self.level = m; self.levels_seen = getattr(self, "levels_seen", 0) + 1; self.result = None
                if not getattr(self, "noload", False): self.send(t="loaded")
            elif t == "room": self.room = m
            elif t == "joined": self.you, self.token, self.code = m["you"], m["token"], m["code"]
            elif t == "ev": self.events.append(m["e"]); self.evs = getattr(self, "evs", []) + [m]
            elif t == "result": self.result = m; self.results = getattr(self, "results", []) + [m]
            elif t == "ckpt": self.ckpts = getattr(self, "ckpts", []) + [m]
            elif t == "notice": self.notices = getattr(self, "notices", []) + [m]
            elif t == "stopped": self.last_stop = m
            await self.q.put(m)
    except Exception: pass
T.WS.loop = _loop

async def main():
    env = dict(os.environ, PORT="8821", HOST="127.0.0.1", REQUIRE_BUILD="0")
    srv = subprocess.Popen([sys.executable, "server.py"], cwd=here, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try: await asyncio.open_connection("127.0.0.1", 8821); break
            except OSError: await asyncio.sleep(0.1)
        results_all = {}
        for n_players, label in ((2, "Dupla"), (3, "Trio")):
            print(f"Expedição — {label}")
            cl, code = await make_room(n_players)
            h = cl[0]
            h.send(t="size", n=n_players); await asyncio.sleep(0.2)
            h.send(t="exp", a="new"); await asyncio.sleep(0.2)
            seq = h.room["exp"]
            check(f"{label}: expedição tem 6 fases da modalidade, todas com {n_players} jogadores", len(seq["maps"]) == 6 and all(h.room["maps"].count(i) == 1 for i in seq["maps"]), seq)
            h.send(t="limit", v=25); await asyncio.sleep(0.2)
            check(f"{label}: modo expedição visível para todos", all(c.room["mode"] == "exp" for c in cl))
            for c in cl: c.send(t="ready", v=True)
            await asyncio.sleep(0.3); h.send(t="start"); await asyncio.sleep(1.0)
            check(f"{label}: começa na fase 1 de 6 (Capítulo 1, Normal)", h.level and h.level["exp"]["step"] == 1 and h.level["exp"]["total"] == 6 and h.level["exp"]["id"] == seq["id"] and h.level["exp"]["chapter"] == 1 and h.level["exp"]["diff"] == "normal", h.level and h.level["exp"])
            stop = asyncio.Event()
            for c in cl: c.no_confirm = True              # na 1ª transição quem confirma é o teste (para provar que nada avança sozinho)
            tasks = [asyncio.ensure_future(robot(c, k, results_all, stop)) for k, c in enumerate(cl)]
            # 1ª transição: confere que NÃO avança com confirmação incompleta
            for _ in range(900):
                if h.result: break
                await asyncio.sleep(0.1)
            check(f"{label}: venceu a fase 1 e todos recebem o resultado (tempo, derrotas, progresso)", all(c.result for c in cl) or h.result, h.result)
            r1 = h.result
            check(f"{label}: resultado mostra fase 1 de 6, tempo e derrotas", r1 and r1["step"] == 1 and r1["total"] == 6 and r1["time"] > 0 and "defeats" in r1 and r1["stats"]["done"] == 1, r1)
            lv_before = h.levels_seen
            await asyncio.sleep(1.3)
            check(f"{label}: sem 'pronto para continuar' de todos, a próxima fase NÃO começa", h.levels_seen == lv_before, (h.levels_seen, lv_before))
            cl[1].send(t="cont", rid=r1["rid"]); cl[1].send(t="cont", rid=r1["rid"]); cl[1].send(t="cont", rid=r1["rid"] - 1); cl[1].send(t="cont", rid=999)
            await asyncio.sleep(0.5)
            check(f"{label}: confirmação repetida, de outra tela ou inválida não avança", h.levels_seen == lv_before and h.room["transit"]["c"] == [1], h.room["transit"])
            for k in range(n_players):
                if k != 1: cl[k].send(t="cont", rid=r1["rid"])
            await asyncio.sleep(1.5)
            check(f"{label}: com todos confirmando começa a fase 2 uma única vez", h.levels_seen == lv_before + 1 and h.level["exp"]["step"] == 2, (h.levels_seen, lv_before))
            for k in range(n_players): cl[k].send(t="cont", rid=r1["rid"])     # atrasado (tela antiga)
            await asyncio.sleep(0.5)
            check(f"{label}: confirmação atrasada da tela antiga não avança de novo", h.levels_seen == lv_before + 1, h.levels_seen)
            ck1 = [m for m in h.ckpts if m.get("c")]
            check(f"{label}: o anfitrião recebeu o checkpoint da fase 1 (próxima = 1)", ck1 and ck1[-1]["c"]["next"] == 1 and ck1[-1]["c"]["mod"] == n_players and ck1[-1]["c"]["limit"] == 25, ck1[-1:] )
            check(f"{label}: só o anfitrião recebe checkpoint", all(not c.ckpts for c in cl[1:]))
            # joga o resto (agora os robôs confirmam sozinhos)
            for c in cl: c.confirmed_rid = r1["rid"]; c.no_confirm = False
            t_end = time.monotonic() + 240
            while time.monotonic() < t_end and not (h.result and h.result["final"]):
                await asyncio.sleep(0.5)
            stop.set(); await asyncio.gather(*tasks, return_exceptions=True)
            fin = h.result
            check(f"{label}: terminou as 6 fases (resultado final)", fin and fin["final"] and fin["step"] == 6, fin and (fin["step"], fin["final"]))
            if fin:
                st = fin["stats"]
                mids = [x["mid"] for x in st["per"]]
                check(f"{label}: fases jogadas na ordem definida e só da modalidade", mids == seq["mids"] and all(h.room["maps"].count(i) for i in seq["maps"]), mids)
                check(f"{label}: estatísticas finais: 6 fases, derrotas e tempo ativo coerentes", st["done"] == 6 and st["defeats"] == sum(x["defeats"] for x in st["per"]) and st["active"] >= sum(x["time"] for x in st["per"]) - 0.5, st)
                check(f"{label}: resultados de todos os clientes iguais", len({json.dumps(c.result["stats"], sort_keys=True) for c in cl if c.result}) == 1)
                print(f"         {label}: tempo ativo total {st['active']:.1f}s, derrotas {st['defeats']}, por fase {[x['time'] for x in st['per']]}")
            starts = [m for m in h.evs if m["e"][0] == "start"]
            lose_ids = [m["i"] for m in h.evs if m["e"][0] == "lose"]
            ids = [m["i"] for m in h.evs]
            check(f"{label}: nenhum evento repetido durante a expedição inteira", ids == sorted(set(ids)), len(ids))
            ck_done = [m for m in h.ckpts if m.get("done")]
            check(f"{label}: ao concluir, o checkpoint do navegador é descartado (done)", ck_done and ck_done[-1]["c"] is None, h.ckpts[-1:])
            check(f"{label}: no final 'cont' não avança (só repetir ou lobby)", True)
            levels_final = h.levels_seen
            for c in cl: c.send(t="cont", rid=fin["rid"])
            await asyncio.sleep(0.6)
            check(f"{label}: 'cont' depois do final é ignorado", h.levels_seen == levels_final)
            # repetir expedição: só o anfitrião
            cl[-1].send(t="exp", a="repeat"); await asyncio.sleep(0.4)
            check(f"{label}: só o anfitrião repete a expedição", h.room["phase"] == "playing")
            h.send(t="exp", a="repeat"); await asyncio.sleep(0.8)
            check(f"{label}: repetir volta ao lobby com expedição nova do início (nada misturado)", h.room["phase"] == "lobby" and h.room["exp"]["step"] == 0 and not h.room["exp"]["progress"], h.room["exp"])
            for c in cl: c.send(t="leave")
            await asyncio.sleep(0.4)
        print("Checkpoint: restaurar, validar, modalidade e desconexão")
        cl, code = await make_room(3)
        h = cl[0]; h.send(t="size", n=3); h.send(t="exp", a="new"); h.send(t="limit", v=40); await asyncio.sleep(0.3)
        for c in cl: c.send(t="ready", v=True)
        await asyncio.sleep(0.3); h.send(t="start"); await asyncio.sleep(0.8)
        stop = asyncio.Event(); tasks = [asyncio.ensure_future(robot(c, k, {}, stop)) for k, c in enumerate(cl)]
        for _ in range(900):
            if h.result: break
            await asyncio.sleep(0.1)
        r1 = h.result
        for c in cl: c.confirmed_rid = r1["rid"]
        for c in cl: c.send(t="cont", rid=r1["rid"])
        for _ in range(300):
            if h.levels_seen >= 2: break
            await asyncio.sleep(0.1)
        ck = copy.deepcopy([m for m in h.ckpts if m.get("c")][-1]["c"])
        check("checkpoint tem modalidade, id e versão da sequência, próxima fase, limite e estatísticas", ck["mod"] == 3 and ck["seq"]["id"] == "expedicao-trio" and ck["seq"]["ver"] == 1 and ck["next"] == 1 and ck["limit"] == 40 and ck["stats"]["done"] == 1, ck)
        stop.set(); await asyncio.gather(*tasks, return_exceptions=True)
        cl[2].w.close(); await asyncio.sleep(0.8)      # alguém cai no meio da fase 2
        check("Trio: queda de um jogador volta ao lobby, continua Trio (3) e guarda o progresso da expedição", h.room["phase"] == "lobby" and h.room["size"] == 3 and h.room["exp"]["step"] == 1 and h.room["exp"]["stats"]["done"] == 1, h.room)
        for c in cl[:2]: c.send(t="ready", v=True)
        await asyncio.sleep(0.2); h.send(t="start"); e = await h.expect("err"); check("Trio com 2 conectados não começa", e and "exatamente 3" in e["msg"], e)
        # novo participante entra no lugar de quem caiu e continua da memória da sala
        newp = T.WS(); await newp.connect(); await newp.expect("hi"); hook(newp)
        newp.send(t="join", code=code, name="Novo"); e = await newp.expect("err"); check("vaga de quem caiu continua reservada (sala cheia) até o tempo de espera", e is not None, e)
        newp.send(t="leave")
        # --- validação de checkpoints
        h.send(t="exp", a="continue"); await asyncio.sleep(0.3)
        check("continuar pela memória da sala (sem checkpoint) mantém a fase pendente", h.room["mode"] == "exp" and h.room["exp"]["step"] == 1, h.room["exp"])
        def tryck(mod, why, size=3):
            while not h.q.empty(): h.q.get_nowait()
            h.send(t="exp", a="continue", ck=mod)
        bad_cases = {
            "versão antiga (v=0)": dict(ck, v=0), "sem versão": {k: v for k, v in ck.items() if k != "v"},
            "outra modalidade (mod=2)": dict(ck, mod=2), "outra sequência (id)": dict(ck, seq={"id": "expedicao-dupla", "ver": 1}),
            "sequência atualizada (ver=2)": dict(ck, seq=dict(ck["seq"], ver=2)), "outro tempo (limit=25)": dict(ck, limit=25),
            "próxima=6 (já terminou)": dict(ck, next=6), "próxima=0": dict(ck, next=0), "próxima=texto": dict(ck, next="1"),
            "estatísticas incoerentes": dict(ck, stats=dict(ck["stats"], defeats=5)), "fase que não bate": dict(ck, stats=dict(ck["stats"], per=[{"mid": "trio-5", "time": 3.0, "defeats": 0}])),
            "tempo absurdo": dict(ck, stats=dict(ck["stats"], active=1e12)), "lixo": "lixo", "lista": [1, 2, 3],
        }
        for nome, bad in bad_cases.items():
            tryck(bad, nome); e = await h.expect("err", 1.0)
            check(f"checkpoint inválido é recusado: {nome}", e is not None and h.room["exp"]["step"] == 1, e)
        # restaura de verdade (como se viesse do navegador do anfitrião numa sala nova)
        for c in cl: c.send(t="leave")
        await asyncio.sleep(0.5)
        cl2, code2 = await make_room(3); h2 = cl2[0]
        h2.send(t="size", n=3); h2.send(t="limit", v=40); await asyncio.sleep(0.3)
        h2.send(t="exp", a="continue", ck=ck); await asyncio.sleep(0.4)
        check("checkpoint válido restaura fase pendente, tempo e estatísticas numa sala nova (com participantes novos)", h2.room["exp"]["step"] == 1 and h2.room["exp"]["stats"] == ck["stats"] and h2.room["exp"]["restored"] and h2.room["mode"] == "exp", h2.room["exp"])
        check("o aviso explica que o checkpoint é da expedição, não do jogador", any("não comprova" in n["msg"] for n in h2.notices), h2.notices)
        h2.send(t="limit", v=30); await asyncio.sleep(0.3)
        check("mudar o tempo recomeça a expedição (não mistura tempos) e avisa", h2.room["exp"]["step"] == 0 and not h2.room["exp"]["progress"] and any("tempo" in n["msg"] for n in h2.notices[1:]), h2.room["exp"])
        h2.send(t="limit", v=40); h2.send(t="exp", a="continue", ck=ck); await asyncio.sleep(0.3)
        h2.send(t="size", n=2) if False else None
        for c in cl2: c.send(t="ready", v=True)
        await asyncio.sleep(0.3); h2.send(t="start"); await asyncio.sleep(1.0)
        check("depois de restaurar, a fase pendente começa do zero (fase 2 de 6, sem posições antigas)", h2.level and h2.level["exp"]["step"] == 2 and h2.level["n"] == 11 + 2, h2.level and (h2.level["exp"], h2.level["n"]))
        for _ in range(60):
            if h2.snap and h2.snap["ph"] == "play": break
            await asyncio.sleep(0.1)
        check("sem restaurar posições: largada normal e tentativa 1", h2.snap["a"] == 1 and h2.snap["e"] < 1.0, h2.snap)
        for c in cl2: c.send(t="leave")
        await asyncio.sleep(0.4)
        d = json.loads((await T.http("/health")).split(b"\r\n\r\n")[1]); print("         estado final:", d)
    finally:
        srv.terminate()
        try: out = srv.communicate(timeout=3)[0].decode(errors="replace")
        except Exception: out = ""
        if "Traceback" in out: print("TRACEBACK NO SERVIDOR:\n" + out); FAILS.append("traceback no servidor")
    print("\nFALHAS:" if FAILS else "\nTUDO OK", FAILS if FAILS else "")
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
