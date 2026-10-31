"""Fases do modo cooperativo (3 jogadores). Mundo de 800x500 unidades, como na campanha.

Cada papel é imune a UM tipo de perigo (e só a ele):
  brasa -> espinhos   onda -> lasers   folha -> serras
Quem não é imune e encosta no perigo faz a equipe perder a tentativa.

Placas: "hold" (segurar) só ficam ativas enquanto alguém está em cima; as outras
("trava") ficam ativas para sempre depois de pisadas. Uma porta abre quando TODAS as
placas ligadas a ela estão ativas. Quem escapou pela porta de saída some do mapa
(não segura mais nenhuma placa).
"""

W, H = 800, 500

ROLES = {
    "brasa": {"name": "Brasa", "icon": "🔥", "color": "#ff5a4d", "immune": "spike", "desc": "Pisa em espinhos sem se ferir."},
    "onda": {"name": "Onda", "icon": "💧", "color": "#3db4ff", "immune": "laser", "desc": "Atravessa lasers."},
    "folha": {"name": "Folha", "icon": "🌿", "color": "#5dff9a", "immune": "saw", "desc": "As serras não a machucam."},
}
ROLE_IDS = list(ROLES)

# skins (só visuais) que cada jogador leva da campanha; o servidor só repassa ids conhecidos
SKIN_IDS = ["explorer", "astro", "robot", "ninja", "holo", "gold", "scarlet", "speed", "shadow", "titan", "sentinel", "agent", "spectre", "arcane"]


def vwall(x, t, gaps):
    """Parede vertical em x (espessura t) de cima a baixo, com vãos [(y0, y1), ...]."""
    out, y = [], 0
    for g0, g1 in sorted(gaps):
        if g0 > y:
            out.append([x, y, t, g0 - y])
        y = g1
    if y < H:
        out.append([x, y, t, H - y])
    return out


def hwall(y, t, x0, x1):
    return [[x0, y, x1 - x0, t]]


def gate_v(x, t, y0, y1, plates):
    return {"r": [x, y0, t, y1 - y0], "plates": plates}


def ring(cx, cy, rad, n, r):
    import math
    return [{"x1": round(cx + rad * math.cos(2 * math.pi * i / n)), "y1": round(cy + rad * math.sin(2 * math.pi * i / n)),
             "x2": round(cx + rad * math.cos(2 * math.pi * i / n)), "y2": round(cy + rad * math.sin(2 * math.pi * i / n)),
             "r": r, "speed": 0, "phase": 0} for i in range(n)]


def sawcol(x, ys, r):
    return [{"x1": x, "y1": y, "x2": x, "y2": y, "r": r, "speed": 0, "phase": 0} for y in ys]


LEVELS = []

# 1 ------------------------------------------------------------------
LEVELS.append({
    "name": "Primeiros passos", "time": 25,
    "hint": "Qualquer um pega a chave 🗝 — a chave vale para o time. Todos precisam chegar à porta.",
    "starts": [[60, 110], [60, 250], [60, 390]],
    "walls": [[300, 130, 40, 90], [300, 280, 40, 90]],
    "spikes": [], "lasers": [], "saws": [], "plates": [], "gates": [],
    "key": [450, 250], "door": [730, 250],
})

# 2 ------------------------------------------------------------------
LEVELS.append({
    "name": "Cada um no seu caminho", "time": 30,
    "hint": "Três corredores, três perigos. 🔥 espinhos · 💧 lasers · 🌿 serras: cada papel atravessa o seu.",
    "starts": [[50, 100], [50, 250], [50, 400]],
    "walls": hwall(160, 20, 140, 560) + hwall(320, 20, 140, 560),
    "spikes": [[300, 0, 80, 160]],
    "lasers": [{"r": [334, 180, 12, 140], "on": 4, "off": 0, "offset": 0}],  # off=0: sempre ligado
    "saws": sawcol(340, [370, 420, 470], 20),
    "plates": [], "gates": [],
    "key": [650, 110], "door": [740, 420],
})

