#!/usr/bin/env python3
"""Classificação dos mapas por quantidade de jogadores, identificadores e sequências da expedição (sem rede).
Uso: python3 test_mapas.py"""
import sys
from coop_levels import LEVELS, BY_MID, ORDER, EXPEDITIONS, maps_for, compatible, catalog, sequences, ROLES

FAILS = []
def check(name, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: FAILS.append(name)

from coop_levels import DIFF_NAMES, exp_maps, variant_of_family
print("Classificação")
check("todo mapa tem uma quantidade EXATA: 2 ou 3 e uma dificuldade", all(lv["players"] in (2, 3) and lv["diff"] in ("easy", "normal", "hard") for lv in LEVELS))
check("a modalidade confere com a quantidade", all(lv["modality"] == ("duo" if lv["players"] == 2 else "trio") for lv in LEVELS))
for d in ("easy", "normal", "hard"):
    m2, m3 = maps_for(2, d), maps_for(3, d)
    check(f"[{d}] a lista de Dupla só tem mapas de 2 jogadores e a de Trio só de 3, todos da dificuldade", all(LEVELS[i]["players"] == 2 and LEVELS[i]["diff"] == d for i in m2) and all(LEVELS[i]["players"] == 3 and LEVELS[i]["diff"] == d for i in m3))
    alld = [i for i, lv in enumerate(LEVELS) if lv["diff"] == d]
    check(f"[{d}] cada mapa da dificuldade aparece em exatamente uma modalidade (sem sobreposição, nenhum esquecido)", sorted(m2 + m3) == alld and not set(m2) & set(m3), (len(m2), len(m3), len(alld)))
    check(f"[{d}] não existe lista para 1, 4 ou 0 jogadores", maps_for(1, d) == [] and maps_for(4, d) == [] and maps_for(0, d) == [])
check("normal: 15 mapas de Dupla e 17 de Trio; fácil e difícil: 6 e 6 (só os mapas novos II têm essas variantes)", (len(maps_for(2)), len(maps_for(3))) == (15, 17) and all(len(maps_for(n, d)) == 6 for n in (2, 3) for d in ("easy", "hard")))
check("compatible() só aceita a quantidade exata (e a dificuldade, quando pedida)", all(compatible(lv, lv["players"]) and not compatible(lv, 5 - lv["players"]) and not compatible(lv, 1) and compatible(lv, lv["players"], lv["diff"]) and not compatible(lv, lv["players"], "hard" if lv["diff"] != "hard" else "easy") for lv in LEVELS))
print("Classificação por funcionamento real (não pelo nome)")
em_dupla = LEVELS[BY_MID["classic-4"]]
check("'Em dupla' (clássica 4) exige 3 jogadores: é de Trio apesar do nome", em_dupla["name"] == "Em dupla" and em_dupla["players"] == 3 and em_dupla["min"] == 3)
check("clássica 5 'A grande fuga' é de Trio (3 poderes/perigos + placas de segurar)", LEVELS[BY_MID["classic-5"]]["players"] == 3)
for k in (1, 2, 3):
    o, v = LEVELS[BY_MID[f"classic-{k}"]], LEVELS[BY_MID[f"classic-{k}-duo"]]
    same = all(o[f] == v[f] for f in ("walls", "spikes", "lasers", "saws", "plates", "gates", "key", "door"))
    check(f"variante classic-{k}-duo: mesmo desenho do original, 2 largadas, papéis fixos, id próprio", same and o["players"] == 3 and v["players"] == 2 and len(v["starts"]) == 2 and v["fixed"] and v["variant_of"] == o["mid"] and v["mid"] != o["mid"] and v["id"] > 17)
check("todos os mapas antigos (20) são da dificuldade Normal (equilíbrio preservado)", all(lv["diff"] == "normal" for lv in LEVELS[:20]))
print("Variantes por dificuldade")
fams = {}
for lv in LEVELS: fams.setdefault(lv["family"], {})[lv["diff"]] = lv
new2 = {f: v for f, v in fams.items() if len(v) == 3}
check("12 famílias novas II com variante fácil, normal e difícil (6 de Dupla e 6 de Trio)", len(new2) == 12 and sum(1 for v in new2.values() if v["normal"]["players"] == 2) == 6)
check("as variantes de uma família têm o mesmo nome, jogadores e papéis, e mids próprios", all(len({x["name"] for x in v.values()}) == 1 and len({x["players"] for x in v.values()}) == 1 and len({x["mid"] for x in v.values()}) == 3 for v in new2.values()))
check("variant_of_family leva o mapa para a mesma fase da dificuldade pedida", all(variant_of_family(BY_MID[v["normal"]["mid"]], d) == BY_MID[v[d]["mid"]] for v in new2.values() for d in ("easy", "normal", "hard")))
check("mapa antigo não tem variante fácil/difícil", variant_of_family(0, "easy") is None and variant_of_family(0, "hard") is None)
print("Identificadores")
check("mid único para todos os mapas", len({lv["mid"] for lv in LEVELS}) == len(LEVELS) == len(BY_MID))
check("ids numéricos únicos e os antigos 1..17 preservados na mesma posição", [lv["id"] for lv in LEVELS] == list(range(1, len(LEVELS) + 1)))
ANTIGOS = ["Primeiros passos", "Cada um no seu caminho", "Segure a porta", "Em dupla", "A grande fuga", "Revezamento", "Caminhos paralelos", "Travessia protegida", "Encontro", "Apoio em cadeia", "Fuga em dupla",
           "Três posições", "Corrente de ajuda", "Rotas complementares", "Controle de passagem", "Revezamento completo", "Fuga em trio"]
check("os 17 mapas antigos continuam nas mesmas posições/ids (índice e id numérico não mudaram)", [lv["name"] for lv in LEVELS[:17]] == ANTIGOS)
cat = catalog()
check("catálogo traz mid, players, modality, fixed, group, family, diff", all(all(k in c for k in ("mid", "players", "modality", "fixed", "group", "family", "diff")) for c in cat))
print("Expedição (capítulos)")
for (n, chap), e in EXPEDITIONS.items():
    for d in ("easy", "normal", "hard"):
        ids = exp_maps(n, chap, d)
        if chap == 1 and d != "normal":
            check(f"expedição {n} jogadores, capítulo 1, {d}: não existe (capítulo antigo é só Normal)", ids is None); continue
        check(f"expedição {n} jogadores, capítulo {chap}, {d}: 6 mapas distintos de {n} jogadores, dificuldade {d}, na ordem declarada", ids is not None and len(set(ids)) == 6 and all(LEVELS[i]["players"] == n and LEVELS[i]["diff"] == d for i in ids) and [LEVELS[i]["family"] if chap == 2 else LEVELS[i]["mid"] for i in ids] == e["keys"])
        if ids: check(f"expedição {n}/{chap}/{d}: todos os mapas estão na lista da modalidade e dificuldade", all(i in maps_for(n, d) for i in ids))
    check(f"expedição ({n},{chap}) tem id e versão", isinstance(e["id"], str) and isinstance(e["ver"], int))
check("sequências antigas preservadas: ids e versões dos checkpoints antigos", EXPEDITIONS[(2, 1)]["id"] == "expedicao-dupla" and EXPEDITIONS[(3, 1)]["id"] == "expedicao-trio" and EXPEDITIONS[(2, 1)]["ver"] == EXPEDITIONS[(3, 1)]["ver"] == 1)
check("expedições separadas (nenhum mapa em comum entre Dupla/Trio nem entre capítulos)", len({tuple(exp_maps(n, c, "normal")) for (n, c) in EXPEDITIONS}) == 4 and not (set(exp_maps(2, 1, "normal")) | set(exp_maps(2, 2, "normal"))) & (set(exp_maps(3, 1, "normal")) | set(exp_maps(3, 2, "normal"))) and not set(exp_maps(2, 1, "normal")) & set(exp_maps(2, 2, "normal")))
for n in (2, 3):
    ids = exp_maps(n, 1, "normal")
    pars = [LEVELS[i]["par"] for i in ids]
    mech = [len(LEVELS[i]["gates"]) + len(LEVELS[i]["plates"]) + sum(1 for k in ("spikes", "lasers", "saws") if LEVELS[i][k]) for i in ids]
    check(f"expedição {n}/1: a última fase é mais longa e tem mais mecanismos que a primeira (par {pars[0]}→{pars[-1]}, mecanismos {mech[0]}→{mech[-1]})", pars[-1] > pars[0] and mech[-1] >= mech[0])
check("sequences() exportável (ids, versões e mapas por modalidade/capítulo/dificuldade)", set(sequences()) == {"2-1", "3-1", "2-2", "3-2"})
print()
print("FALHAS:" if FAILS else "TUDO OK", FAILS if FAILS else "")
sys.exit(1 if FAILS else 0)
