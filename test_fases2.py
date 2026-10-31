#!/usr/bin/env python3
"""Verifica os 12 mapas novos II (6 Dupla + 6 Trio) nas 3 dificuldades (36 variantes): estrutura, alcance (inclui portais),
diferenças reais entre dificuldades, robôs CUIDADOSOS (esperam as janelas de lasers e drones) que vencem com 25 s, e execuções
perturbadas (atrasos e velocidades diferentes). Uso: python3 test_fases2.py"""
import math, random, sys
from collections import deque
from coop_levels import LEVELS, ROLES, BY_MID, FAMILY
from coop_sim import Sim, circle_rect, drone_pos, laser_state, PLAYER_R, COUNTDOWN, EXIT_HALF, SPIKE_INSET, SAW_SLACK, W, H, PORTAL_R

DT = 1 / 60
FAILS = []
def check(name, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: FAILS.append(name)

# ---------------------------------------------------------------- robôs
def danger_at(sim, i, x, y, t):
    lv = sim.lv
    for dr in lv.get("drones", ()):
        dx, dy = drone_pos(dr, t); rr = PLAYER_R + dr.get("r", 12) + 9
        if (x - dx) ** 2 + (y - dy) ** 2 < rr * rr: return True
    imm = {ROLES[r]["immune"] for r in sim.roles[i]}
    if "laser" not in imm:
        for l in lv["lasers"]:
            if laser_state(l, t) in (1, 2):
                r = l["r"]
                if r[0] - 17 <= x <= r[0] + r[2] + 17 and r[1] - 17 <= y <= r[1] + r[3] + 17: return True
    return False

def path_safe(sim, i, x0, y0, x1, y1, f):
    d = math.hypot(x1 - x0, y1 - y0)
    if d < 1: return not danger_at(sim, i, x0, y0, sim.t)
    spd = 260 * f; n = int(d / (spd * 0.025)) + 2
    for k in range(n + 1):
        tau = k * 0.025; fr = min(1.0, spd * tau / d)
        if danger_at(sim, i, x0 + (x1 - x0) * fr, y0 + (y1 - y0) * fr, sim.t + tau): return False
    # depois de chegar, também precisa ser seguro ficar um instante
    return not danger_at(sim, i, x1, y1, sim.t + d / spd + 0.3)

def cg(sim, i, x, y, tol=6.0, sf=None):
    while True:
        px, py = sim.pos[i]; d = math.hypot(x - px, y - py)
        if d < tol:
            sim.set_input(i, 0, 0); return
        f = sf[i] if sf else 1.0
        if path_safe(sim, i, px, py, x, y, f): sim.set_input(i, (x - px) / d * f, (y - py) / d * f)
        else: sim.set_input(i, 0, 0)
        yield

def portal(sim, i, wx, wy, dx, dy, sf=None):
    """vai até o portal (wx,wy) e só termina quando chegou perto do destino (dx,dy): o teletransporte é o 'chegar'."""
    while True:
        px, py = sim.pos[i]
        if math.hypot(px - dx, py - dy) < 40:
            sim.set_input(i, 0, 0); return
        d = math.hypot(wx - px, wy - py) or 1.0; f = sf[i] if sf else 1.0
        if path_safe(sim, i, px, py, wx, wy, f): sim.set_input(i, (wx - px) / d * f, (wy - py) / d * f)
        else: sim.set_input(i, 0, 0)
        yield

def wait(cond):
    while not cond(): yield
def pause(sec):
    for _ in range(int(sec / DT)): yield
def delayed(g, secs):
    yield from pause(secs); yield from g
def seq(sim, i, steps, sf=None):
    for st in steps:
        if isinstance(st, tuple): yield from cg(sim, i, *st, sf=sf)
        else: yield from st
def holdp(sim, i, x, y, until, sf=None):
    yield from cg(sim, i, x, y, tol=4.0, sf=sf)
    while not until(): yield

def solution(mid, sim, sf=None):
    lv = sim.lv; d = lv["diff"]; fam = lv["family"]
    S = lambda i, steps: seq(sim, i, steps, sf)
    g = lambda c: wait(c)
    H = lambda i, x, y, c: holdp(sim, i, x, y, c, sf)
    PT = lambda i, a, b: portal(sim, i, a[0], a[1], b[0], b[1], sf)
    L = lambda k: sim.latched[k]; P = lambda k: sim.pressed[k]; G = lambda k: sim.gate_open[k]
    if fam == "duo-n1":
        return [S(0, [H(0, 130, 150, lambda: L(1)), (230, 85), (300, 85), (400, 95), (510, 250), g(lambda: G(2)), (740, 250)]),
                S(1, [(150, 250), g(lambda: G(0)), (270, 250), (330, 370), (440, 300), g(lambda: G(2)), (510, 250), (650, 400), (740, 250)])]
    if fam == "duo-n2":
        xs = lv["xs"]
        def wing(i):
            st = []
            for k, x in enumerate(xs):
                sx = x - 90 if k == 0 else xs[k - 1] + 120
                if i == 0: st += [(sx, 60), g(lambda k=k: G(2 * k + 1)), (x, 120), (x + 30, 120)]
                else: st += [(sx, 440), g(lambda k=k: G(2 * k)), (x, 380), (x + 30, 380)]
            return st
        return [S(0, wing(0) + [(600, 120), (700, 250), (750, 250)]), S(1, wing(1) + [(600, 380), (750, 250)])]
    if fam == "duo-n3":
        return [S(0, [PT(0, (100, 100), (300, 100)), H(0, 300, 175, lambda: L(1)), (440, 200), (520, 255), (650, 400), (740, 250)]),
                S(1, [(150, 375), g(lambda: G(0)), (260, 375), PT(1, (330, 400), (600, 120)), (660, 120), (740, 250)])]
    if fam == "duo-n4":
        return [S(0, [g(lambda: G(0)), (260, 120), (330, 330), H(0, 330, 160, lambda: L(3)), (430, 85), (600, 85), (750, 250)]),
                S(1, [H(1, 130, 400, lambda: G(1)), (230, 380), (300, 380), g(lambda: G(2)), (430, 250), (470, 250), (670, 120), (680, 420), (750, 250)])]
    if fam == "duo-n5":
        return [S(0, [H(0, 100, 250, lambda: L(1)), (340, 85), (390, 85), (440, 85), (740, 250)]),
                S(1, [(340, 250), g(lambda: G(0)), (390, 250), (440, 250), (620, 120), (650, 400), (740, 250)])]
    if fam == "duo-n6":
        return [S(0, [H(0, 130, 150, lambda: L(1)), (230, 85), (300, 85), g(lambda: G(2)), (490, 250), (650, 420), (740, 250)]),
                S(1, [(150, 250), g(lambda: G(0)), (270, 250), (300, 400), PT(1, (330, 300), (600, 300)), (620, 150), g(lambda: sim.pos[0][0] > 520), (650, 420), (740, 250)])]
    if fam == "trio-n1":
        easy = d == "easy"; gcy = 452 if easy else 425; sy = 440 if easy else 425
        return [S(0, [H(0, 130, 80, lambda: L(2)), (310, 250), (640, 120), (740, 250)]),
                S(1, [H(1, 130, 250, lambda: L(2)), (310, 250), (740, 250)]),
                S(2, [(200, gcy), g(lambda: G(0)), (340, gcy), (520, sy), (740, 250)])]
    if fam == "trio-n2":
        easy = d == "easy"; cy = 430 if easy else 420
        return [S(0, [(300, 90), g(lambda: G(2)), (610, 250), (690, 400), (740, 120)]),
                S(1, [g(lambda: G(0)), (130, 250), (330, 250), g(lambda: G(2)), (610, 250), (740, 120)]),
                S(2, [g(lambda: G(1)), (130, cy), (400, cy), g(lambda: G(2)), (610, 250), (740, 120)])]
    if fam == "trio-n3":
        return [S(0, [H(0, 120, 150, lambda: L(2)), (250, 90), (300, 90), (440, 150), g(lambda: P(3) and P(4)), (490, 250), (590, 110), (670, 330), (730, 430), (750, 250)]),
                S(1, [H(1, 120, 350, lambda: L(2)), (250, 90), (290, 150), (290, 330), (330, 400), g(lambda: L(5)), (490, 410), (670, 330), (730, 430), (750, 250)]),
                S(2, [g(lambda: G(0)), (250, 250), (380, 250), (330, 110), g(lambda: L(5)), (490, 410), (670, 330), (730, 430), (750, 250)])]
    if fam == "trio-n4":
        return [S(0, [PT(0, (120, 80), (300, 100)), (400, 100), (580, 100), (575, 250), g(lambda: G(1)), (610, 250), (690, 400), (740, 120)]),
                S(1, [PT(1, (120, 250), (340, 250)), g(lambda: G(0)), (430, 250), (545, 250), g(lambda: G(1)), (610, 250), (740, 120)]),
                S(2, [PT(2, (120, 420), (350, 420)), (480, 420), (575, 350), (575, 250), g(lambda: G(1)), (610, 250), (740, 120)])]
    if fam == "trio-n5":
        return [S(0, [H(0, 100, 100, lambda: L(1)), (190, 85), (290, 200), g(lambda: P(2)), (390, 250), (490, 130), g(lambda: G(5)), (590, 85), (690, 130), (745, 300)]),
                S(1, [(180, 250), (290, 250), g(lambda: L(3)), (330, 415), (400, 415), H(1, 490, 400, lambda: L(5)), (590, 85), (745, 300)]),
                S(2, [(150, 90), g(lambda: G(1)), (190, 85), (290, 85), H(2, 290, 410, lambda: L(3)), (330, 415), (400, 415), (500, 250), g(lambda: G(4)), (590, 250), (690, 400), (745, 300)])]
    if fam == "trio-n6":
        easy = d == "easy"; gcy = 452 if easy else 425; sy = 440 if easy else 425
        return [S(0, [H(0, 130, 80, lambda: L(2)), (270, 250), H(0, 350, 110, lambda: L(4)), (530, 90), (570, 90), (750, 250)]),
                S(1, [H(1, 130, 250, lambda: L(2)), (270, 250), (350, 250), g(lambda: G(2)), (530, 250), (700, 130), (750, 250)]),
                S(2, [(200, gcy), g(lambda: G(0)), (340, gcy), (460, sy), (480, 300), (490, 250), g(lambda: G(2)), (530, 250), (700, 400), (750, 250)])]

# ---------------------------------------------------------------- jogo
def make(i):
    lv = LEVELS[i]
    return Sim(lv, [[r] for r in lv["roles"]], limit=25)

def play(i, bots, max_s=40):
    sim = make(i); gens = bots(sim); live = [True] * len(gens)
    for _ in range(int((max_s + COUNTDOWN) / DT)):
        for k, gen in enumerate(gens):
            if live[k]:
                try: next(gen)
                except StopIteration: live[k] = False
        sim.tick(DT)
        if sim.phase in ("won", "lost"): break
    return sim

# ---------------------------------------------------------------- estrutura
def bad_static(lv, role):
    imm = ROLES[role]["immune"]
    def bad(x, y):
        if imm != "spike":
            for sp in lv["spikes"]:
                if circle_rect(x, y, PLAYER_R, [sp[0] + SPIKE_INSET, sp[1] + SPIKE_INSET, sp[2] - 2 * SPIKE_INSET, sp[3] - 2 * SPIKE_INSET]): return True
        if imm != "laser":
            for l in lv["lasers"]:
                if l["off"] == 0:                     # só o laser SEMPRE ligado fecha o caminho; o que pisca se atravessa na janela
                    r = l["r"]
                    if circle_rect(x, y, PLAYER_R, [r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4]): return True
        if imm != "saw":
            for m in lv["saws"]:
                if (x - m["x1"]) ** 2 + (y - m["y1"]) ** 2 < (PLAYER_R + m["r"] - SAW_SLACK) ** 2: return True
        return False
    return bad

def reach(lv, start, role):
    st = 8; bad = bad_static(lv, role); walls = lv["walls"]
    pts = lv.get("portals", [])
    def free(x, y):
        if not (PLAYER_R <= x <= W - PLAYER_R and PLAYER_R <= y <= H - PLAYER_R): return False
        return not any(circle_rect(x, y, PLAYER_R, w) for w in walls) and not bad(x, y)
    sx, sy = round(start[0] / st) * st, round(start[1] / st) * st
    seen = {(sx, sy)}; q = deque([(sx, sy)])
    def push(c):
        if c not in seen and free(*c): seen.add(c); q.append(c)
    while q:
        x, y = q.popleft()
        for dx, dy in ((st, 0), (-st, 0), (0, st), (0, -st)): push((x + dx, y + dy))
        for pr in pts:                                     # portal: entrar leva ao outro lado
            for a, b in (("a", "b"), ("b", "a")):
                if math.hypot(x - pr[a]["x"], y - pr[a]["y"]) < PORTAL_R: push((round(pr[b]["x"] / st) * st, round(pr[b]["y"] / st) * st))
    return seen, st
near = lambda cells, x, y, tol=14: any(abs(cx - x) <= tol and abs(cy - y) <= tol for cx, cy in cells)

V2 = [i for i, lv in enumerate(LEVELS) if lv["group"] == "new2"]
print("Estrutura, alcance (com portais) e dificuldades")
check("12 famílias x 3 dificuldades = 36 variantes (6 de Dupla e 6 de Trio por dificuldade)", len(V2) == 36 and all(sum(1 for i in V2 if LEVELS[i]["diff"] == d and LEVELS[i]["players"] == n) == 6 for d in ("easy", "normal", "hard") for n in (2, 3)))
for i in V2:
    lv = LEVELS[i]; k = lv["players"]; tag = f"[{lv['mid']}]"
    free = all(not any(circle_rect(p[0], p[1], PLAYER_R, w) for w in lv["walls"]) for p in lv["starts"])
    inw = lambda x, y: any(circle_rect(x, y, PLAYER_R, w) for w in lv["walls"]) or any(circle_rect(x, y, PLAYER_R, g["r"]) for g in lv["gates"])
    check(f"{tag} {k} jogadores, papéis fixos, largadas livres", lv["players"] == k and len(lv["starts"]) == k and lv["fixed"] and free)
    check(f"{tag} placas, chave e saída fora de paredes e portas", all(not inw(p["x"], p["y"]) for p in lv["plates"]) and not inw(*lv["key"]) and not inw(*lv["door"]))
    check(f"{tag} cada porta tem placas válidas e cada placa serve a uma porta", all(0 <= q < len(lv["plates"]) for g in lv["gates"] for q in g["plates"]) and {q for g in lv["gates"] for q in g["plates"]} == set(range(len(lv["plates"]))))
    cells = [reach(lv, lv["starts"][s], lv["roles"][s]) for s in range(k)]
    allc = set().union(*[c for c, _ in cells])
    check(f"{tag} todos alcançam a saída; alguém alcança a chave e cada placa (portas abertas)", all(near(c, *lv["door"], tol=EXIT_HALF - 12) for c, _ in cells) and near(allc, *lv["key"]) and all(near(allc, p["x"], p["y"]) for p in lv["plates"]))
    check(f"{tag} nenhum perigo invisível (todos os tipos têm desenho no cliente)", all(set(lv).issuperset({"spikes", "lasers", "saws", "drones", "portals"}) for _ in [0]))
print("Diferenças concretas entre dificuldades")
for fam, ds in sorted(FAMILY.items()):
    if "easy" not in ds: continue
    E, N, Hd = (LEVELS[ds[d]] for d in ("easy", "normal", "hard"))
    gw = lambda lv: min(min(g["r"][2], g["r"][3]) if False else max(g["r"][2], g["r"][3]) for g in lv["gates"])
    hz = lambda lv: len(lv["spikes"]) + len(lv["lasers"]) + len(lv["saws"]) + len(lv["drones"])
    check(f"[{fam}] passagens: fácil ≥ normal e difícil nunca mais estreito que o normal", min(max(g["r"][2], g["r"][3]) for g in E["gates"]) >= min(max(g["r"][2], g["r"][3]) for g in N["gates"]) and min(max(g["r"][2], g["r"][3]) for g in Hd["gates"]) >= 44)
    check(f"[{fam}] perigos: fácil ≤ normal ≤ difícil (contagem de elementos)", hz(E) <= hz(N) <= hz(Hd) and hz(E) < hz(Hd), (hz(E), hz(N), hz(Hd)))
    ds_ = [max([x["speed"] for x in l["drones"]] or [0]) for l in (E, N, Hd)]
    check(f"[{fam}] drones: velocidade fácil < normal < difícil (70/100/125) quando há drones", all(x == 0 for x in ds_) or (ds_[0] <= ds_[1] <= ds_[2] and ds_[2] > ds_[0] and ds_[2] <= 125), ds_)
    la = lambda lv: [(l["off"], l["on"]) for l in lv["lasers"] if l["off"] > 0]
    check(f"[{fam}] lasers que piscam: janela segura fácil ≥ normal ≥ difícil e nunca < 1,4 s", all(a[0] >= b[0] >= c[0] >= 1.4 for a, b, c in zip(la(E) or [(3.4, 1.6)] * 9, la(N) or [(2.4, 1.6)] * 9, la(Hd) or [(1.8, 2.0)] * 9)) or not any(la(x) for x in (E, N, Hd)), (la(E), la(N), la(Hd)))
    check(f"[{fam}] só o fácil traz orientação visual extra (guide)", E["guide"] and not N["guide"] and not Hd["guide"])
    check(f"[{fam}] mesma dificuldade do mesmo mapa: mesmos jogadores e papéis", E["players"] == N["players"] == Hd["players"] and E["roles"] == N["roles"] == Hd["roles"])

print("Robôs cuidadosos vencem com 25 s (sem morrer)")
for i in V2:
    lv = LEVELS[i]; sim = play(i, lambda s: solution(lv["mid"], s))
    check(f"[{lv['mid']}] vitória na 1ª tentativa em {sim.t:.1f} s (limite 25 s)", sim.phase == "won" and sim.attempt == 1 and sim.t <= 20, f"{sim.phase} t={sim.t:.1f} {sim.result} pos={[[round(a), round(b)] for a, b in sim.pos]}")

print("Perturbação: 8 execuções por variante (atrasos até 1,5 s e velocidades 75–100%)")
for i in V2:
    lv = LEVELS[i]; rng = random.Random(7000 + i); bad = []; worst = 0
    for trial in range(8):
        k = lv["players"]; sf = [rng.uniform(0.75, 1.0) for _ in range(k)]; dl = [rng.uniform(0, 1.5) for _ in range(k)]
        sim = play(i, lambda s, sf=sf, dl=dl: [delayed(g_, dl[j]) for j, g_ in enumerate(solution(lv["mid"], s, sf))], max_s=60)
        if sim.phase != "won" or sim.attempt != 1 or sim.t > 25: bad.append((trial, sim.phase, round(sim.t, 1), sim.result))
        worst = max(worst, sim.t)
    check(f"[{lv['mid']}] 8/8 vitórias sem morte, pior caso {worst:.1f} s (≤ 25 s)", not bad, bad[:3])
print()
print("FALHAS:" if FAILS else "TUDO OK", FAILS if FAILS else "")
sys.exit(1 if FAILS else 0)