# 3 ------------------------------------------------------------------
LEVELS.append({
    "name": "Segure a porta", "time": 30,
    "hint": "Um segura a placa 🟦 (fica em cima) enquanto os outros passam. Depois alguém libera o caminho para quem ficou.",
    "starts": [[60, 110], [60, 250], [60, 390]],
    "walls": vwall(200, 20, [(230, 270), (400, 440)]),
    "spikes": [], "lasers": [], "saws": [],
    "plates": [
        {"x": 100, "y": 120, "hold": True},    # 0: segura a porta 0
        {"x": 480, "y": 70, "hold": False},    # 1: trava, abre a porta 1 (atalho de volta)
    ],
    "gates": [
        gate_v(200, 20, 230, 270, [0]),
        gate_v(200, 20, 400, 440, [1]),
    ],
    "key": [620, 420], "door": [740, 250],
})

# 4 ------------------------------------------------------------------
LEVELS.append({
    "name": "Em dupla", "time": 45,
    "hint": "A porta só abre com duas placas seguradas ao mesmo tempo. O terceiro passa — e o laser pisca: espere ele apagar.",
    "starts": [[60, 150], [60, 250], [60, 350]],
    "walls": vwall(260, 20, [(230, 270), (400, 440)]),
    "spikes": [],
    "lasers": [{"r": [520, 0, 12, 500], "on": 1.6, "off": 2.4, "offset": 0}],
    "saws": [],
    "plates": [
        {"x": 90, "y": 80, "hold": True},      # 0
        {"x": 90, "y": 420, "hold": True},     # 1
        {"x": 440, "y": 60, "hold": False},    # 2: trava, abre o atalho de volta
    ],
    "gates": [
        gate_v(260, 20, 230, 270, [0, 1]),
        gate_v(260, 20, 400, 440, [2]),
    ],
    "key": [640, 420], "door": [740, 250],
})

# 5 ------------------------------------------------------------------
LEVELS.append({
    "name": "A grande fuga", "time": 60,
    "hint": "🔥 segura a placa nos espinhos · 💧 passa pelo laser e segura a outra placa · 🌿 pega a chave entre as serras. Depois ajudem a 🔥 a sair.",
    "starts": [[40, 110], [40, 250], [40, 390]],
    "walls": vwall(250, 20, [(230, 270), (400, 440)]) + vwall(530, 20, [(80, 120), (230, 270), (400, 440)]),
    "spikes": [[90, 210, 80, 80]],
    "lasers": [{"r": [534, 230, 12, 40], "on": 4, "off": 0, "offset": 0}],
    "saws": ring(700, 430, 45, 8, 20),
    "plates": [
        {"x": 130, "y": 250, "hold": True},    # 0: nos espinhos -> porta 0
        {"x": 400, "y": 80, "hold": False},    # 1: trava -> porta 1 (volta da 🔥)
        {"x": 610, "y": 300, "hold": True},    # 2: segura -> porta 2
        {"x": 700, "y": 90, "hold": False},    # 3: trava -> porta 3
    ],
    "gates": [
        gate_v(250, 20, 230, 270, [0]),
        gate_v(250, 20, 400, 440, [1]),
        gate_v(530, 20, 400, 440, [2]),
        gate_v(530, 20, 80, 120, [3]),
    ],
    "key": [700, 430], "door": [760, 230],
})

# ======================================================================================
# FASES NOVAS: conjuntos "Dupla" (exatamente 2 jogadores) e "Trio" (exatamente 3).
# Os papéis são FIXOS nestas fases (o 1º jogador é 🔥 brasa, o 2º 💧 onda, o 3º 🌿 folha) para o desenho
# saber quem atravessa cada perigo. Tudo usa só mecanismos que já existem: paredes, placas de pressão
# (hold), interruptores (trava), portas, chave, saída em área, espinhos, lasers e serras.
# Regras de projeto (conferidas em test_coop.py): ninguém precisa largar uma placa e ficar preso; as portas
# nunca fecham sobre alguém; a saída exige TODOS; cabem em 25 s com folga (o robô perfeito leva ~4-9 s).
# ======================================================================================
def gate_r(x, y, w, h, plates):
    return {"r": [x, y, w, h], "plates": plates}


def lane_walls(x0, x1, y1, y2, t=20):
    """Duas paredes horizontais que formam 3 corredores (cima / meio / baixo)."""
    return hwall(y1, t, x0, x1) + hwall(y2, t, x0, x1)


