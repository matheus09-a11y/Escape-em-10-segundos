"""12 mapas novos (6 de Dupla, 6 de Trio), cada um com 3 variantes ESCRITAS à mão: fácil, normal e difícil.
Não é só multiplicar velocidades: cada variante muda o desenho (largura das passagens, quantidade de perigos, etapas extras)
e os parâmetros dos perigos (drones, janela segura dos lasers — que continuam sempre com aviso de 0,5 s).

  FÁCIL  : passagens de 80 u; menos perigos (às vezes nenhum laser/drone); drones a 70 u/s; laser com 3,4 s seguros / 1,6 s ligado;
           `guide`: as ligações placa→porta aparecem sempre fortes (orientação visual extra).
  NORMAL : passagens de 50 u; drones a 100 u/s; laser 2,4 s seguros / 1,6 s ligado (equilíbrio de referência; possível em 25 s).
  DIFÍCIL: passagens de 50 u (nunca mais estreitas); mais perigos e/ou uma etapa extra de revezamento; drones a 125 u/s;
           laser 1,8 s seguros / 2,0 s ligado. Nenhuma ação exige precisão de milissegundos.
Mecanismos: paredes, placas de segurar, interruptores, portas, chave, saída em área, espinhos, lasers, serras, drones e portais
(estes dois portados da campanha com as mesmas regras). Papéis fixos: 1º 🔥 (espinhos), 2º 💧 (lasers), 3º 🌿 (serras).
"""

PARAMS = {
    "easy": dict(gw=80, dr=70, off=3.4, on=1.6),
    "normal": dict(gw=50, dr=100, off=2.4, on=1.6),
    "hard": dict(gw=50, dr=125, off=1.8, on=2.0),
}
DIFFS = ("easy", "normal", "hard")
ALWAYS = lambda r: {"r": r, "on": 4, "off": 0, "offset": 0}      # laser sempre ligado (para quem é imune)


