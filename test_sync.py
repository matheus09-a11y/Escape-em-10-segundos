#!/usr/bin/env python3
"""Sincronização do cenário entre clientes (drones, portais, lasers, serras, portas, placas): todos recebem o mesmo mapa, a mesma variante,
a mesma partida (gid) e as mesmas entidades; confirmação de carga confere partida e contagem; resync não duplica; mensagens de outra
partida são ignoradas; versão da página. Usa 2 e 3 clientes reais. Uso: python3 test_sync.py"""
import asyncio, json, os, subprocess, sys, time
here = os.path.dirname(os.path.abspath(__file__))
exp_src = open(os.path.join(here, "test_expedicao.py")).read().split("async def main():")[0].replace("8821", "8841")
E = {"__name__": "E", "__file__": os.path.join(here, "test_expedicao.py")}; exec(exp_src, E)
T, check, FAILS, make_room = E["T"], E["check"], E["FAILS"], E["make_room"]
from coop_levels import LEVELS, BY_MID

# guarda TODAS as mensagens recebidas (para comparar entre clientes)
_prev = T.WS.loop
async def _loop3(self):
    self.all = []
    orig = self.q.put
    async def put(m):
        self.all.append(m)
        if m.get("t") == "s":
            self.hist = getattr(self, "hist", {}); self.hist[m["st"]] = m
        await orig(m)
    self.q.put = put
    await _prev(self)
T.WS.loop = _loop3
drain = lambda c: [c.q.get_nowait() for _ in range(c.q.qsize())]
levels_of = lambda c: [m for m in c.all if m.get("t") == "level"]

async def start_room(n, diff, mid_family, mode="free", chapter=2):
    cl, code = await make_room(n); h = cl[0]
    h.send(t="size", n=n); h.send(t="diff", v=diff); await asyncio.sleep(0.3)
    h.send(t="level", mid=f"{mid_family}-{diff}"); await asyncio.sleep(0.3)
    for c in cl: c.send(t="ready", v=True)
    await asyncio.sleep(0.3)
    return cl, code