NEW_LEVELS = []

# ---------------------------------------------------------------- DUPLA
# D1 Revezamento: A segura a placa (porta do parceiro); B passa, liga o interruptor e solta a passagem de A.
NEW_LEVELS.append({
    "set": "duo", "name": "Revezamento", "players": 2,
    "hint": "🔥 segura a placa ▼ na esquerda: abre a porta para 💧. 💧 passa e liga o interruptor ◉ que abre o caminho do parceiro. Depois: chave e saída.",
    "starts": [[60, 150], [60, 350]],
    "walls": vwall(300, 20, [(60, 110), (225, 275)]),
    "spikes": [], "lasers": [], "saws": [],
    "plates": [{"x": 130, "y": 150, "hold": True}, {"x": 480, "y": 120, "hold": False}],
    "gates": [gate_v(300, 20, 225, 275, [0]), gate_v(300, 20, 60, 110, [1])],
    "key": [620, 400], "door": [730, 250],
})
# D2 Caminhos paralelos: cada um liga o interruptor que abre a passagem do outro; cada um atravessa o seu perigo.
NEW_LEVELS.append({
    "set": "duo", "name": "Caminhos paralelos", "players": 2,
    "hint": "O interruptor ◆ de cada um abre a passagem do outro. 🔥 segue pelo corredor de espinhos, 💧 pelo do laser. A chave está no túnel do meio.",
    "starts": [[60, 90], [60, 410]],
    "walls": vwall(250, 20, [(60, 110), (390, 440)]) + lane_walls(270, 560, 170, 330),
    "spikes": [[380, 0, 70, 170]],
    "lasers": [{"r": [420, 350, 12, 150], "on": 4, "off": 0, "offset": 0}],
    "saws": [],
    "plates": [{"x": 140, "y": 120, "hold": False}, {"x": 140, "y": 380, "hold": False}],
    "gates": [gate_v(250, 20, 60, 110, [1]), gate_v(250, 20, 390, 440, [0])],
    "key": [440, 250], "door": [730, 250],
})
# D3 Travessia protegida: 🔥 cruza os espinhos e liga o interruptor que abre a passagem segura de 💧; depois 💧 cruza o laser e abre a de 🔥.
NEW_LEVELS.append({
    "set": "duo", "name": "Travessia protegida", "players": 2,
    "hint": "🔥 atravessa os espinhos e liga ◆ para abrir a porta de 💧. Depois 💧 atravessa o laser e liga ● para abrir a porta de 🔥. Chave e saída à direita.",
    "starts": [[60, 100], [60, 400]],
    "walls": vwall(300, 20, [(40, 140), (360, 410)]) + vwall(560, 20, [(350, 420), (40, 140)]),
    "spikes": [[275, 40, 70, 100]],
    "lasers": [{"r": [558, 350, 24, 70], "on": 4, "off": 0, "offset": 0}],
    "saws": [],
    "plates": [{"x": 430, "y": 90, "hold": False}, {"x": 650, "y": 385, "hold": False}],
    "gates": [gate_v(300, 20, 360, 410, [0]), gate_v(560, 20, 40, 140, [1])],
    "key": [680, 250], "door": [750, 250],
})
# D4 Encontro: começam longe; cada um liga o interruptor que abre a entrada do outro na câmara central, onde estão a chave e a saída.
NEW_LEVELS.append({
    "set": "duo", "name": "Encontro", "players": 2,
    "hint": "Cada um liga o seu interruptor ◆ para abrir a entrada do parceiro na câmara do meio (🔥 pelos espinhos, 💧 pelo laser). A chave e a saída ficam lá dentro.",
    "starts": [[60, 100], [740, 400]],
    "walls": hwall(150, 20, 300, 500) + hwall(330, 20, 300, 500)
             + [[300, 170, 20, 55], [300, 275, 20, 55], [480, 170, 20, 55], [480, 275, 20, 55]]
             + hwall(205, 20, 140, 300) + hwall(275, 20, 140, 300) + hwall(205, 20, 500, 660) + hwall(275, 20, 500, 660),
    "spikes": [[180, 225, 60, 50]],
    "lasers": [{"r": [570, 225, 12, 50], "on": 4, "off": 0, "offset": 0}],
    "saws": [],
    "plates": [{"x": 100, "y": 350, "hold": False}, {"x": 700, "y": 150, "hold": False}],
    "gates": [gate_r(300, 225, 20, 50, [1]), gate_r(480, 225, 20, 50, [0])],
    "key": [400, 200], "door": [400, 290],
})
# D5 Apoio em cadeia: 🔥 segura → 💧 passa e liga ◉ (libera 🔥); 💧 segura outra placa → 🔥 passa e liga o último interruptor (libera 💧).
NEW_LEVELS.append({
    "set": "duo", "name": "Apoio em cadeia", "players": 2,
    "hint": "1) 🔥 segura a primeira placa, 💧 passa e liga ◉. 2) 💧 segura a segunda placa, 🔥 passa e liga ●. Depois a chave e a saída.",
    "starts": [[60, 100], [60, 400]],
    "walls": vwall(240, 20, [(225, 275), (60, 110)]) + vwall(500, 20, [(225, 275), (390, 440)]),
    "spikes": [], "lasers": [], "saws": [],
    "plates": [{"x": 130, "y": 150, "hold": True}, {"x": 380, "y": 150, "hold": False}, {"x": 390, "y": 400, "hold": True}, {"x": 640, "y": 120, "hold": False}],
    "gates": [gate_v(240, 20, 225, 275, [0]), gate_v(240, 20, 60, 110, [1]), gate_v(500, 20, 225, 275, [2]), gate_v(500, 20, 390, 440, [3])],
    "key": [650, 400], "door": [740, 250],
})
# D6 Fuga em dupla: corredores com perigos, placa de segurar, interruptor, chave no túnel.
NEW_LEVELS.append({
    "set": "duo", "name": "Fuga em dupla", "players": 2,
    "hint": "🔥 pelos espinhos até a placa ▼ (abre a porta de 💧); 💧 pelo laser, passa a porta, liga ◉ (libera 🔥). Pegue a chave no túnel e fujam juntos.",
    "starts": [[60, 100], [60, 400]],
    "walls": lane_walls(100, 540, 170, 330) + [[100, 190, 20, 140]] + vwall(580, 20, [(225, 275), (60, 110)]),
    "spikes": [[250, 0, 80, 170]],
    "lasers": [{"r": [250, 350, 12, 150], "on": 4, "off": 0, "offset": 0}],
    "saws": [],
    "plates": [{"x": 500, "y": 90, "hold": True}, {"x": 700, "y": 380, "hold": False}],
    "gates": [gate_v(580, 20, 225, 275, [0]), gate_v(580, 20, 60, 110, [1])],
    "key": [470, 260], "door": [740, 250],
})

