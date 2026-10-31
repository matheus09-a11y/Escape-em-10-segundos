#!/usr/bin/env python3
"""Regra RESGATE com clientes reais (WebSocket): regra no lobby, queda, resgate pela ação 'rs', eventos iguais para todos,
Clássico intacto, regra fixa durante a tentativa, checkpoints por regra, desconexão não derruba. Uso: python3 test_resgate_ws.py"""
import asyncio, json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
exp_src = open(os.path.join(here, "test_expedicao.py")).read().split("async def main():")[0].replace("8821", "8851")
E = {"__name__": "E", "__file__": os.path.join(here, "test_expedicao.py")}; exec(exp_src, E)
T, check, FAILS, make_room = E["T"], E["check"], E["FAILS"], E["make_room"]
from coop_levels import LEVELS

async def drive(c, code, secs):
    """manda comandos de movimento numerados (1 por 1/60 s), como o navegador"""
    c.seq = getattr(c, "seq", 1); t = 0.0
    while t < secs:
        c.send(t="mv", s=c.seq, d=[code] * 2); c.seq += 2
        await asyncio.sleep(1 / 30); t += 1 / 30

async def hold_rescue(c, secs):
    t = 0.0
    while t < secs:
        c.send(t="rs", v=True); await asyncio.sleep(0.2); t += 0.2
    c.send(t="rs", v=False)

async def wait_play(cl):
    for _ in range(80):
        if all(c.snap and c.snap["ph"] == "play" for c in cl): return True
        await asyncio.sleep(0.1)
    return False

async def start(cl, rule, mid="classic-2"):
    h = cl[0]
    for k, c in enumerate(cl): c.send(t="role", role=["onda", "brasa", "folha"][k])
    h.send(t="rule", v=rule); h.send(t="level", mid=mid); await asyncio.sleep(0.4)
    for c in cl: c.send(t="ready", v=True)
    await asyncio.sleep(0.3); h.send(t="start")
    return await wait_play(cl)

