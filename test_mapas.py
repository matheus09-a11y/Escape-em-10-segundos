#!/usr/bin/env python3
"""Classificação dos mapas por quantidade de jogadores, identificadores e sequências da expedição (sem rede).
Uso: python3 test_mapas.py"""
import sys
from coop_levels import LEVELS, BY_MID, ORDER, EXPEDITIONS, maps_for, compatible, catalog, sequences, ROLES

FAILS = []
def check(name, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: FAILS.append(name)

print("Classificação")
check("todo mapa tem uma quantidade EXATA: 2 ou 3", all(lv["players"] in (2, 3) for lv in LEVELS))
check("a modalidade confere com a quantidade", all(lv["modality"] == ("duo" if lv["players"] == 2 else "trio") for lv in LEVELS))
m2, m3 = maps_for(2), maps_for(3)
check("a lista de Dupla só tem mapas de 2 e a de Trio só de 3", all(LEVELS[i]["players"] == 2 for i in m2) and all(LEVELS[i]["players"] == 3 for i in m3))
check("cada mapa aparece em exatamente uma modalidade (sem sobreposição, nenhum esquecido)", sorted(m2 + m3) == list(range(len(LEVELS))) and not set(m2) & set(m3))
check("não existe lista para 1, 4 ou 0 jogadores (nunca cai em mapa de outra modalidade)", maps_for(1) == [] and maps_for(4) == [] and maps_for(0) == [])
check("compatible() só aceita a quantidade exata", all(compatible(lv, lv["players"]) and not compatible(lv, 5 - lv["players"]) and not compatible(lv, 1) for lv in LEVELS))
check("9 mapas de Dupla e 11 de Trio", len(m2) == 9 and len(m3) == 11, (len(m2), len(m3)))
print("Classificação por funcionamento real (não pelo nome)")
em_dupla = LEVELS[BY_MID["classic-4"]]
check("'Em dupla' (clássica 4) exige 3 jogadores: é de Trio apesar do nome", em_dupla["name"] == "Em dupla" and em_dupla["players"] == 3 and em_dupla["min"] == 3)
check("clássica 5 'A grande fuga' é de Trio (3 poderes/perigos + placas de segurar)", LEVELS[BY_MID["classic-5"]]["players"] == 3)
for k in (1, 2, 3):
    o, v = LEVELS[BY_MID[f"classic-{k}"]], LEVELS[BY_MID[f"classic-{k}-duo"]]
    same = all(o[f] == v[f] for f in ("walls", "spikes", "lasers", "saws", "plates", "gates", "key", "door"))
    check(f"variante classic-{k}-duo: mesmo desenho do original, 2 largadas, papéis fixos, id próprio", same and o["players"] == 3 and v["players"] == 2 and len(v["starts"]) == 2 and v["fixed"] and v["variant_of"] == o["mid"] and v["mid"] != o["mid"] and v["id"] > 17)
print("Identificadores")
check("mid único para os 20 mapas", len({lv["mid"] for lv in LEVELS}) == 20 and len(BY_MID) == 20)
check("ids numéricos únicos e os antigos 1..17 preservados na mesma posição", [lv["id"] for lv in LEVELS] == list(range(1, 21)))
ANTIGOS = ["Primeiros passos", "Cada um no seu caminho", "Segure a porta", "Em dupla", "A grande fuga", "Revezamento", "Caminhos paralelos", "Travessia protegida", "Encontro", "Apoio em cadeia", "Fuga em dupla",
           "Três posições", "Corrente de ajuda", "Rotas complementares", "Controle de passagem", "Revezamento completo", "Fuga em trio"]
check("os 17 mapas antigos continuam nas mesmas posições/ids (índice e id numérico não mudaram)", [lv["name"] for lv in LEVELS[:17]] == ANTIGOS)
cat = catalog()
check("catálogo traz mid, players, modality, fixed, group, family", all(all(k in c for k in ("mid", "players", "modality", "fixed", "group", "family")) for c in cat))
print("Expedição")
for n in (2, 3):
    e = EXPEDITIONS[n]
    check(f"expedição de {n}: 6 mapas distintos, todos de {n} jogadores, na ordem declarada", len(e["maps"]) == 6 and len(set(e["maps"])) == 6 and all(LEVELS[i]["players"] == n for i in e["maps"]) and [LEVELS[i]["mid"] for i in e["maps"]] == e["mids"])
    check(f"expedição de {n}: todos os mapas estão na lista da modalidade", all(i in maps_for(n) for i in e["maps"]))
    check(f"expedição de {n}: tem id e versão", isinstance(e["id"], str) and isinstance(e["ver"], int))
check("expedições separadas (nenhum mapa em comum, ids diferentes)", not set(EXPEDITIONS[2]["maps"]) & set(EXPEDITIONS[3]["maps"]) and EXPEDITIONS[2]["id"] != EXPEDITIONS[3]["id"])
# a ordem cresce em complexidade: 1ª fase usa o mínimo de mecanismos e a última é a mais longa (medido pelo robô perfeito)
for n in (2, 3):
    pars = [LEVELS[i]["par"] for i in EXPEDITIONS[n]["maps"]]
    mech = [len(LEVELS[i]["gates"]) + len(LEVELS[i]["plates"]) + sum(1 for k in ("spikes", "lasers", "saws") if LEVELS[i][k]) for i in EXPEDITIONS[n]["maps"]]
    check(f"expedição de {n}: a última fase é mais longa e tem mais mecanismos que a primeira (par {pars[0]}→{pars[-1]}, mecanismos {mech[0]}→{mech[-1]})", pars[-1] > pars[0] and mech[-1] >= mech[0])
check("sequences() exportável (ids, versões e mapas por modalidade)", set(sequences()) == {"2", "3"})
print()
print("FALHAS:" if FAILS else "TUDO OK", FAILS if FAILS else "")
sys.exit(1 if FAILS else 0)