# ---------------------------------------------------------------- TRIO
# T1 Três posições: 🔥 e 💧 ocupam as placas; 🌿 passa e liga o interruptor que libera todos.
NEW_LEVELS.append({
    "set": "trio", "name": "Três posições", "players": 3,
    "hint": "🔥 e 💧 ficam nas placas ▼ (juntas abrem a porta de baixo). 🌿 passa e liga ◉, que abre a porta grande para todos. Depois chave e saída.",
    "starts": [[60, 80], [60, 250], [60, 420]],
    "walls": vwall(300, 20, [(190, 310), (400, 450)]),
    "spikes": [], "lasers": [], "saws": [],
    "plates": [{"x": 130, "y": 80, "hold": True}, {"x": 130, "y": 250, "hold": True}, {"x": 460, "y": 420, "hold": False}],
    "gates": [gate_v(300, 20, 400, 450, [0, 1]), gate_v(300, 20, 190, 310, [2])],
    "key": [620, 100], "door": [740, 250],
})
# T2 Corrente de ajuda: 🔥 segura → 💧 passa e liga ◉ (libera 🔥 e 🌿) → 🌿 liga o interruptor final (abre o caminho para todos).
NEW_LEVELS.append({
    "set": "trio", "name": "Corrente de ajuda", "players": 3,
    "hint": "🔥 segura a placa ▼; 💧 passa e liga ◉ (abre as portas de 🔥 e 🌿); 🌿 liga o interruptor ● da frente: abre a saída para todos.",
    "starts": [[60, 150], [60, 250], [60, 420]],
    "walls": vwall(220, 20, [(225, 275), (60, 110), (390, 440)]) + vwall(480, 20, [(225, 275)]),
    "spikes": [], "lasers": [], "saws": [],
    "plates": [{"x": 130, "y": 150, "hold": True}, {"x": 360, "y": 250, "hold": False}, {"x": 400, "y": 415, "hold": False}],
    "gates": [gate_v(220, 20, 225, 275, [0]), gate_v(220, 20, 60, 110, [1]), gate_v(220, 20, 390, 440, [1]), gate_v(480, 20, 225, 275, [2])],
    "key": [650, 120], "door": [740, 380],
})
# T3 Rotas complementares: cada um cruza o seu perigo e liga o seu interruptor; só com os 3 a porta da saída abre.
NEW_LEVELS.append({
    "set": "trio", "name": "Rotas complementares", "players": 3,
    "hint": "🔥 pelos espinhos, 💧 pelo laser, 🌿 pelas serras: cada um liga o seu interruptor ◉ no fim do corredor. Com os três ligados a porta grande abre.",
    "starts": [[40, 80], [40, 250], [40, 420]],
    "walls": lane_walls(100, 560, 167, 313) + vwall(600, 20, [(200, 300)]),
    "spikes": [[260, 0, 80, 167]],
    "lasers": [{"r": [320, 187, 12, 126], "on": 4, "off": 0, "offset": 0}],
    "saws": sawcol(300, [363, 413, 463], 20),
    "plates": [{"x": 540, "y": 90, "hold": False}, {"x": 540, "y": 250, "hold": False}, {"x": 540, "y": 420, "hold": False}],
    "gates": [gate_v(600, 20, 200, 300, [0, 1, 2])],
    "key": [690, 400], "door": [740, 120],
})
# T4 Controle de passagem: 🔥 segura (💧 e 🌿 passam), depois 💧 segura (🌿 passa); 🌿 liga o interruptor que reúne o grupo.
NEW_LEVELS.append({
    "set": "trio", "name": "Controle de passagem", "players": 3,
    "hint": "🔥 segura a 1ª placa ▼ enquanto 💧 e 🌿 passam. 💧 vai à 2ª placa e segura enquanto 🌿 passa. 🌿 liga ◉ no fim: abre as portas de volta para 🔥 e 💧.",
    "starts": [[60, 130], [60, 250], [60, 380]],
    "walls": vwall(240, 20, [(225, 275), (60, 110)]) + vwall(460, 20, [(225, 275), (390, 440)]),
    "spikes": [], "lasers": [], "saws": [],
    "plates": [{"x": 140, "y": 130, "hold": True}, {"x": 350, "y": 420, "hold": True}, {"x": 600, "y": 250, "hold": False}],
    "gates": [gate_v(240, 20, 225, 275, [0]), gate_v(460, 20, 225, 275, [1]), gate_v(240, 20, 60, 110, [2]), gate_v(460, 20, 390, 440, [2])],
    "key": [690, 120], "door": [740, 400],
})
# T5 Revezamento completo: três etapas; em cada uma um segura, outro atravessa e liga o interruptor que libera quem ficou.
NEW_LEVELS.append({
    "set": "trio", "name": "Revezamento completo", "players": 3,
    "hint": "Três etapas: 🔥 segura, 💧 passa e liga ◉. Depois 🌿 segura, 🔥 passa e liga ●. Por fim 💧 segura, 🌿 passa e liga ★. Ninguém fica para trás.",
    "starts": [[40, 100], [40, 250], [40, 400]],
    "walls": vwall(180, 20, [(225, 275), (60, 110)]) + vwall(380, 20, [(225, 275), (390, 440)]) + vwall(580, 20, [(225, 275), (60, 110)]),
    "spikes": [], "lasers": [], "saws": [],
    "plates": [{"x": 100, "y": 100, "hold": True}, {"x": 290, "y": 250, "hold": False},
               {"x": 290, "y": 410, "hold": True}, {"x": 490, "y": 130, "hold": False},
               {"x": 490, "y": 400, "hold": True}, {"x": 690, "y": 400, "hold": False}],
    "gates": [gate_v(180, 20, 225, 275, [0]), gate_v(180, 20, 60, 110, [1]),
              gate_v(380, 20, 225, 275, [2]), gate_v(380, 20, 390, 440, [3]),
              gate_v(580, 20, 225, 275, [4]), gate_v(580, 20, 60, 110, [5])],
    "key": [690, 130], "door": [740, 300],
})
# T6 Fuga em trio: corredores com perigos + duas placas + chave nas serras + interruptor final.
NEW_LEVELS.append({
    "set": "trio", "name": "Fuga em trio", "players": 3,
    "hint": "Cada um cruza o seu corredor. 🔥 e 💧 seguram as placas ▼ (abrem a porta de 🌿). 🌿 pega a chave entre as serras e liga ◉: abre a porta de saída para todos.",
    "starts": [[40, 80], [40, 250], [40, 420]],
    "walls": lane_walls(100, 560, 167, 313) + vwall(600, 20, [(390, 450), (190, 310)]),
    "spikes": [[260, 0, 80, 167]],
    "lasers": [{"r": [320, 187, 12, 126], "on": 4, "off": 0, "offset": 0}],
    "saws": sawcol(300, [363, 413, 463], 20) + ring(700, 420, 45, 8, 20),
    "plates": [{"x": 540, "y": 90, "hold": True}, {"x": 540, "y": 250, "hold": True}, {"x": 700, "y": 130, "hold": False}],
    "gates": [gate_v(600, 20, 390, 450, [0, 1]), gate_v(600, 20, 190, 310, [2])],
    "key": [700, 420], "door": [740, 250],
})

