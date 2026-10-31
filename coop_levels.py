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

# mínimo de jogadores para a fase ser possível (placas de segurar exigem gente para segurar E passar)
MIN_PLAYERS = [1, 1, 2, 3, 3]
for i, lv in enumerate(LEVELS):
    lv["id"] = i + 1
    lv["min"] = MIN_PLAYERS[i]


def public(lv):
    """O que o cliente precisa para desenhar a fase (cópia sem nada interno)."""
    keys = ("id", "name", "time", "min", "hint", "starts", "walls", "spikes", "lasers", "saws", "plates", "gates", "key", "door")
    return {k: lv[k] for k in keys}


def catalog():
    return [{"id": lv["id"], "name": lv["name"], "time": lv["time"], "min": lv["min"]} for lv in LEVELS]
