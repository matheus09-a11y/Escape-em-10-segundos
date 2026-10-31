#!/usr/bin/env python3
"""Testes do modo cooperativo (sem rede): robôs seguem roteiros em cada fase e precisamos ver a vitória;
papéis errados precisam perder pelo motivo certo. Uso: python3 test_coop.py"""
import math, sys
from coop_levels import LEVELS, ROLE_IDS
from coop_sim import Sim, laser_state, COUNTDOWN

DT = 1 / 60
FAILS = []

def check(name, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: FAILS.append(name)

def goto(sim, i, x, y, tol=4.5):
    while True:
        px, py = sim.pos[i]
        d = math.hypot(x - px, y - py)
        if d < tol:
            sim.set_input(i, 0, 0); return
        sim.set_input(i, (x - px) / d, (y - py) / d)
        yield

def wait(cond):
    while not cond():
        yield

def run(sim, bots, max_s=90):
    gens = [b for b in bots]
    live = [True] * len(gens)
    for _ in range(int(max_s / DT)):
        for k, g in enumerate(gens):
            if live[k]:
                try: next(g)
                except StopIteration: live[k] = False
        sim.tick(DT)
        if sim.phase in ("won", "lost") and sim.phase != "count":
            if sim.phase == "won" or sim.attempt >= 1 and sim.phase == "lost":
                return sim.phase
    return sim.phase

def seq(sim, i, steps):
    for s in steps:
        if isinstance(s, tuple): yield from goto(sim, i, *s)
        else: yield from s

def cross_laser(sim, i, lz, x_from, x_to, y):
    """vai até x_from, espera o laser estar apagado com folga e atravessa."""
    yield from goto(sim, i, x_from, y)
    yield from wait(lambda: sim.phase == "play" and laser_state(lz, sim.t) == 0 and (sim.t + lz.get("offset", 0)) % (lz["on"] + lz["off"]) < lz["off"] - 0.9)
    yield from goto(sim, i, x_to, y)

def mk(n, roles=("brasa", "onda", "folha")):
    return Sim(LEVELS[n - 1], roles)

def scripts(n, sim):
    lv = LEVELS[n - 1]
    b = []
    if n == 1:
        for i in range(3): b.append(seq(sim, i, [(200, 250), (450, 250), (730, 250)]))
    elif n == 2:
        b.append(seq(sim, 0, [(600, 100), (650, 110), (740, 420)]))
        b.append(seq(sim, 1, [(600, 250), (740, 420)]))
        b.append(seq(sim, 2, [(600, 400), (740, 420)]))
    elif n == 3:
        b.append(seq(sim, 0, [(100, 120), wait(lambda: sim.latched[1]), (150, 420), (300, 420), (740, 250)]))
        b.append(seq(sim, 1, [(150, 250), wait(lambda: sim.gate_open[0]), (300, 250), (480, 70), (620, 420), (740, 250)]))
        b.append(seq(sim, 2, [(150, 250), wait(lambda: sim.gate_open[0]), (300, 250), (620, 420), (740, 250)]))
    elif n == 4:
        lz = lv["lasers"][0]
        b.append(seq(sim, 0, [(90, 80), wait(lambda: sim.latched[2]), (200, 420), (300, 420), (480, 420), cross_laser(sim, 0, lz, 495, 555, 420), (740, 250)]))
        b.append(seq(sim, 1, [(90, 420), wait(lambda: sim.latched[2]), (200, 420), (300, 420), (480, 420), cross_laser(sim, 1, lz, 495, 555, 420), (740, 250)]))
        b.append(seq(sim, 2, [(150, 250), wait(lambda: sim.gate_open[0]), (300, 250), (440, 60), (495, 250), cross_laser(sim, 2, lz, 495, 555, 250), (640, 420), (740, 250)]))
    elif n == 5:
        b.append(seq(sim, 0, [(130, 250), wait(lambda: sim.latched[1] and sim.latched[3]), (200, 420), (300, 420), (480, 100), (560, 100), (760, 230)]))
        b.append(seq(sim, 1, [(40, 340), (200, 340), (200, 250), wait(lambda: sim.gate_open[0]), (300, 250), (500, 250), (570, 250), (610, 300), wait(lambda: sim.pos[2][0] > 585 or sim.esc[2]), (760, 230)]))
        b.append(seq(sim, 2, [(200, 390), (200, 250), wait(lambda: sim.gate_open[0]), (300, 250), (400, 80), (500, 420), wait(lambda: sim.gate_open[2]), (580, 420), (700, 430), (700, 90), (760, 230)]))
    return b

print("Estrutura das fases")
for n, lv in enumerate(LEVELS, 1):
    s = Sim(lv, ROLE_IDS)
    from coop_sim import circle_rect, PLAYER_R
    free = all(not any(circle_rect(p[0], p[1], PLAYER_R, w) for w in lv["walls"]) for p in s.pos)
    check(f"fase {n}: posições iniciais livres", free)
    check(f"fase {n}: placas ligadas a portas existentes", all(0 <= k < len(lv["plates"]) for g in lv["gates"] for k in g["plates"]))

print("Roteiros vencedores")
for n in range(1, 6):
    sim = mk(n)
    res = run(sim, scripts(n, sim), max_s=LEVELS[n - 1]["time"] + COUNTDOWN + 5)
    check(f"fase {n}: vitória dentro do limite", res == "won" and sim.attempt == 1, f"fase={sim.phase} tentativa={sim.attempt} t={sim.t:.1f} res={sim.result}")
    if sim.phase == "won": print(f"         tempo {sim.t:.1f}s de {LEVELS[n-1]['time']}s")

print("Menos de 3 jogadores (1 poder por jogador)")
sim = Sim(LEVELS[0], [["onda"]])
check("1 jogador: snapshot com 1 posição", len(sim.snapshot()["p"]) == 1 and sim.n == 1)
res = run(sim, [seq(sim, 0, [(450, 250), (730, 250)])], max_s=25 + COUNTDOWN + 5)
check("fase 1 com 1 jogador: vitória", res == "won", f"{sim.phase} {sim.result}")
sim = Sim(LEVELS[1], [["brasa"]])
res = run(sim, [seq(sim, 0, [(50, 100), (600, 100), (650, 110), (740, 420)])], max_s=30 + COUNTDOWN + 5)
check("fase 2 com 1 jogador (só brasa, pelo corredor dele): vitória", res == "won", f"{sim.phase} {sim.result}")
sim = Sim(LEVELS[1], [["brasa"]])
res = run(sim, [seq(sim, 0, [(600, 250)])], max_s=15)
check("1 jogador só com brasa morre no laser", sim.phase == "lost" and sim.result["why"] == "laser", f"{sim.phase} {sim.result}")
sim = Sim(LEVELS[0], [["brasa"], ["folha"]])
res = run(sim, [seq(sim, 0, [(450, 250), (730, 250)]), seq(sim, 1, [(450, 250), (730, 250)])], max_s=25 + COUNTDOWN + 5)
check("fase 1 com 2 jogadores: vitória", res == "won" and sim.n == 2, f"{sim.phase} {sim.result}")
sim = Sim(LEVELS[2], [["brasa"], ["folha"]])
res = run(sim, [seq(sim, 0, [(100, 120), wait(lambda: sim.latched[1]), (150, 420), (300, 420), wait(lambda: sim.has_key), (740, 250)]),
                seq(sim, 1, [(150, 250), wait(lambda: sim.gate_open[0]), (300, 250), (480, 70), (620, 420), (740, 250)])], max_s=30 + COUNTDOWN + 5)
check("fase 3 com 2 jogadores (um segura a porta): vitória", res == "won" and sim.n == 2, f"{sim.phase} {sim.result} t={sim.t:.1f}")
sim = Sim(LEVELS[2], [["onda"]])
res = run(sim, [seq(sim, 0, [(100, 120)])], max_s=34)
check("fase 3 com 1 jogador não tem solução (por isso exige 2)", sim.phase == "lost" or sim.phase == "count" or sim.phase == "play", sim.phase)
sim = Sim(LEVELS[1], [["brasa"], ["folha"]])
res = run(sim, [seq(sim, 0, [(600, 100), (650, 110), (740, 420)]), seq(sim, 1, [(600, 400), (740, 420)])], max_s=30 + COUNTDOWN + 5)
check("fase 2 com 2 jogadores (brasa e folha, cada um no seu corredor): vitória", res == "won" and sim.n == 2, f"{sim.phase} {sim.result}")
check("fases 3, 4 e 5 exigem 2, 3 e 3 jogadores", [lv["min"] for lv in LEVELS] == [1, 1, 2, 3, 3])

print("Papéis errados / regras")
def dies(n, who, roles, steps, why, lane=None):
    sim = mk(n, roles)
    if lane: sim.pos[who] = [50.0, float(lane)]
    bots = [(x for x in ()) for _ in range(3)]
    bots[who] = seq(sim, who, steps)
    run(sim, bots, max_s=20)
    ok = sim.phase == "lost" and sim.result and sim.result.get("why") == why and sim.result.get("who") == who
    check(f"fase {n}: {roles[who]} em {why} perde", ok, f"{sim.phase} {sim.result}")
def survives(n, who, roles, steps, lane=None):
    sim = mk(n, roles)
    if lane: sim.pos[who] = [50.0, float(lane)]
    bots = [(x for x in ()) for _ in range(3)]
    bots[who] = seq(sim, who, steps)
    run(sim, bots, max_s=8)
    check(f"fase {n}: {roles[who]} imune cruza sem perder", sim.phase != "lost" and sim.pos[who][0] > 560, f"{sim.phase} {sim.result} pos={sim.pos[who]}")
R = ("brasa", "onda", "folha")
dies(2, 1, R, [(600, 100)], "spike", 100)        # onda no corredor de espinhos
dies(2, 2, R, [(600, 250)], "laser", 250)        # folha no corredor de laser
dies(2, 0, R, [(600, 400)], "saw", 400)          # brasa no corredor de serras
dies(2, 2, R, [(600, 100)], "spike", 100)
dies(2, 0, R, [(600, 250)], "laser", 250)
dies(2, 1, R, [(600, 400)], "saw", 400)
survives(2, 0, R, [(600, 100)], 100); survives(2, 1, R, [(600, 250)], 250); survives(2, 2, R, [(600, 400)], 400)
# o corredor está realmente fechado: tentar passar rente à borda não escapa do perigo
for lane, who, why in ((100, 1, "spike"), (250, 2, "laser"), (400, 0, "saw")):
    for yy in (lane - 60, lane - 45, lane + 45, lane + 60):
        ok = True
        sim = mk(2, R); sim.pos[who] = [50.0, float(max(20, min(480, yy)))]
        bots = [(x for x in ()) for _ in range(3)]; bots[who] = seq(sim, who, [(600, max(20, min(480, yy)))])
        run(sim, bots, max_s=8)
        check(f"fase 2: ninguém passa rente à borda (lane {lane}, y={yy}, {why})", sim.phase == "lost" or sim.pos[who][0] < 300, f"{sim.phase} {sim.pos[who]}")
# tempo esgotado
sim = mk(1); bots = [(x for x in ()) for _ in range(3)]
run(sim, bots, max_s=LEVELS[0]["time"] + COUNTDOWN + 1.0)
check("fase 1: ficar parado esgota o tempo", sim.phase == "lost" and sim.result["why"] == "time", f"{sim.phase} {sim.result}")
# reinício automático
sim = mk(1); sim.tick(DT)
for _ in range(int((COUNTDOWN + LEVELS[0]["time"] + 3) / DT)): sim.tick(DT)
check("depois de perder, reinicia sozinho (tentativa 2)", sim.attempt >= 2 and sim.phase in ("count", "play"), f"{sim.phase} {sim.attempt}")

# porta segurada: soltar a placa fecha a porta e empurra quem estava dentro
sim = mk(3)
for _ in range(int(COUNTDOWN / DT) + 2): sim.tick(DT)
assert sim.phase == "play"
b = [seq(sim, 0, [(100, 120)]), seq(sim, 1, [(150, 250), wait(lambda: sim.gate_open[0]), (210, 250)]), (x for x in ())]
for _ in range(int(6 / DT)):
    for g in b:
        try: next(g)
        except StopIteration: pass
    sim.tick(DT)
check("porta abre com a placa pressionada", sim.gate_open[0] and 200 < sim.pos[1][0] < 220, f"open={sim.gate_open} pos={sim.pos[1]}")
sim.set_input(0, 1, 0)   # o segurador sai da placa
for _ in range(30): sim.tick(DT)
check("soltou a placa: porta fecha", not sim.gate_open[0])
check("quem estava na porta é empurrado para fora (não fica preso nem morre)", sim.phase == "play" and not (200 - 11 < sim.pos[1][0] < 220 + 11), f"{sim.phase} {sim.pos[1]}")

# escapados não seguram placa
sim = mk(3)
for _ in range(int(COUNTDOWN / DT) + 2): sim.tick(DT)
sim.pos[0] = [100.0, 120.0]; sim.tick(DT)
check("placa ativa com alguém em cima", sim.pressed[0])
sim.esc[0] = True; sim.tick(DT)
check("quem escapou não segura a placa", not sim.pressed[0])

# entrada maliciosa
sim = mk(1)
for _ in range(int(COUNTDOWN / DT) + 2): sim.tick(DT)
sim.set_input(0, 1e9, 1e9); x0 = list(sim.pos[0]); sim.tick(DT)
d = math.hypot(sim.pos[0][0] - x0[0], sim.pos[0][1] - x0[1])
check("entrada gigante é limitada à velocidade normal", d <= 260 * DT + 1e-6, f"{d}")
for bad in (float("nan"), float("inf"), "abc", None):
    sim.set_input(0, bad, bad)
check("entradas inválidas (nan/inf/texto/None) viram parado", sim.inp[0] == (0.0, 0.0))

print()
print("FALHAS:" if FAILS else "TUDO OK", FAILS if FAILS else "")
sys.exit(1 if FAILS else 0)