# mínimo de jogadores para a fase ser possível (placas de segurar exigem gente para segurar E passar)
MIN_PLAYERS = [1, 1, 2, 3, 3]
# menor tempo (s) em que um robô perfeito conclui a fase (medido em test_coop.py): abaixo disso é impossível
PAR = [3, 4, 6, 6, 10]
NEW_PAR = [5, 5, 5, 3, 6, 5, 5, 5, 5, 8, 9, 5]     # fases 6..17 (Dupla e Trio)
import copy

# ----------------------------------------------------------------------------------------------
# CLASSIFICAÇÃO DOS MAPAS (por funcionamento real, não pelo nome)
#   Cada mapa tem `players` = quantidade EXATA de jogadores para a qual ele foi feito e foi verificado (test_fases.py):
#     - "Em dupla" (clássica 4) tem esse nome, mas exige 3 (duas placas seguradas ao mesmo tempo + 1 que passa) -> Trio.
#     - Clássicas 1, 2 e 3 foram desenhadas com 3 largadas -> Trio. Cada uma também tem uma VARIANTE de Dupla
#       (mesmo desenho, 2 largadas, papéis fixos), com identificador próprio: classic-N-duo.
#   O servidor só aceita mapa cujo `players` seja igual à capacidade da sala (modalidade), em qualquer caminho.
#   Identificadores antigos preservados: `id` = posição histórica 1..17 (as variantes novas são 18..20); `mid` é o
#   identificador textual estável usado em checkpoints.
# ----------------------------------------------------------------------------------------------
MIN_PLAYERS = [1, 1, 2, 3, 3]         # só informativo: menor grupo com o qual o desenho clássico funciona (testado)
PAR = [3, 4, 6, 6, 10]                # menor tempo (s) do robô perfeito (test_coop.py), arredondado para cima
NEW_PAR = [5, 5, 5, 3, 6, 5, 5, 5, 5, 8, 9, 5]     # fases 6..17 (test_fases.py)
for i, lv in enumerate(LEVELS):
    lv.update({"set": "classic", "group": "classic", "players": 3, "fixed": False, "min": MIN_PLAYERS[i], "par": PAR[i],
               "intro": lv["hint"], "mid": f"classic-{i + 1}", "family": f"classic-{i + 1}", "variant_of": None})
