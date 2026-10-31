#!/usr/bin/env python3
"""Dificuldade, capítulos, variantes e checkpoint versionado, com clientes WebSocket reais. Inclui uma expedição COMPLETA do
Capítulo 2 (fácil) jogada por robôs cuidadosos na Dupla (2 clientes) e no Trio (3 clientes).
Uso: python3 test_dificuldade.py"""
import asyncio, json, math, os, subprocess, sys, time, types, copy
here = os.path.dirname(os.path.abspath(__file__))
exp_src = open(os.path.join(here, "test_expedicao.py")).read().split("async def main():")[0].replace("8821", "8831")
E = {"__name__": "E", "__file__": os.path.join(here, "test_expedicao.py")}; exec(exp_src, E)
T, check, FAILS, make_room, hook = E["T"], E["check"], E["FAILS"], E["make_room"], E["hook"]
f2 = open(os.path.join(here, "test_fases2.py")).read().split("V2 = [i for i")[0]
F2 = {"__name__": "F2", "__file__": os.path.join(here, "test_fases2.py")}; exec(f2, F2)
from coop_levels import LEVELS, BY_MID, FAMILY, maps_for, EXPEDITIONS, exp_maps

class Snap2:
    """Como SnapSim, mas com o que os robôs cuidadosos precisam: mapa, tempo da tentativa e papéis."""
    def __init__(self, c): self.c = c
    @property
    def lv(self): return LEVELS[self.c.level["n"]]
    @property
    def roles(self): return [[r] for r in self.lv["roles"]]
    @property
    def t(self):
        s = self.c.snap; at = getattr(self.c, "snap_at", time.monotonic())
        return s["e"] + (time.monotonic() - at if s["ph"] == "play" else 0)
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

# marca o instante de chegada dos quadros (para o relógio do robô)
_prev_loop = T.WS.loop
async def _loop2(self):
    orig_put = self.q.put
    async def put(m):
        if m.get("t") == "s": self.snap_at = time.monotonic()
        await orig_put(m)
    self.q.put = put
    await _prev_loop(self)
T.WS.loop = _loop2

async def robot2(c, k, stop):
    seen = 0; gen = None; sim = Snap2(c); last_ping = 0
    while not stop.is_set():
        await asyncio.sleep(0.02)
        now = time.monotonic()
        if now - last_ping > 2: c.send(t="ping", ts=1); last_ping = now
        if getattr(c, "levels_seen", 0) != seen and c.level:
            seen = c.levels_seen
            sol = F2["solution"](c.level["level"]["mid"], sim)
            gen = sol[k] if sol and k < len(sol) else None
        r = getattr(c, "result", None)
        if r and r.get("rid") != getattr(c, "confirmed_rid", None) and not r["final"] and not getattr(c, "no_confirm", False):
            await asyncio.sleep(0.2 + 0.1 * k); c.confirmed_rid = r["rid"]; c.send(t="cont", rid=r["rid"])
        if gen and c.snap and c.snap["ph"] == "play":
            try: next(gen)
            except StopIteration: gen = None

def drain(c):
    while not c.q.empty(): c.q.get_nowait()

