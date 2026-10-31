#!/usr/bin/env python3
"""Verifica as 12 fases novas (Dupla e Trio): estrutura, alcance geométrico por papel, robôs que vencem com o limite padrão
(25 s), 25 execuções por fase com atrasos e velocidades diferentes por robô (para achar travas que dependam de tempo) e
regras de bloqueio (placa que prende, porta que fecha em cima, vitória cedo demais). Uso: python3 test_fases.py"""
import math, random, sys
from collections import deque
from coop_levels import LEVELS, ROLES
from coop_sim import Sim, circle_rect, saw_pos, PLAYER_R, COUNTDOWN, EXIT_HALF, SPIKE_INSET, SAW_SLACK, W, H

DT = 1 / 60
FAILS = []
def check(name, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: FAILS.append(name)

def goto(sim, i, x, y, tol=5.0, sf=None):
    while True:
        px, py = sim.pos[i]
        d = math.hypot(x - px, y - py)
        if d < tol:
            sim.set_input(i, 0, 0); return
        f = sf[i] if sf else 1.0
        sim.set_input(i, (x - px) / d * f, (y - py) / d * f)
        yield

def wait(cond):
    while not cond():
        yield

def pause(sec):
    for _ in range(int(sec / DT)):
        yield

def seq(sim, i, steps, sf=None):
    for st in steps:
        if isinstance(st, tuple): yield from goto(sim, i, *st, sf=sf)
        else: yield from st

def go_through(sim, i, pts, sf=None):
    for p in pts: yield from goto(sim, i, p[0], p[1], sf=sf)

def hold(sim, i, x, y, until, sf=None):
    """vai até a placa e fica em cima até a condição valer."""
    yield from goto(sim, i, x, y, tol=3.0, sf=sf)
    while not until():
        yield

def delayed(g, secs):
    yield from pause(secs)
    yield from g

SOLO = {}
def solution(n, sim, sf=None):
    S = lambda i, steps: seq(sim, i, steps, sf)
    g = lambda *a: wait(lambda: a[0]())
    if n == 6:      # D1 Revezamento
        return [S(0, [(130, 150), g(lambda: sim.latched[1]), (310, 85), (400, 85), (730, 250)]),
                S(1, [(200, 250), g(lambda: sim.gate_open[0]), (340, 250), (480, 120), (620, 400), (730, 250)])]
    if n == 7:      # D2 Caminhos paralelos
        return [S(0, [(140, 120), g(lambda: sim.gate_open[0]), (210, 85), (260, 85), (600, 85), (600, 250), (440, 250), (730, 250)]),
                S(1, [(140, 380), g(lambda: sim.gate_open[1]), (210, 415), (260, 415), (600, 420), (730, 250)])]
    if n == 8:      # D3 Travessia protegida
        return [S(0, [(200, 90), (430, 90), (500, 90), g(lambda: sim.gate_open[1]), (570, 90), (680, 250), (750, 250)]),
                S(1, [(200, 385), g(lambda: sim.gate_open[0]), (330, 385), (450, 385), (570, 385), (650, 385), (750, 250)])]
    if n == 9:      # D4 Encontro
        return [S(0, [(100, 350), (150, 250), g(lambda: sim.gate_open[0]), (310, 250), (400, 200), (400, 290)]),
                S(1, [(700, 150), (665, 250), g(lambda: sim.gate_open[1]), (490, 250), (400, 290)])]
    if n == 10:     # D5 Apoio em cadeia
        return [S(0, [(130, 150), g(lambda: sim.latched[1]), (230, 85), (330, 85), g(lambda: sim.pressed[2]), (390, 200), (520, 250), (640, 120), (650, 400), (740, 250)]),
                S(1, [(150, 250), g(lambda: sim.gate_open[0]), (270, 250), (380, 150), (390, 400), g(lambda: sim.latched[3]), (510, 415), (650, 400), (740, 250)])]
    if n == 11:     # D6 Fuga em dupla
        return [S(0, [(500, 90), g(lambda: sim.latched[1]), (590, 85), (740, 250)]),
                S(1, [(565, 420), (565, 260), (470, 260), (565, 260), g(lambda: sim.gate_open[0]), (590, 250), (700, 380), (740, 250)])]
    if n == 12:     # T1 Três posições
        return [S(0, [(130, 80), g(lambda: sim.latched[2]), (310, 250), (620, 100), (740, 250)]),
                S(1, [(130, 250), g(lambda: sim.latched[2]), (310, 250), (740, 250)]),
                S(2, [(200, 420), g(lambda: sim.gate_open[0]), (340, 425), (460, 420), (740, 250)])]
    if n == 13:     # T2 Corrente de ajuda
        return [S(0, [(130, 150), g(lambda: sim.latched[1]), (230, 85), (340, 85), g(lambda: sim.gate_open[3]), (400, 250), (520, 250), (650, 120), (740, 380)]),
                S(1, [(150, 250), g(lambda: sim.gate_open[0]), (260, 250), (360, 250), g(lambda: sim.gate_open[3]), (510, 250), (740, 380)]),
                S(2, [(150, 415), g(lambda: sim.gate_open[2]), (260, 415), (400, 415), g(lambda: sim.gate_open[3]), (400, 250), (520, 250), (740, 380)])]
    if n == 14:     # T3 Rotas complementares
        return [S(0, [(540, 90), g(lambda: sim.gate_open[0]), (610, 250), (690, 400), (740, 120)]),
                S(1, [(540, 250), g(lambda: sim.gate_open[0]), (610, 250), (740, 120)]),
                S(2, [(540, 420), g(lambda: sim.gate_open[0]), (610, 250), (740, 120)])]
    if n == 15:     # T4 Controle de passagem
        return [S(0, [(140, 130), g(lambda: sim.pos[2][0] > 280), g(lambda: sim.latched[2]), (230, 85), (300, 85), (350, 300), (470, 415), (600, 300), (690, 120), (740, 400)]),
                S(1, [(150, 250), g(lambda: sim.gate_open[0]), (270, 250), (350, 420), g(lambda: sim.latched[2]), (470, 415), (600, 300), (740, 400)]),
                S(2, [(150, 250), g(lambda: sim.gate_open[0]), (270, 250), g(lambda: sim.gate_open[1]), (480, 250), (600, 250), (690, 120), (740, 400)])]
    if n == 16:     # T5 Revezamento completo
        return [S(0, [(100, 100), g(lambda: sim.latched[1]), (190, 85), (290, 200), g(lambda: sim.pressed[2]), (390, 250), (490, 130), g(lambda: sim.gate_open[5]), (590, 85), (690, 130), (740, 300)]),
                S(1, [(180, 250), (290, 250), g(lambda: sim.latched[3]), (330, 415), (400, 415), (490, 400), g(lambda: sim.latched[5]), (590, 85), (740, 300)]),
                S(2, [(150, 90), g(lambda: sim.gate_open[1]), (190, 85), (290, 85), (290, 410), g(lambda: sim.latched[3]), (330, 415), (400, 415), (500, 250), g(lambda: sim.gate_open[4]), (590, 250), (690, 400), (740, 300)])]
    if n == 17:     # T6 Fuga em trio
        return [S(0, [(540, 90), g(lambda: sim.latched[2]), (610, 250), (740, 250)]),
                S(1, [(540, 250), g(lambda: sim.latched[2]), (610, 250), (740, 250)]),
                S(2, [(540, 420), g(lambda: sim.gate_open[0]), (610, 420), (700, 420), (700, 130), (740, 250)])]

def make(n):
    lv = LEVELS[n - 1]
    roles = [[r] for r in lv["roles"]]
    return Sim(lv, roles, limit=25)

def play(n, bots, max_s=40):
    sim = make(n)
    gens = bots(sim)
    live = [True] * len(gens)
    for _ in range(int((max_s + COUNTDOWN) / DT)):
        for k, g in enumerate(gens):
            if live[k]:
                try: next(g)
                except StopIteration: live[k] = False
        sim.tick(DT)
        if sim.phase in ("won", "lost"): break
    return sim

def hazard_cells(lv, role):
    """predicado: o ponto (x,y) é perigoso para quem tem esse papel? (espinhos/lasers ligados/serras no meio do percurso)"""
    imm = ROLES[role]["immune"]
    def bad(x, y):
        if imm != "spike":
            for sp in lv["spikes"]:
                if circle_rect(x, y, PLAYER_R, [sp[0] + SPIKE_INSET, sp[1] + SPIKE_INSET, sp[2] - 2 * SPIKE_INSET, sp[3] - 2 * SPIKE_INSET]): return True
        if imm != "laser":
            for l in lv["lasers"]:
                r = l["r"]
                if circle_rect(x, y, PLAYER_R, [r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4]): return True
        if imm != "saw":
            for m in lv["saws"]:
                if (x - m["x1"]) ** 2 + (y - m["y1"]) ** 2 < (PLAYER_R + m["r"] - SAW_SLACK) ** 2: return True
        return False
    return bad

def reach(lv, start, role, gates_open=True):
    """BFS em grade de 8 u: o que este jogador alcança com TODAS as portas abertas (alcance geométrico)."""
    st = 8
    bad = hazard_cells(lv, role)
    walls = lv["walls"]
    closed = [] if gates_open else [g["r"] for g in lv["gates"]]
    def free(x, y):
        if not (PLAYER_R <= x <= W - PLAYER_R and PLAYER_R <= y <= H - PLAYER_R): return False
        for w in walls + closed:
            if circle_rect(x, y, PLAYER_R, w): return False
        return not bad(x, y)
    sx, sy = round(start[0] / st) * st, round(start[1] / st) * st
    seen = {(sx, sy)}; q = deque([(sx, sy)])
    while q:
        x, y = q.popleft()
        for dx, dy in ((st, 0), (-st, 0), (0, st), (0, -st)):
            nx, ny = x + dx, y + dy
            if (nx, ny) not in seen and free(nx, ny): seen.add((nx, ny)); q.append((nx, ny))
    return seen, st

def near(cells, st, x, y, tol=14):
    return any(abs(cx - x) <= tol and abs(cy - y) <= tol for cx, cy in cells)

print("Estrutura e alcance (portas abertas)")
for n in range(6, 18):
    lv = LEVELS[n - 1]; k = lv["players"]
    tag = f"[{lv['set']} {n}: {lv['name']}]"
    check(f"{tag} exige exatamente {k} jogadores, papéis fixos {lv['roles']}", lv["players"] == k and len(lv["starts"]) == k and lv["fixed"] and lv["min"] == k)
    ok = all(not any(circle_rect(p[0], p[1], PLAYER_R, w) for w in lv["walls"]) for p in lv["starts"])
    check(f"{tag} largadas livres de parede", ok)
    inw = lambda x, y: any(circle_rect(x, y, PLAYER_R, w) for w in lv["walls"]) or any(circle_rect(x, y, PLAYER_R, g["r"]) for g in lv["gates"])
    check(f"{tag} placas, chave e saída fora de paredes e portas", all(not inw(p["x"], p["y"]) for p in lv["plates"]) and not inw(*lv["key"]) and not inw(*lv["door"]))
    check(f"{tag} placas ligadas a portas existentes e cada porta tem placa", all(0 <= q < len(lv["plates"]) for g in lv["gates"] for q in g["plates"]) and {q for g in lv["gates"] for q in g["plates"]} == set(range(len(lv["plates"]))))
    check(f"{tag} saída inteira dentro do mapa", lv["door"][0] + EXIT_HALF <= W and lv["door"][1] + EXIT_HALF <= H and lv["door"][0] - EXIT_HALF >= 0 and lv["door"][1] - EXIT_HALF >= 0)
    cells = []
    for i in range(k):
        c, st = reach(lv, lv["starts"][i], lv["roles"][i]); cells.append((c, st))
    allc = set().union(*[c for c, _ in cells])
    check(f"{tag} todos alcançam a saída (portas abertas)", all(near(c, st, *lv["door"], tol=EXIT_HALF - 12) for c, st in cells))
    check(f"{tag} alguém alcança a chave e cada placa/interruptor", near(allc, 8, *lv["key"]) and all(near(allc, 8, p["x"], p["y"]) for p in lv["plates"]))

print("Robôs vencem com o limite padrão de 25 s")
TIMES = {}
for n in range(6, 18):
    lv = LEVELS[n - 1]; tag = f"[{lv['set']} {n}: {lv['name']}]"
    sim = play(n, lambda s: solution(n, s))
    won = sim.phase == "won" and sim.attempt == 1
    TIMES[n] = sim.t
    check(f"{tag} vitória na 1ª tentativa em {sim.t:.1f} s (limite 25 s)", won and sim.t <= 12, f"{sim.phase} t={sim.t:.1f} {sim.result}")

print("Perturbação de tempo: 25 execuções por fase (atrasos e velocidades diferentes)")
for n in range(6, 18):
    lv = LEVELS[n - 1]; tag = f"[{lv['set']} {n}: {lv['name']}]"
    rng = random.Random(1000 + n); worst = 0; bad = []
    for trial in range(25):
        k = lv["players"]
        sf = [rng.uniform(0.75, 1.0) for _ in range(k)]
        dl = [rng.uniform(0, 1.5) for _ in range(k)]
        def bots(s, sf=sf, dl=dl, n=n):
            sol = solution(n, s, sf)
            return [delayed(g, dl[i]) for i, g in enumerate(sol)]
        sim = play(n, bots, max_s=60)
        if sim.phase != "won" or sim.attempt != 1 or sim.t > 25: bad.append((trial, sim.phase, round(sim.t, 1), sim.result))
        worst = max(worst, sim.t)
    check(f"{tag} 25/25 vitórias sem morte, pior caso {worst:.1f} s (≤ 25 s)", not bad, bad[:3])

print()
print("FALHAS:" if FAILS else "TUDO OK", FAILS if FAILS else "")
sys.exit(1 if FAILS else 0)