LEVELS.extend(NEW_LEVELS)
for i, lv in enumerate(LEVELS):
    lv["id"] = i + 1
    if i >= 5:
        lv.setdefault("time", 25)
        lv["fixed"] = True                  # papéis definidos pela fase (por ordem de vaga)
        lv["min"] = lv["players"]
        lv["par"] = NEW_PAR[i - 5]
        lv["intro"] = lv["hint"]
        lv["roles"] = ROLE_IDS[:lv["players"]]
        lv["group"] = "new"
        lv["mid"] = ("duo-%d" % (i - 4)) if lv["set"] == "duo" else ("trio-%d" % (i - 10))
        lv["family"] = lv["mid"]; lv["variant_of"] = None

# Variantes de Dupla das clássicas 1, 2 e 3 (identificadores próprios; os originais continuam sendo de Trio)
_DUO_VARIANTS = [
    (0, [[60, 110], [60, 390]], "Primeiros passos (dupla)", 3),
    (1, [[50, 100], [50, 250]], "Cada um no seu caminho (dupla)", 4),
    (2, [[60, 110], [60, 390]], "Segure a porta (dupla)", 6),
]
for src, starts, nm, par in _DUO_VARIANTS:
    v = copy.deepcopy(LEVELS[src])
    v.update({"starts": starts, "name": nm, "players": 2, "fixed": True, "roles": ROLE_IDS[:2], "min": 2, "par": par,
              "mid": LEVELS[src]["mid"] + "-duo", "family": LEVELS[src]["mid"], "variant_of": LEVELS[src]["mid"], "set": "classic", "group": "classic"})
    v["id"] = len(LEVELS) + 1
    LEVELS.append(v)