async def main():
    env = dict(os.environ, PORT="8831", HOST="127.0.0.1", REQUIRE_BUILD="0")
    srv = subprocess.Popen([sys.executable, "server.py"], cwd=here, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try: await asyncio.open_connection("127.0.0.1", 8831); break
            except OSError: await asyncio.sleep(0.1)
        print("Configuração: dificuldade, variantes e filtros (2 clientes)")
        cl, code = await make_room(2); h, q = cl
        h.send(t="size", n=2); await asyncio.sleep(0.2)
        cat = None
        check("dificuldade padrão é Normal e todos veem", h.room["difficulty"] == "normal" and q.room["difficulty"] == "normal")
        for c in cl: c.send(t="ready", v=True)
        await asyncio.sleep(0.2)
        q.send(t="diff", v="easy"); await asyncio.sleep(0.2); check("só o anfitrião muda a dificuldade", h.room["difficulty"] == "normal")
        for bad in ("facil", "EASY", 1, None, True, ["easy"], "", "hard "):
            h.send(t="diff", v=bad)
        await asyncio.sleep(0.3)
        check("valores inválidos de dificuldade são recusados", h.room["difficulty"] == "normal" and all(p["ready"] for p in h.room["players"] if p))
        drain(h)
        h.send(t="limit", v=40); await asyncio.sleep(0.2)
        for c in cl: c.send(t="ready", v=True)
        await asyncio.sleep(0.2)
        h.send(t="diff", v="easy"); await asyncio.sleep(0.3)
        check("dificuldade Fácil: todos veem e o 'pronto' de todos foi desfeito", h.room["difficulty"] == "easy" and q.room["difficulty"] == "easy" and not any(p["ready"] for p in q.room["players"] if p), q.room)
        check("tempo e dificuldade são independentes (o tempo continua 40 s)", h.room["limit"] == 40 and q.room["limit"] == 40)
        check("lista de mapas Fácil: só os 6 mapas novos II de Dupla, todos fáceis", len(h.room["maps"]) == 6 and all(LEVELS[i]["players"] == 2 and LEVELS[i]["diff"] == "easy" for i in h.room["maps"]) and h.room["maps"] == q.room["maps"], h.room["maps"])
        check("avisa a mudança e o que acontece com o mapa escolhido", any("Fácil" in n["msg"] for n in h.notices), h.notices[-1:])
        # selecionar mapa: o servidor escolhe a variante da dificuldade
        drain(h); h.send(t="level", mid="duo-n1-hard"); await asyncio.sleep(0.2)
        check("pedir a variante difícil numa sala Fácil carrega a variante FÁCIL (o servidor decide)", h.room["level"] == BY_MID["duo-n1-easy"] == q.room["level"], h.room["level"])
        h.send(t="level", mid="duo-n2-normal"); await asyncio.sleep(0.2)
        check("pedir pelo mid de outra dificuldade também mapeia para a dificuldade da sala", h.room["level"] == BY_MID["duo-n2-easy"])
        h.send(t="level", n=BY_MID["duo-n3-hard"]); await asyncio.sleep(0.2)
        check("e por índice numérico", h.room["level"] == BY_MID["duo-n3-easy"])
        drain(h); h.send(t="level", mid="classic-3-duo"); e = await h.expect("err")
        check("mapa clássico (só Normal) numa sala Fácil é recusado com o motivo", e and "só existe na dificuldade Normal" in e["msg"] and h.room["level"] == BY_MID["duo-n3-easy"], e)
        drain(h); h.send(t="level", mid="trio-n1-easy"); e = await h.expect("err")
        check("mapa de Trio (mesmo na dificuldade certa) continua recusado numa Dupla", e and "exatamente 3" in e["msg"], e)
        for c in cl: c.send(t="ready", v=True)
        await asyncio.sleep(0.2)
        h.send(t="diff", v="hard"); await asyncio.sleep(0.3)
        check("trocar para Difícil leva a MESMA fase para a variante difícil (duo-n3-hard) e desfaz o pronto", h.room["level"] == BY_MID["duo-n3-hard"] and not any(p["ready"] for p in q.room["players"] if p), h.room["level"])
        drain(h); h.send(t="level", mid="classic-1-duo"); await asyncio.sleep(0.2)
        h.send(t="diff", v="normal"); await asyncio.sleep(0.2); h.send(t="level", mid="classic-1-duo"); await asyncio.sleep(0.2)
        check("em Normal o mapa clássico é aceito", h.room["level"] == BY_MID["classic-1-duo"])
        h.send(t="diff", v="hard"); await asyncio.sleep(0.3)
        check("trocar para Difícil com um mapa clássico selecionado limpa a seleção (não existe variante)", h.room["level"] is None and any("clássicos só existem em Normal" in n["msg"] for n in h.notices), h.room["level"])
        # chapters
        h.send(t="mode", v="exp"); await asyncio.sleep(0.2)
        check("expedição Capítulo 1 não existe em Difícil: indisponível e não começa", h.room["exp"]["available"] is False, h.room["exp"])
        for c in cl: c.send(t="ready", v=True)
        await asyncio.sleep(0.2); drain(h); h.send(t="start"); e = await h.expect("err")
        check("começar o Capítulo 1 em Difícil é recusado explicando o motivo", e and "não existe na dificuldade" in e["msg"], e)
        h.send(t="chapter", v=2); await asyncio.sleep(0.3)
        check("Capítulo 2 existe em Difícil com 6 mapas difíceis de Dupla", h.room["exp"]["available"] and h.room["chapter"] == 2 and len(h.room["exp"]["maps"]) == 6 and all(LEVELS[i]["diff"] == "hard" and LEVELS[i]["players"] == 2 for i in h.room["exp"]["maps"]), h.room["exp"])
        check("mudar o capítulo desfaz o pronto", not any(p["ready"] for p in h.room["players"] if p))
        # todos recebem a MESMA variante ao começar
        for c in cl: c.send(t="ready", v=True)
        await asyncio.sleep(0.2); h.send(t="start"); await asyncio.sleep(1.0)
        check("todos recebem a mesma variante difícil (mesmo mapa, drones e lasers idênticos)", h.level and q.level and h.level["level"]["mid"] == "duo-n1-hard" == q.level["level"]["mid"] and json.dumps(h.level["level"], sort_keys=True) == json.dumps(q.level["level"], sort_keys=True) and h.level["level"]["drones"] and h.level["level"]["lasers"], h.level and h.level["level"]["mid"])
        check("nível traz dificuldade e orientação visual (guide) coerentes", h.level["level"]["diff"] == "hard" and h.level["level"]["guide"] is False and h.level["exp"]["chapter"] == 2 and h.level["exp"]["diff"] == "hard")
        # configurações travadas durante a tentativa
        drain(h); h.send(t="diff", v="easy"); h.send(t="chapter", v=1); h.send(t="size", n=3); h.send(t="limit", v=10); h.send(t="mode", v="free"); await asyncio.sleep(0.4)
        check("durante a tentativa dificuldade, capítulo, modalidade, tempo e modo ficam travados", h.room["difficulty"] == "hard" and h.room["chapter"] == 2 and h.room["size"] == 2 and h.room["limit"] == 40 and h.room["mode"] == "exp", h.room)
        # reinício restaura os parâmetros certos
        for _ in range(60):
            if h.snap and h.snap["ph"] == "play": break
            await asyncio.sleep(0.1)
        h.send(t="restart", a=h.snap["a"]); await asyncio.sleep(0.5)
        check("reiniciar mantém variante e parâmetros (tempo 40 s, mesmo mapa difícil)", h.snap["lim"] == 40 and h.level["level"]["mid"] == "duo-n1-hard" and h.snap["a"] == 2, h.snap)
        # desconexão não muda modalidade nem dificuldade
        q.w.close(); await asyncio.sleep(0.7)
        check("desconexão: volta ao lobby e mantém modalidade, dificuldade e capítulo", h.room["phase"] == "lobby" and h.room["size"] == 2 and h.room["difficulty"] == "hard" and h.room["chapter"] == 2, h.room)
        h.send(t="leave"); await asyncio.sleep(0.4)

        print("Checkpoint versionado: v1 (antigo, Normal) migra; v2 com dificuldade valida")
        cl, code = await make_room(2); h, q = cl
        h.send(t="size", n=2); h.send(t="limit", v=40); await asyncio.sleep(0.3)
        ids = exp_maps(2, 1, "normal")
        per = [{"mid": LEVELS[i]["mid"], "time": 6.0 + k, "defeats": k % 2} for k, i in enumerate(ids[:2])]
        stats = {"active": 20.5, "defeats": 1, "done": 2, "per": per}
        v1 = {"v": 1, "seq": {"id": "expedicao-dupla", "ver": 1}, "mod": 2, "limit": 40, "next": 2, "stats": stats, "saved": 1}
        h.send(t="exp", a="continue", ck=v1); await asyncio.sleep(0.4)
        check("checkpoint ANTIGO (v1, sem dificuldade) continua carregando: vale como Normal, Capítulo 1", h.room["exp"]["step"] == 2 and h.room["exp"]["diff"] == "normal" and h.room["exp"]["chapter"] == 1 and h.room["exp"]["restored"], h.room["exp"])
        h.send(t="diff", v="hard"); await asyncio.sleep(0.3)
        drain(h); h.send(t="exp", a="continue", ck=v1); e = await h.expect("err")
        check("o mesmo checkpoint antigo é recusado em outra dificuldade", e and "Normal" in e["msg"], e)
        h.send(t="diff", v="normal"); await asyncio.sleep(0.3)
        v2 = dict(v1, v=2, diff="normal"); h.send(t="exp", a="continue", ck=v2); await asyncio.sleep(0.3)
        check("checkpoint v2 com dificuldade Normal também carrega", h.room["exp"]["step"] == 2)
        drain(h); h.send(t="exp", a="continue", ck=dict(v2, diff="hard")); e = await h.expect("err")
        check("checkpoint v2 de outra dificuldade é recusado", e and "dificuldade" in e["msg"], e)
        drain(h); h.send(t="chapter", v=2); await asyncio.sleep(0.3); h.send(t="exp", a="continue", ck=v2); e = await h.expect("err")
        check("checkpoint do Capítulo 1 não continua no Capítulo 2 (explica)", e and "Capítulo 1" in e["msg"], e)
        drain(h); h.send(t="diff", v="easy"); await asyncio.sleep(0.3)
        ids2 = exp_maps(2, 2, "easy")
        per2 = [{"mid": LEVELS[i]["mid"], "time": 5.0, "defeats": 0} for i in ids2[:3]]
        v2e = {"v": 2, "seq": {"id": "expedicao2-dupla", "ver": 1}, "mod": 2, "diff": "easy", "limit": 40, "next": 3, "stats": {"active": 20.0, "defeats": 0, "done": 3, "per": per2}, "saved": 2}
        h.send(t="exp", a="continue", ck=v2e); await asyncio.sleep(0.3)
        check("checkpoint v2 do Capítulo 2 Fácil restaura fase 4 de 6 com as estatísticas", h.room["exp"]["step"] == 3 and h.room["exp"]["diff"] == "easy" and h.room["exp"]["chapter"] == 2 and h.room["exp"]["stats"]["done"] == 3, h.room["exp"])
        drain(h); h.send(t="exp", a="continue", ck=dict(v2e, stats=dict(v2e["stats"], per=[dict(x, mid=x["mid"].replace("easy", "hard")) for x in per2]))); e = await h.expect("err")
        check("checkpoint com fases de outra dificuldade é recusado", e is not None)
        check("o resultado enviado informa dificuldade e capítulo (conferido na expedição jogada abaixo)", True)
        for c in cl: c.send(t="leave")
        await asyncio.sleep(0.4)

        for n_players, label in ((2, "Dupla"), (3, "Trio")):
            print(f"Expedição Capítulo 2 FÁCIL — {label} (jogada por robôs cuidadosos)")
            cl, code = await make_room(n_players); h = cl[0]
            h.send(t="size", n=n_players); h.send(t="diff", v="easy"); h.send(t="chapter", v=2); h.send(t="mode", v="exp"); h.send(t="limit", v=25); await asyncio.sleep(0.4)
            for c in cl: c.send(t="ready", v=True)
            await asyncio.sleep(0.3); h.send(t="start"); await asyncio.sleep(1.0)
            check(f"{label}: começa Capítulo 2 · fase 1 de 6 · Fácil", h.level and h.level["exp"]["chapter"] == 2 and h.level["exp"]["step"] == 1 and h.level["level"]["diff"] == "easy", h.level and h.level["exp"])
            stop = asyncio.Event(); tasks = [asyncio.ensure_future(robot2(c, k, stop)) for k, c in enumerate(cl)]
            t_end = time.monotonic() + 300
            while time.monotonic() < t_end and not (h.result and h.result["final"]):
                await asyncio.sleep(0.5)
            stop.set(); await asyncio.gather(*tasks, return_exceptions=True)
            fin = h.result
            check(f"{label}: concluiu as 6 fases do Capítulo 2 (Fácil) com clientes reais", fin and fin["final"] and fin["step"] == 6, fin and (fin["step"], fin["stats"]["defeats"]))
            if fin:
                mids = [x["mid"] for x in fin["stats"]["per"]]
                check(f"{label}: todas as fases jogadas são as variantes FÁCEIS do capítulo, na ordem", mids == [LEVELS[i]["mid"] for i in exp_maps(n_players, 2, "easy")] and all(m.endswith("-easy") for m in mids), mids)
                check(f"{label}: resultado informa dificuldade, capítulo e tempo", fin["diff"] == "easy" and fin["chapter"] == 2 and fin["limit"] == 25 and "Fácil" == fin["diff_name"], fin.get("diff_name"))
                print(f"         {label}: tempo ativo {fin['stats']['active']:.1f}s, derrotas {fin['stats']['defeats']}, por fase {[x['time'] for x in fin['stats']['per']]}")
            ids = [m["i"] for m in h.evs]
            check(f"{label}: nenhum evento repetido na expedição inteira", ids == sorted(set(ids)))
            for c in cl: c.send(t="leave")
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