async def main():
    srvs = []
    for port, req in ((8841, "0"), (8842, "1")):
        env = dict(os.environ, PORT=str(port), HOST="127.0.0.1", REQUIRE_BUILD=req)
        srvs.append(subprocess.Popen([sys.executable, "server.py"], cwd=here, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT))
    try:
        for port in (8841, 8842):
            for _ in range(50):
                try: await asyncio.open_connection("127.0.0.1", port); break
                except OSError: await asyncio.sleep(0.1)
        for n_players, fam, diff, label in ((2, "duo-n3", "hard", "Dupla (portais + laser + drone)"), (3, "trio-n4", "hard", "Trio (portais + lasers + serras + drones)")):
            print(f"Sincronização — {label}")
            cl, code = await start_room(n_players, diff, fam); h = cl[0]
            h.send(t="start"); await asyncio.sleep(1.2)
            lv0 = levels_of(h)
            check(f"todos recebem exatamente UMA mensagem de fase", all(len(levels_of(c)) == 1 for c in cl), [len(levels_of(c)) for c in cl])
            blob = [json.dumps(levels_of(c)[0], sort_keys=True) for c in cl]
            check("a mensagem de fase é IDÊNTICA para todos (mapa, variante, entidades, partida, versão)", len(set(blob)) == 1)
            m = levels_of(cl[-1])[0]
            lv = m["level"]
            check("mesmo mapa e variante de dificuldade para todos", all(levels_of(c)[0]["mid"] == f"{fam}-{diff}" and levels_of(c)[0]["level"]["diff"] == diff for c in cl))
            check("todos recebem o mesmo identificador de partida (gid), versão do mapa e versão do servidor", len({(levels_of(c)[0]["gid"], levels_of(c)[0]["mver"], levels_of(c)[0]["build"]) for c in cl}) == 1)
            real = {k: len(lv[k]) for k in ("walls", "plates", "gates", "spikes", "lasers", "saws", "drones", "portals")}
            check("a contagem de entidades anunciada pelo servidor confere com o que veio na mensagem", m["ent"] == real, (m["ent"], real))
            check("drones, portais e lasers existem na mensagem de TODOS os clientes (não só do anfitrião)", all(len(levels_of(c)[0]["level"]["drones"]) >= 1 and len(levels_of(c)[0]["level"]["portals"]) >= 1 and len(levels_of(c)[0]["level"]["lasers"]) >= 1 for c in cl), real)
            for _ in range(80):
                if all(c.snap and c.snap["ph"] == "play" for c in cl): break
                await asyncio.sleep(0.1)
            await asyncio.sleep(1.5)
            check("todos entram em 'jogo' juntos, na mesma tentativa", all(c.snap["ph"] == "play" and c.snap["a"] == 1 for c in cl))
            check("todos os quadros trazem o mesmo identificador de partida", all(m_["gd"] == m["gid"] for c in cl for m_ in c.hist.values()))
            common = set.intersection(*[set(c.hist) for c in cl])
            same = all(json.dumps(cl[0].hist[st]["p"]) == json.dumps(c.hist[st]["p"]) and cl[0].hist[st]["e"] == c.hist[st]["e"] for st in common for c in cl[1:])
            check(f"posições, estados e tempo idênticos em todos os clientes nos mesmos {len(common)} quadros", len(common) > 20 and same)
            digs = [[x["ent"] for x in c.hist.values() if "ent" in x] for c in cl]
            check("o quadro traz a contagem de entidades de tempos em tempos (conferência) e ela confere", all(d and all(e == real for e in d) for d in digs), [len(d) for d in digs])
            # drones: posição só depende do tempo da tentativa (mesma regra para todos)
            from coop_sim import drone_pos
            dr = lv["drones"][0]; st0 = sorted(common)[len(common) // 2]
            es = [c.hist[st0]["e"] for c in cl]
            check("o tempo da tentativa é o mesmo para todos, logo os drones estão no mesmo lugar", len(set(es)) == 1 and len({drone_pos(levels_of(c)[0]["level"]["drones"][0], es[0]) for c in cl}) == 1)
            # resync: reenvia o estado completo sem duplicar nada
            before = [len(levels_of(c)) for c in cl]
            cl[-1].send(t="resync"); await asyncio.sleep(0.5)
            rs = levels_of(cl[-1])
            check("resync reenvia o estado completo (marcado como resync), só para quem pediu", len(rs) == before[-1] + 1 and rs[-1]["resync"] is True and json.dumps({k: v for k, v in rs[-1].items() if k != "resync"}, sort_keys=True) == json.dumps({k: v for k, v in rs[0].items() if k != "resync"}, sort_keys=True) and len(levels_of(cl[0])) == before[0])
            cl[-1].send(t="resync"); cl[-1].send(t="resync"); await asyncio.sleep(0.4)
            check("pedidos de resync em sequência são limitados (nada de enxurrada)", len(levels_of(cl[-1])) == before[-1] + 1)
            # fingerprints
            for k, c in enumerate(cl): c.send(t="fp", f=f"fp-{k}")
            await asyncio.sleep(0.5)
            fps = [m_ for m_ in cl[0].all if m_.get("t") == "fps"]
            check("impressões digitais do diagnóstico são repassadas a todos (para comparar entre clientes)", fps and all(m_ for m_ in [x for x in cl[1].all if x.get("t") == "fps"]) and sorted(x for x in fps[-1]["l"] if x) == [f"fp-{k}" for k in range(n_players)], fps[-1:] )
            # reinício mantém o mesmo mapa/gid; voltar ao lobby e começar de novo gera outra partida
            gid1 = m["gid"]
            h.send(t="restart", a=h.snap["a"]); await asyncio.sleep(0.5)
            check("reiniciar a tentativa NÃO recria o cenário (mesmo gid, mesmas entidades, tentativa 2 para todos)", all(len(levels_of(c)) >= 1 and c.snap["a"] == 2 and c.snap["gd"] == gid1 for c in cl))
            h.send(t="lobby"); await asyncio.sleep(0.5)
            for c in cl: c.send(t="ready", v=True)
            await asyncio.sleep(0.3); h.send(t="start"); await asyncio.sleep(1.2)
            gids = {levels_of(c)[-1]["gid"] for c in cl}
            check("voltar ao lobby e começar de novo: nova partida (gid maior) igual para todos", len(gids) == 1 and gids.pop() > gid1)
            # mudança de dificuldade: variante nova igual para todos
            h.send(t="lobby"); await asyncio.sleep(0.5)
            h.send(t="diff", v="easy"); await asyncio.sleep(0.4)
            for c in cl: c.send(t="ready", v=True)
            await asyncio.sleep(0.3); h.send(t="start"); await asyncio.sleep(1.2)
            ms = [levels_of(c)[-1] for c in cl]
            check("mudança de dificuldade: todos recebem a MESMA variante fácil, com contagens próprias", len({m_["mid"] for m_ in ms}) == 1 and ms[0]["mid"] == f"{fam}-easy" and len({json.dumps(m_, sort_keys=True) for m_ in ms}) == 1 and ms[0]["ent"] == {k: len(ms[0]["level"][k]) for k in ms[0]["ent"]})
            for c in cl: c.send(t="leave")
            await asyncio.sleep(0.4)

        print("Confirmação de carga: partida e entidades")
        cl, code = await start_room(2, "normal", "duo-n5"); h, q = cl
        q.noload = True; h.send(t="start"); await asyncio.sleep(1.5)
        check("carga lenta: com um cliente ainda carregando, ninguém começa e o tempo não corre", all(c.snap["ph"] == "wait" and c.snap["e"] == 0 for c in cl) and h.snap["ld"] == [1, 0], h.snap)
        gid = levels_of(h)[-1]["gid"]
        q.send(t="loaded", g=gid - 1); await asyncio.sleep(0.4)
        check("confirmação de OUTRA partida (gid antigo) é ignorada", h.snap["ph"] == "wait" and h.snap["ld"] == [1, 0])
        ent_ok = levels_of(q)[-1]["ent"]; bad = dict(ent_ok, drones=ent_ok["drones"] - 1)
        n0 = len(levels_of(q)); q.send(t="loaded", g=gid, ent=bad); await asyncio.sleep(0.5)
        check("carga com entidades diferentes (faltou um drone): o servidor reenvia o estado completo a quem errou", len(levels_of(q)) == n0 + 1 and levels_of(q)[-1]["resync"] is True and h.snap["ph"] == "wait" and len(levels_of(h)) == 1, (len(levels_of(q)), n0))
        q.send(t="loaded", g=gid, ent=ent_ok); await asyncio.sleep(1.0)
        check("depois de confirmar certo (mesma partida e mesmas entidades), a contagem de 3 s começa", h.snap["ph"] in ("count", "play") and q.snap["ph"] in ("count", "play"))
        for c in cl: c.send(t="leave")
        await asyncio.sleep(0.4)
        cl, code = await start_room(2, "normal", "duo-n5"); h, q = cl
        q.noload = True; h.send(t="start"); await asyncio.sleep(1.0)
        gid = levels_of(h)[-1]["gid"]; ent_ok = levels_of(q)[-1]["ent"]; bad = dict(ent_ok, drones=0)
        q.send(t="loaded", g=gid, ent=bad); await asyncio.sleep(0.3); q.send(t="loaded", g=gid, ent=bad); await asyncio.sleep(0.6)
        st = [m_ for m_ in h.all if m_.get("t") == "stopped"]
        check("se o erro persistir, a partida NÃO começa com cenários diferentes: volta ao lobby explicando", st and "não preparou a fase igual" in st[-1]["why"] and h.room["phase"] == "lobby", st[-1:])
        for c in cl: c.send(t="leave")
        await asyncio.sleep(0.4)

        print("Versão da página (servidor com REQUIRE_BUILD=1)")
        E["T"].PORT = 8842
        cl, code = await make_room(2); h, q = cl
        h.send(t="size", n=2); await asyncio.sleep(0.2)
        check("clientes sem 'build' (página antiga) aparecem como desatualizados para todos", all(p["stale"] for p in h.room["players"] if p) and h.room["build"], h.room["players"])
        for c in cl: c.send(t="ready", v=True)
        await asyncio.sleep(0.3); drain(h); h.send(t="start"); e = await h.expect("err")
        check("começar com página desatualizada é recusado explicando o motivo", e and "desatualizada" in e["msg"] and h.room["phase"] == "lobby", e)
        for c in cl: c.send(t="leave")
        await asyncio.sleep(0.4)
        hi = None
        c1, c2 = T.WS(), T.WS()
        for c in (c1, c2): await c.connect(); hi = await c.expect("hi")
        c1.send(t="create", name="A", build=hi["build"]); j = await c1.expect("joined"); c2.send(t="join", code=j["code"], name="B", build="velha-0"); await c2.expect("joined"); await asyncio.sleep(0.3)
        c1.send(t="size", n=2); await asyncio.sleep(0.2)
        check("só quem tem build diferente é marcado como desatualizado", [p["stale"] for p in c1.room["players"] if p] == [False, True], c1.room["players"])
        c2.send(t="leave"); await asyncio.sleep(0.3)
        c3 = T.WS(); await c3.connect(); await c3.expect("hi"); c3.send(t="join", code=j["code"], name="C", build=hi["build"]); await c3.expect("joined"); await asyncio.sleep(0.3)
        c1.send(t="level", mid="classic-1-duo"); await asyncio.sleep(0.2)
        for c in (c1, c3): c.send(t="ready", v=True)
        await asyncio.sleep(0.3); c1.send(t="start"); await asyncio.sleep(1.0)
        check("com todos na versão certa a partida começa normalmente", c1.level is not None and c1.level["build"] == hi["build"])
        for c in (c1, c3): c.send(t="leave")
        await asyncio.sleep(0.3)
    finally:
        for p in srvs: p.terminate()
        for p in srvs:
            try: out = p.communicate(timeout=3)[0].decode(errors="replace")
            except Exception: out = ""
            if "Traceback" in out: print("TRACEBACK NO SERVIDOR:\n" + out); FAILS.append("traceback no servidor")
    print("\nFALHAS:" if FAILS else "\nTUDO OK", FAILS if FAILS else "")
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