async def main():
    env = dict(os.environ, PORT="8851", HOST="127.0.0.1", REQUIRE_BUILD="0")
    srv = subprocess.Popen([sys.executable, "server.py"], cwd=here, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try: await asyncio.open_connection("127.0.0.1", 8851); break
            except OSError: await asyncio.sleep(0.1)
        print("Regra no lobby")
        cl, code = await make_room(3); h = cl[0]
        h.send(t="size", n=3); await asyncio.sleep(0.3)
        check("a regra padrão é Clássico para todos", all(c.room["rule"] == "classic" for c in cl))
        cl[1].send(t="rule", v="rescue"); await asyncio.sleep(0.3)
        check("só o anfitrião muda a regra", all(c.room["rule"] == "classic" for c in cl))
        h.send(t="rule", v="rescue"); await asyncio.sleep(0.3)
        check("anfitrião muda: todos veem Resgate", all(c.room["rule"] == "rescue" and c.room["rule_name"] == "Resgate" for c in cl))
        h.send(t="rule", v="xyz"); await asyncio.sleep(0.2)
        check("valor inválido é rejeitado", h.room["rule"] == "rescue")

        print("Resgate com 3 clientes")
        for k, c in enumerate(cl): c.send(t="role", role=["onda", "brasa", "folha"][k])
        h.send(t="level", mid="classic-2"); await asyncio.sleep(0.3)
        for c in cl: c.send(t="ready", v=True)
        await asyncio.sleep(0.3); h.send(t="start")
        check("a fase começa para todos", await wait_play(cl))
        check("a mensagem de fase informa a regra a todos", all(c.level["rule"] == "rescue" for c in cl))
        check("snapshot traz 'rs' para todos (todos ativos)", all(c.snap.get("rs") and [x[0] for x in c.snap["rs"]] == [0, 0, 0] for c in cl))
        h.send(t="rule", v="classic"); await asyncio.sleep(0.3)
        check("regra não muda durante a tentativa", all(c.room["rule"] == "rescue" for c in cl))
        await drive(cl[0], 1, 1.6)              # jogador 0 corre para os espinhos
        await asyncio.sleep(0.3)
        check("jogador atingido fica caído e a tentativa CONTINUA", all(c.snap["ph"] == "play" and c.snap["rs"][0][0] == 1 for c in cl), [c.snap["ph"] for c in cl])
        downs = [[e for e in c.events if e[0] == "down"] for c in cl]
        check("todos recebem o MESMO evento de queda, uma vez só", all(len(d) == 1 and d[0] == downs[0][0] for d in downs), downs)
        check("todos veem a mesma posição do caído", len({tuple(c.snap["p"][0][:2]) for c in cl}) == 1)
        px = cl[0].snap["p"][0]
        for _ in range(40):                    # anda até ficar perto (mede a posição, não depende de tempo/carga)
            sx, sy = cl[1].snap["p"][1][:2]
            if abs(sy - px[1]) > 6: await drive(cl[1], 7 if sy > px[1] else 3, 0.1)
            elif px[0] - sx > 45: await drive(cl[1], 1, 0.1)
            else: break
            await asyncio.sleep(0.15)
        await asyncio.sleep(0.4)
        d = ((cl[1].snap["p"][1][0] - px[0]) ** 2 + (cl[1].snap["p"][1][1] - px[1]) ** 2) ** .5
        check("amigo chegou perto do caído (para o teste)", d < 70, d)
        ht = asyncio.ensure_future(hold_rescue(cl[1], 0.9)); await asyncio.sleep(0.6)
        prog = cl[2].snap["rs"][0]
        check("todos veem o progresso do resgate (barra) e quem resgata", prog[0] == 1 and 0 < prog[1] < 1 and prog[2] == 1, prog)
        await asyncio.sleep(0.2); await hold_rescue(cl[1], 1.9); await asyncio.sleep(0.3)
        check("resgate concluído: caído volta (protegido) e todos recebem o evento", all(c.snap["rs"][0][0] in (0, 2) for c in cl) and all(any(e[0] == "rescued" and e[1] == 0 and e[2] == 1 for e in c.events) for c in cl))
        await asyncio.sleep(1.8)
        check("a proteção termina e o jogador volta a ficar ativo", all(c.snap["rs"][0][0] == 0 for c in cl))
        check("a tentativa continua na mesma tentativa (sem reinício)", all(c.snap["ph"] == "play" and c.snap["a"] == 1 for c in cl))

        print("Reinício e lobby")
        h.send(t="restart", a=h.snap["a"]); await asyncio.sleep(0.6)
        check("reiniciar limpa quedas e progresso", all(x[0] == 0 and x[1] == 0 for x in h.snap["rs"]))
        print("Desconexão não é queda")
        cl[2].w.close(); await asyncio.sleep(1.0)
        check("quem perde a conexão não vira caído", cl[0].snap["rs"][2][0] == 0 and not any(e[0] == "down" and e[1] == 2 for e in cl[0].events))

        h.send(t="lobby"); await asyncio.sleep(0.5)
        check("voltar ao lobby mantém a regra escolhida", h.room["rule"] == "rescue")

        print("Clássico continua igual")
        cl2, code2 = await make_room(3); h2 = cl2[0]; h2.send(t="size", n=3); await asyncio.sleep(0.3)
        check("Clássico: tentativa começa", await start(cl2, "classic"))
        check("Clássico: snapshot sem 'rs' e mensagem de fase sem regra de resgate", all("rs" not in c.snap and c.level["rule"] == "classic" for c in cl2))
        await drive(cl2[0], 1, 1.6); await asyncio.sleep(0.4)
        check("Clássico: um atingido encerra a tentativa para todos", all(any(e[0] == "lose" for e in c.events) for c in cl2) and not any(e[0] == "down" for c in cl2 for e in c.events))
    finally:
        srv.terminate()
    print("\nTUDO OK" if not FAILS else "\nFALHAS: " + ", ".join(FAILS))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