for lv in LEVELS:
    lv["modality"] = "duo" if lv["players"] == 2 else "trio"

BY_MID = {lv["mid"]: i for i, lv in enumerate(LEVELS)}
# ordem de exibição e de "próxima fase" por modalidade (classicas primeiro, depois as novas)
ORDER = {2: [BY_MID[k] for k in ("classic-1-duo", "classic-2-duo", "classic-3-duo", "duo-1", "duo-2", "duo-3", "duo-4", "duo-5", "duo-6")],
         3: [BY_MID[k] for k in ("classic-1", "classic-2", "classic-3", "classic-4", "classic-5", "trio-1", "trio-2", "trio-3", "trio-4", "trio-5", "trio-6")]}

# EXPEDIÇÃO: 6 fases da modalidade, em ordem de dificuldade crescente (mecânicas usadas + tempo do robô perfeito)
EXPEDITIONS = {
    2: {"id": "expedicao-dupla", "ver": 1, "mids": ["duo-1", "duo-2", "duo-4", "duo-3", "duo-6", "duo-5"]},
    3: {"id": "expedicao-trio", "ver": 1, "mids": ["trio-1", "trio-3", "trio-2", "trio-6", "trio-4", "trio-5"]},
}
for _n, _e in EXPEDITIONS.items():
    _e["maps"] = [BY_MID[k] for k in _e["mids"]]
    assert all(LEVELS[i]["players"] == _n for i in _e["maps"]) and len(_e["maps"]) == 6


def public(lv):
    """O que o cliente precisa para desenhar a fase (cópia sem nada interno)."""
    keys = ("id", "mid", "name", "time", "min", "par", "set", "group", "players", "modality", "fixed", "roles", "intro", "hint", "starts", "walls", "spikes", "lasers", "saws", "plates", "gates", "key", "door")
    return {k: lv.get(k) for k in keys}


def compatible(lv, n):
    """O mapa serve para uma sala de n jogadores? Só se foi feito para EXATAMENTE n."""
    return lv["players"] == n


def maps_for(n):
    """Índices dos mapas da modalidade de n jogadores, na ordem de exibição (lista vazia se não houver)."""
    return list(ORDER.get(n, []))


def catalog():
    return [{"id": lv["id"], "mid": lv["mid"], "name": lv["name"], "time": lv["time"], "min": lv["min"], "par": lv["par"], "set": lv["set"],
             "group": lv["group"], "players": lv["players"], "fixed": lv["fixed"], "modality": lv["modality"], "family": lv["family"], "variant_of": lv["variant_of"]} for lv in LEVELS]


def sequences():
    return {str(n): {"id": e["id"], "ver": e["ver"], "mids": e["mids"], "maps": e["maps"]} for n, e in EXPEDITIONS.items()}