def build_v2(H):
    """H = helpers de coop_levels (gate_r, ring, sawcol)."""
    gate_r, ring, sawcol = H["gate_r"], H["ring"], H["sawcol"]

    def vseg(x, y0, y1, gaps, t=20):
        out, y = [], y0
        for g0, g1 in sorted(gaps):
            if g0 > y: out.append([x, y, t, g0 - y])
            y = g1
        if y < y1: out.append([x, y, t, y1 - y])
        return out

    def hseg(y, x0, x1, gaps, t=20):
        out, x = [], x0
        for g0, g1 in sorted(gaps):
            if g0 > x: out.append([x, y, g0 - x, t])
            x = g1
        if x < x1: out.append([x, y, x1 - x, t])
        return out

    gp = lambda cy, gw: (cy - gw / 2, cy + gw / 2)
    vg = lambda x, cy, gw, plates, t=20: gate_r(x, cy - gw / 2, t, gw, plates)
    laser = lambda r, p: {"r": r, "on": p["on"], "off": p["off"], "offset": 0}
    drone = lambda route, p, phase=0.0, r=12: {"route": route, "speed": p["dr"], "r": r, "phase": phase}
    out = []

    def add(fam, name, players, d, hint, **lv):
        for k in ("spikes", "lasers", "saws", "drones", "portals"): lv.setdefault(k, [])
        lv.update({"set": "duo" if players == 2 else "trio", "name": name, "players": players, "diff": d, "family": fam,
                   "mid": f"{fam}-{d}", "hint": hint, "guide": d == "easy", "time": 25})
        out.append(lv)

    # ============================================================ DUPLA
    for d in DIFFS:   # n1 Passagem alternada
        p = PARAMS[d]; gw = p["gw"]
        spikes = {"easy": [[370, 60, 60, 70]], "normal": [[350, 50, 100, 90]], "hard": [[340, 40, 120, 120]]}[d]
        lv = dict(starts=[[60, 100], [60, 400]], walls=vseg(220, 0, 500, [gp(250, gw), gp(85, gw)]) + vseg(480, 0, 500, [gp(250, gw)]), spikes=spikes,
                  plates=[{"x": 130, "y": 150, "hold": True}, {"x": 330, "y": 370, "hold": False}, {"x": 400, "y": 95, "hold": False}],
                  gates=[vg(220, 250, gw, [0]), vg(220, 85, gw, [1]), vg(480, 250, gw, [2])], key=[650, 400], door=[740, 250])
        if d == "hard":
            lv["drones"] = [drone([[300, 160], [300, 430]], p)]; lv["lasers"] = [laser([440, 150, 12, 350], p)]
        add("duo-n1", "Passagem alternada", 2, d, "🔥 segura a placa ▼; 💧 passa e liga ◉ (abre a porta de cima para 🔥). 🔥 cruza os espinhos e liga ●, que abre a saída para 💧." + (" Cuidado com o drone e o laser." if d == "hard" else ""), **lv)

    for d in DIFFS:   # n2 Duas alas
        p = PARAMS[d]; gw = p["gw"]
        xs = {"easy": [260], "normal": [200, 400], "hard": [170, 330, 490]}[d]
        walls = hseg(240, 0, 560, []); plates, gates, spikes, lasers = [], [], [], []
        for k, x in enumerate(xs):
            walls += vseg(x, 0, 240, [gp(120, gw)]) + vseg(x, 260, 500, [gp(380, gw)])
            sx = x - 90 if k == 0 else xs[k - 1] + 120
            ia = len(plates); plates.append({"x": sx, "y": 60, "hold": False})
            ib = len(plates); plates.append({"x": sx, "y": 440, "hold": False})
            gates.append(vg(x, 380, gw, [ia])); gates.append(vg(x, 120, gw, [ib]))
            if k < len(xs) - 1:                                   # corredor de perigos entre este estágio e o próximo
                spikes.append([x + 40, 0, 60, 240]); lasers.append(ALWAYS([x + 40, 260, 12, 240]))
        lv = dict(starts=[[40, 100], [40, 400]], walls=walls, spikes=spikes, lasers=lasers, plates=plates, gates=gates, key=[700, 250], door=[750, 250])
        if d == "hard": lv["drones"] = [drone([[650, 110], [650, 390]], p)]
        add("duo-n2", "Duas alas", 2, d, "Cada um percorre a sua ala (🔥 em cima, 💧 embaixo) e liga os interruptores ◉ que abrem as portas do parceiro. Reúnam-se na saída." + (" Há um drone no fim." if d == "hard" else ""), **lv)
        out[-1]["xs"] = xs

    for d in DIFFS:   # n3 Transporte por portais
        p = PARAMS[d]; gw = p["gw"]
        lv = dict(starts=[[60, 100], [60, 400]], walls=vseg(180, 0, 500, [gp(375, gw)]) + hseg(230, 0, 180, []) + vseg(480, 0, 500, [gp(255, gw)]),
                  portals=[{"a": {"x": 100, "y": 100}, "b": {"x": 300, "y": 100}}, {"a": {"x": 330, "y": 400}, "b": {"x": 600, "y": 120}}],
                  plates=[{"x": 300, "y": 175, "hold": True}, {"x": 660, "y": 120, "hold": False}],
                  gates=[vg(180, 375, gw, [0]), vg(480, 255, gw, [1])], key=[650, 400], door=[740, 250])
        if d != "easy": lv["lasers"] = [laser([410, 40, 12, 240], p)]
        if d == "hard": lv["drones"] = [drone([[560, 170], [680, 170], [680, 400], [560, 400]], p)]
        add("duo-n3", "Transporte por portais", 2, d, "🔥 entra no portal e segura a placa ▼ (abre a porta de 💧). 💧 sai, usa o outro portal e liga ◉, que abre a passagem de 🔥." + (" O laser pisca: espere a janela." if d != "easy" else ""), **lv)

    for d in DIFFS:   # n4 Janela segura
        p = PARAMS[d]; gw = p["gw"]
        drones = [drone([[520, 20], [520, 480]], p)]
        if d == "hard": drones.append(drone([[600, 480], [600, 20]], p, 0.3))
        lv = dict(starts=[[60, 100], [60, 400]], walls=vseg(220, 0, 500, [gp(120, gw), gp(380, gw)]) + vseg(420, 0, 500, [gp(250, gw), gp(85, gw)]),
                  lasers=[laser([270, 0, 12, 500], p)], drones=drones,
                  plates=[{"x": 130, "y": 400, "hold": True}, {"x": 330, "y": 330, "hold": False}, {"x": 330, "y": 160, "hold": True}, {"x": 670, "y": 120, "hold": False}],
                  gates=[vg(220, 120, gw, [0]), vg(220, 380, gw, [1]), vg(420, 250, gw, [2]), vg(420, 85, gw, [3])], key=[680, 420], door=[750, 250])
        add("duo-n4", "Janela segura", 2, d, "💧 segura a placa ▼ de baixo enquanto 🔥 passa pela porta e pelo laser e liga ◉. Depois 🔥 segura a placa ▼ de cima enquanto 💧 atravessa a patrulha dos drones e liga ●." , **lv)

    for d in DIFFS:   # n5 Patrulha cruzada
        p = PARAMS[d]; gw = p["gw"]
        drones = [drone([[300, 20], [300, 480]], p)]
        if d != "easy": drones.append(drone([[500, 480], [500, 20]], p, 0.25))
        if d == "hard": drones.append(drone([[150, 20], [150, 480]], p, 0.5))
        lv = dict(starts=[[60, 100], [60, 400]], walls=vseg(380, 0, 500, [gp(250, gw), gp(85, gw)]), drones=drones,
                  plates=[{"x": 100, "y": 250, "hold": True}, {"x": 620, "y": 120, "hold": False}],
                  gates=[vg(380, 250, gw, [0]), vg(380, 85, gw, [1])], key=[650, 400], door=[740, 250])
        add("duo-n5", "Patrulha cruzada", 2, d, "🔥 segura a placa ▼ (porta do meio). 💧 cruza as patrulhas, passa e liga ◉, que abre a porta de cima para 🔥. Espere nas áreas livres entre os drones.", **lv)

    for d in DIFFS:   # n6 Fuga encadeada
        p = PARAMS[d]; gw = p["gw"]
        lv = dict(starts=[[60, 100], [60, 400]], walls=vseg(220, 0, 500, [gp(250, gw), gp(85, gw)]) + vseg(480, 0, 500, [gp(250, gw)]),
                  portals=[{"a": {"x": 330, "y": 300}, "b": {"x": 600, "y": 300}}],
                  plates=[{"x": 130, "y": 150, "hold": True}, {"x": 300, "y": 400, "hold": False}, {"x": 620, "y": 150, "hold": True}],
                  gates=[vg(220, 250, gw, [0]), vg(220, 85, gw, [1]), vg(480, 250, gw, [2])], key=[650, 420], door=[740, 250])
        if d != "easy": lv["lasers"] = [laser([420, 0, 12, 500], p)]
        if d == "hard": lv["drones"] = [drone([[300, 160], [300, 330]], p)]
        add("duo-n6", "Fuga encadeada", 2, d, "🔥 segura ▼, 💧 passa e liga ◉, usa o portal e segura a 2ª placa ▼ enquanto 🔥 atravessa" + (" o laser" if d != "easy" else "") + ". Depois chave e saída.", **lv)

    # ============================================================ TRIO
    for d in DIFFS:   # n1 Duas placas e um caminho
        p = PARAMS[d]; gw = p["gw"]
        if d == "easy":
            lane, saws, gcy, sy = 385, sawcol(400, [430, 478], 20), 452, 440
        else:
            lane, saws, gcy, sy = 335, sawcol(400, [385, 435, 485], 20), 425, 425
        lv = dict(starts=[[60, 80], [60, 250], [60, 420]], walls=vseg(300, 0, 500, [(190, 310), gp(gcy, gw)]) + hseg(lane, 320, 560, []), saws=saws,
                  plates=[{"x": 130, "y": 80, "hold": True}, {"x": 130, "y": 250, "hold": True}, {"x": 520, "y": sy, "hold": False}],
                  gates=[vg(300, gcy, gw, [0, 1]), vg(300, 250, 120, [2])], key=[640, 120], door=[740, 250])
        if d == "hard": lv["drones"] = [drone([[600, 350], [600, 480]], p)]
        add("trio-n1", "Duas placas e um caminho", 3, d, "🔥 e 💧 seguram as placas ▼ (juntas abrem a porta de baixo). 🌿 cruza as serras e liga ◉, que abre a porta grande para todos." + (" Um drone patrulha o fim do corredor." if d == "hard" else ""), **lv)

    for d in DIFFS:   # n2 Corrente de três
        p = PARAMS[d]; gw = p["gw"]
        walls = hseg(167, 100, 560, []) + hseg(313, 100, 560, []) + vseg(600, 0, 500, [(200, 300)])
        lv = dict(starts=[[40, 80], [40, 250], [40, 420]], walls=walls,
                  spikes=[[180, 0, 80, 167]], lasers=[ALWAYS([220, 187, 12, 126])], saws=sawcol(260, [363, 413, 463], 20) if d != "easy" else sawcol(260, [388, 438], 20),
                  plates=[{"x": 300, "y": 90, "hold": False}, {"x": 330, "y": 250, "hold": False}, {"x": 400, "y": 420, "hold": False}],
                  gates=[gate_r(100, 187, 20, 126, [0]), gate_r(100, 333, 20, 167, [1]), vg(600, 250, 100, [2])], key=[690, 400], door=[740, 120])
        if d == "easy":   # a faixa de baixo é mais baixa e tem só 2 serras
            lv["walls"] = hseg(167, 100, 560, []) + hseg(363, 100, 560, []) + vseg(600, 0, 500, [(200, 300)])
            lv["gates"] = [gate_r(100, 187, 20, 176, [0]), gate_r(100, 383, 20, 117, [1]), vg(600, 250, 100, [2])]
            lv["lasers"] = [ALWAYS([220, 187, 12, 176])]
            lv["saws"] = sawcol(260, [405, 455], 20); lv["plates"][2] = {"x": 400, "y": 430, "hold": False}
        if d == "hard": lv["drones"] = [drone([[650, 40], [650, 460]], p)]
        add("trio-n2", "Corrente de três", 3, d, "🔥 cruza os espinhos e liga ◉ (abre a porta de 💧). 💧 cruza o laser e liga ● (abre a porta de 🌿). 🌿 cruza as serras e liga ★: abre a saída para todos." + (" Um drone patrulha depois da porta." if d == "hard" else ""), **lv)

    for d in DIFFS:   # n3 Central de controle
        p = PARAMS[d]; gw = p["gw"]
        spikes = {"easy": [[560, 80, 60, 60]], "normal": [[540, 60, 100, 100]], "hard": [[540, 60, 100, 100]]}[d]
        lv = dict(starts=[[40, 150], [40, 250], [40, 350]],
                  walls=vseg(240, 0, 500, [gp(250, gw + 20), gp(90, gw)]) + vseg(480, 0, 500, [gp(250, gw), gp(410, gw)]) + vseg(660, 0, 500, [gp(330, gw)]),
                  saws=ring(380, 250, 45, 6 if d == "easy" else 8, 20), spikes=spikes,
                  plates=[{"x": 120, "y": 150, "hold": True}, {"x": 120, "y": 350, "hold": True}, {"x": 380, "y": 250, "hold": False},
                          {"x": 330, "y": 400, "hold": True}, {"x": 330, "y": 110, "hold": True}, {"x": 590, "y": 110, "hold": False}],
                  gates=[vg(240, 250, gw + 20, [0, 1]), vg(240, 90, gw, [2]), vg(480, 250, gw, [3, 4]), vg(480, 410, gw, [5]), vg(660, 330, gw, [5])],
                  key=[730, 430], door=[750, 250])
        if d == "hard": lv["drones"] = [drone([[600, 200], [600, 480]], p)]
        add("trio-n3", "Central de controle", 3, d, "1) 🔥 e 💧 seguram as placas ▼ enquanto 🌿 cruza as serras e liga ◉. 2) 💧 e 🌿 seguram as placas ▼ enquanto 🔥 cruza os espinhos e liga ●. Depois todos para a saída.", **lv)

    for d in DIFFS:   # n4 Encontro por portais
        p = PARAMS[d]; gw = p["gw"]
        walls = (hseg(167, 0, 240, []) + hseg(333, 0, 240, []) + vseg(240, 0, 500, [])
                 + hseg(190, 260, 420, []) + hseg(290, 260, 420, []) + hseg(190, 440, 560, []) + hseg(290, 440, 560, [])
                 + vseg(600, 0, 500, [gp(250, gw + 40)]))
        lasers = [laser([490, 210, 12, 80], p)] if d != "easy" else [laser([490, 210, 12, 80], p)]
        lv = dict(starts=[[60, 80], [60, 250], [60, 420]], walls=walls, lasers=lasers, saws=ring(480, 420, 45, 6 if d == "easy" else 8, 20),
                  spikes=[[350, 40, 100, 120]] if d != "easy" else [[370, 50, 60, 100]],
                  portals=[{"a": {"x": 120, "y": 80}, "b": {"x": 300, "y": 100}}, {"a": {"x": 120, "y": 250}, "b": {"x": 340, "y": 250}}, {"a": {"x": 120, "y": 420}, "b": {"x": 350, "y": 420}}],
                  plates=[{"x": 400, "y": 100, "hold": False}, {"x": 545, "y": 250, "hold": False}, {"x": 480, "y": 420, "hold": False}],
                  gates=[vg(420, 250, 80, [0]), vg(600, 250, gw + 40, [1, 2])], key=[690, 400], door=[740, 120])
        if d == "hard": lv["drones"] = [drone([[300, 200], [300, 480]], p), drone([[650, 40], [650, 460]], p, 0.4)]
        add("trio-n4", "Encontro por portais", 3, d, "Cada um entra no seu portal e chega à sala central. 🔥 liga ◉ nos espinhos (abre o quarto de 💧); 💧 cruza o laser e liga ●; 🌿 liga ★ no meio das serras. Com ● e ★ a saída abre.", **lv)

    for d in DIFFS:   # n5 Patrulhas coordenadas
        p = PARAMS[d]; gw = p["gw"]
        lv = dict(starts=[[40, 100], [40, 250], [40, 400]],
                  walls=vseg(180, 0, 500, [gp(250, gw), gp(85, gw)]) + vseg(380, 0, 500, [gp(250, gw), gp(415, gw)]) + vseg(580, 0, 500, [gp(250, gw), gp(85, gw)]),
                  plates=[{"x": 100, "y": 100, "hold": True}, {"x": 290, "y": 250, "hold": False}, {"x": 290, "y": 410, "hold": True},
                          {"x": 490, "y": 130, "hold": False}, {"x": 490, "y": 400, "hold": True}, {"x": 690, "y": 400, "hold": False}],
                  gates=[vg(180, 250, gw, [0]), vg(180, 85, gw, [1]), vg(380, 250, gw, [2]), vg(380, 415, gw, [3]), vg(580, 250, gw, [4]), vg(580, 85, gw, [5])],
                  key=[690, 130], door=[745, 300],
                  drones=[drone([[245, 20], [245, 480]], p, 0.0), drone([[440, 480], [440, 20]], p, 0.3)] + ([drone([[640, 20], [640, 480]], p, 0.6)] if d != "easy" else []))
        if d == "hard": lv["drones"].append(drone([[330, 20], [330, 480]], p, 0.5))
        add("trio-n5", "Patrulhas coordenadas", 3, d, "Três etapas, cada uma com uma patrulha: 🔥 segura, 🌿 cruza e liga ◉; depois 🌿... em revezamento: quem segura a placa ▼ não é quem atravessa. Espere nas áreas livres entre os drones.", **lv)

    for d in DIFFS:   # n6 Grande fuga
        p = PARAMS[d]; gw = p["gw"]
        if d == "easy": lane, saws, gcy, sy = 385, sawcol(380, [430, 478], 20), 452, 440
        else: lane, saws, gcy, sy = 335, sawcol(380, [385, 435, 485], 20), 425, 425
        drones = [drone([[620, 20], [620, 480]], p)]
        if d == "hard": drones.append(drone([[700, 480], [700, 20]], p, 0.4))
        lv = dict(starts=[[60, 80], [60, 250], [60, 420]],
                  walls=vseg(260, 0, 500, [(190, 310), gp(gcy, gw)]) + hseg(lane, 280, 440, []) + vseg(520, 0, 500, [gp(250, gw), gp(90, gw)]),
                  saws=saws, spikes=[[300, 60, 100, 100]], drones=drones,
                  plates=[{"x": 130, "y": 80, "hold": True}, {"x": 130, "y": 250, "hold": True}, {"x": 460, "y": sy, "hold": False},
                          {"x": 350, "y": 110, "hold": True}, {"x": 700, "y": 130, "hold": False}],
                  gates=[vg(260, gcy, gw, [0, 1]), vg(260, 250, 120, [2]), vg(520, 250, gw, [3]), vg(520, 90, gw, [4])],
                  key=[700, 400], door=[750, 250])
        add("trio-n6", "Grande fuga", 3, d, "1) 🔥 e 💧 seguram as placas ▼; 🌿 cruza as serras e liga ◉. 2) 🔥 segura a placa ▼ no meio dos espinhos; 💧 e 🌿 cruzam a patrulha; 💧 liga ● e libera 🔥. Chave e saída.", **lv)
    return out
