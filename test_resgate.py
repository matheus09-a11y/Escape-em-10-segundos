#!/usr/bin/env python3
"""Testes da regra RESGATE (sem rede): queda, resgate de 1,5 s, cancelamentos, proteção, posição segura, derrota coletiva,
Clássico intacto. Uso: python3 test_resgate.py"""
import copy, math, sys
from coop_levels import LEVELS
from coop_sim import Sim, RESCUE_TIME, PROT_TIME, RESCUE_R

DT = 1 / 60
FAILS = []

def check(name, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: FAILS.append(name)

def mk(n=3, rescue=True, spikes=(), lasers=(), walls=(), limit=60):
    lv = copy.deepcopy(LEVELS[0])
    lv["walls"] = [list(w) for w in walls]; lv["spikes"] = [list(s) for s in spikes]; lv["lasers"] = list(lasers)
    lv["key"] = [700, 450]; lv["door"] = [780, 480]
    sim = Sim(lv, [[r] for r in range(n)] if n else [], limit=limit, rescue=rescue)
    while sim.phase != "play":
        sim.tick(DT)
    return sim

def run(sim, s):
    for _ in range(int(round(s / DT))):
        sim.tick(DT)

def place(sim, i, x, y):
    sim.pos[i][0], sim.pos[i][1] = float(x), float(y)

def spread(sim):
    for i in range(sim.n):
        place(sim, i, 100, 100 + i * 120)

def evs(sim, kind):
    return [e for e in sim.events if e[0] == kind]

# ---- Clássico: uma morte encerra a tentativa de todos
sim = mk(3, rescue=False, spikes=[(400, 0, 80, 500)]); spread(sim); place(sim, 0, 440, 250); run(sim, 0.1)
check("Clássico: atingido encerra a tentativa", sim.phase == "lost" and "rs" not in sim.snapshot())

# ---- Resgate: dupla
sim = mk(2, spikes=[(400, 0, 80, 500)]); spread(sim)
place(sim, 0, 380, 250); sim.set_input(0, 1, 0); run(sim, 0.4)
check("Resgate: atingido fica caído (não perde)", sim.phase == "play" and sim.st[0] == 1 and sim.st[1] == 0, (sim.phase, sim.st))
check("posição do caído é segura (fora dos espinhos)", not sim._persist(*sim.pos[0]), sim.pos[0])
p0 = tuple(sim.pos[0]); sim.set_input(0, 1, 0); run(sim, 0.3)
check("caído não anda", tuple(sim.pos[0]) == p0)
check("snapshot traz rs", sim.snapshot()["rs"][0][0] == 1)
# dupla: o único parceiro vivo resgata
place(sim, 1, p0[0] - 40, p0[1]); sim.set_input(1, 0, 0); sim.set_rescue(1, True); run(sim, 0.7)
pr = sim.snapshot()["rs"][0]
check("progresso do resgate sobe (~0,7/1,5)", 0.35 < pr[1] < 0.6 and pr[2] == 1, pr)
run(sim, 1.0)
check("resgate completo após 1,5 s", sim.st[0] == 2 and sim.phase == "play", sim.st)
sim.set_rescue(1, False)
# proteção: ainda dentro dos espinhos? (posição segura, mas anda para dentro: protegido não sofre dano)
sim.set_input(0, 1, 0); run(sim, 0.5)
check("protegido não sofre dano (anda pelos espinhos)", sim.st[0] in (2,) and sim.phase == "play", sim.st)
sim.set_input(0, 0, 0); place(sim, 0, 440, 250); run(sim, PROT_TIME + 0.3)
check("proteção acaba e volta a ser ativo -> cai de novo no espinho", sim.st[0] == 1, sim.st)

# ---- cancelamentos
sim = mk(3, spikes=[(400, 0, 80, 500)]); spread(sim); place(sim, 0, 440, 250); run(sim, 0.1)
sp = tuple(sim.pos[0])
place(sim, 1, sp[0] - 40, sp[1]); sim.set_rescue(1, True); run(sim, 0.8)
sim.set_input(1, 1, 0); run(sim, 0.1); sim.set_input(1, 0, 0)
check("mover cancela o resgate e zera o progresso", sim.rprog[0] == 0 and sim.st[0] == 1)
place(sim, 1, sp[0] - 40, sp[1]); run(sim, 0.8); sim.set_rescue(1, False); run(sim, 0.1)
check("soltar a ação cancela", sim.rprog[0] == 0)
sim.set_rescue(1, True); place(sim, 1, sp[0] - 40, sp[1]); run(sim, 0.8); place(sim, 1, sp[0] - 200, sp[1]); run(sim, 0.1)
check("sair do alcance cancela", sim.rprog[0] == 0 and sim.st[0] == 1)
# dois resgatadores não somam
sim.set_rescue(1, True); sim.set_rescue(2, True)
place(sim, 1, sp[0] - 30, sp[1]); place(sim, 2, sp[0] - 40, sp[1] + 10); run(sim, 1.0)
check("dois resgatadores: um só relógio (não completa em 1 s)", sim.st[0] == 1)
run(sim, 0.7)
check("completa uma vez só e um só resgatador", sim.st[0] == 2 and sim.rby[0] == -1)
# ---- derrota coletiva
sim = mk(3, spikes=[(400, 0, 80, 500)]); spread(sim)
for i in range(3): place(sim, i, 440, 100 + i * 150)
run(sim, 0.2)
check("todos caídos: tentativa perdida", sim.phase == "lost", sim.phase)
# ---- caído não conta para vitória e vitória bloqueada
sim = mk(2); spread(sim); sim.has_key = True
place(sim, 0, 780, 480); place(sim, 1, 100, 100); run(sim, 0.2)
sim.st[1] = 1; place(sim, 0, 780, 480); sim.has_key = True; run(sim, 0.3)
check("sem vitória enquanto alguém está caído", sim.phase == "play" and sim.st[1] == 1, sim.phase)
# ---- tempo acaba durante resgate
sim = mk(2, spikes=[(400, 0, 80, 500)], limit=3); spread(sim); place(sim, 0, 440, 250); run(sim, 0.1)
place(sim, 1, sim.pos[0][0] - 40, sim.pos[0][1]); sim.set_rescue(1, True)
run(sim, 5)
check("tempo esgotado durante resgate encerra normalmente", sim.phase == "lost")
# ---- posição segura não atravessa barreira
sim = mk(2, walls=[(300, 0, 20, 500)], spikes=[(330, 200, 60, 100)]); spread(sim)
place(sim, 0, 280, 250); run(sim, 0.1)
sim.trail[0] = [(280.0, 250.0)]
place(sim, 0, 345, 250)               # dentro dos espinhos, lado direito da parede
sim.trail[0] = [(280.0, 250.0)]       # última posição segura está do OUTRO lado da parede
sim._fall(0, "spike")
check("nunca reposiciona atravessando parede (sem caminho -> derrota segura)", sim.phase == "lost" or (sim.pos[0][0] > 320), (sim.phase, sim.pos[0]))
# ---- reinício limpa estado
sim = mk(2, spikes=[(400, 0, 80, 500)]); spread(sim); place(sim, 0, 440, 250); run(sim, 0.1)
sim.reset()
check("reset limpa quedas/progresso/proteção", sim.st == [0, 0] and sim.rprog == [0.0, 0.0] and sim.rby == [-1, -1])
# ---- Clássico não tem campos novos
sim = mk(2, rescue=False)
check("Clássico: snapshot sem rs", "rs" not in sim.snapshot())


# ---- checkpoints e expedição: a regra faz parte da identidade
import server as S
def ckpt(rule, drop=False):
    e = S.Exp(2, 20, 1, "normal", rule); e.step = 2
    e.per = [{"mid": S.LEVELS[e.maps[i]]["mid"], "time": 5.0, "defeats": 0} for i in range(2)]; e.active = 10.0
    c = e.checkpoint()
    if drop: c.pop("rule")
    return c
x, why = S.validate_ckpt(ckpt("classic", drop=True), 2, 20, "normal", 1, "classic")
check("checkpoint antigo (sem regra) vale como Clássico", x is not None and x.rule == "classic", why)
x, why = S.validate_ckpt(ckpt("classic", drop=True), 2, 20, "normal", 1, "rescue")
check("checkpoint antigo NÃO vale numa sala em Resgate", x is None and "Clássico" in why, why)
x, why = S.validate_ckpt(ckpt("rescue"), 2, 20, "normal", 1, "classic")
check("checkpoint de Resgate NÃO vale numa sala Clássico", x is None and "Resgate" in why, why)
x, why = S.validate_ckpt(ckpt("rescue"), 2, 20, "normal", 1, "rescue")
check("checkpoint de Resgate vale em Resgate e preserva a regra", x is not None and x.rule == "rescue" and x.checkpoint()["rule"] == "rescue", why)
check("a expedição publica a regra", S.Exp(2, 20, 1, "normal", "rescue").pub()["rule"] == "rescue")

print("\nTUDO OK" if not FAILS else "\nFALHAS: " + ", ".join(FAILS))
sys.exit(1 if FAILS else 0)
