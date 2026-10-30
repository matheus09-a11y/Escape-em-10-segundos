/* =====================================================================
 * audio.js — efeitos sonoros gerados na hora (Web Audio), sem arquivos
 * nem serviços externos.
 *
 * O AudioContext só é criado DEPOIS de uma interação do jogador:
 * Sfx.unlock() é chamado pelos ouvintes de pointerdown/keydown do jogo.
 * Antes disso (e com som desligado ou volume 0) Sfx.play() não faz nada.
 *
 * Para criar/ajustar um som, edite a tabela SOUNDS: cada nota é
 * {f: freq inicial Hz, to: freq final Hz (opcional), t: início (s), d: duração (s),
 *  type: "sine" | "square" | "triangle" | "sawtooth", v: volume 0..1}.
 * ===================================================================== */
(function (root) {
  const SOUNDS = {
    key: [{ f: 660, t: 0, d: 0.08, type: "square", v: 0.5 }, { f: 990, t: 0.08, d: 0.14, type: "square", v: 0.5 }],
    coin: [{ f: 1320, t: 0, d: 0.07, type: "sine", v: 0.7 }, { f: 1760, t: 0.07, d: 0.18, type: "sine", v: 0.7 }],
    dash: [{ f: 260, to: 1100, t: 0, d: 0.12, type: "sawtooth", v: 0.5 }],
    portal: [{ f: 420, to: 900, t: 0, d: 0.14, type: "triangle", v: 0.6 }, { f: 900, to: 380, t: 0.14, d: 0.16, type: "triangle", v: 0.6 }],
    switch: [{ f: 200, t: 0, d: 0.05, type: "square", v: 0.5 }, { f: 130, t: 0.06, d: 0.09, type: "square", v: 0.5 }],
    lose: [{ f: 420, to: 80, t: 0, d: 0.45, type: "sawtooth", v: 0.45 }],
    win: [523, 659, 784, 1047].map((f, i) => ({ f, t: i * 0.1, d: i === 3 ? 0.3 : 0.12, type: "triangle", v: 0.6 })),
    tick: [{ f: 1000, t: 0, d: 0.05, type: "square", v: 0.45 }], // aviso dos 3 últimos segundos
    blip: [{ f: 880, t: 0, d: 0.06, type: "sine", v: 0.5 }], // teste do controle de volume
  };

  const GAIN = 0.9; // ganho mestre (verificado offline: pico <= 0,63 mesmo no volume máximo)

  const Sfx = {
    ctx: null, // só existe depois de unlock()
    master: null,
    unlocked: false,
    enabled: true,
    volume: 0.6, // 0..1
    played: 0, // contador (usado nos testes)
    last: null,

    configure(opts) {
      if (opts.enabled !== undefined) Sfx.enabled = !!opts.enabled;
      if (opts.volume !== undefined) Sfx.volume = Math.max(0, Math.min(1, +opts.volume || 0));
      if (Sfx.master) Sfx.master.gain.value = Sfx.volume * GAIN;
    },

    /** Chamado a partir de um gesto do jogador (toque, clique ou tecla). */
    unlock() {
      Sfx.unlocked = true;
      ensure();
    },

    play(name) {
      if (!Sfx.unlocked || !Sfx.enabled || Sfx.volume <= 0) return;
      const notes = SOUNDS[name];
      if (!notes || !ensure()) return;
      Sfx.played++;
      Sfx.last = name;
      const ctx = Sfx.ctx, t0 = ctx.currentTime + 0.005;
      for (const n of notes) {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = n.type || "sine";
        osc.frequency.setValueAtTime(n.f, t0 + n.t);
        if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.t + n.d);
        g.gain.setValueAtTime(0.0001, t0 + n.t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.v || 0.5), t0 + n.t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
        osc.connect(g); g.connect(Sfx.master);
        osc.start(t0 + n.t);
        osc.stop(t0 + n.t + n.d + 0.02);
      }
    },
  };

  function ensure() {
    if (!Sfx.ctx) {
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return false;
        Sfx.ctx = new AC();
        Sfx.master = Sfx.ctx.createGain();
        Sfx.master.gain.value = Sfx.volume * GAIN;
        Sfx.master.connect(Sfx.ctx.destination);
      } catch (e) { Sfx.ctx = null; return false; }
    }
    if (Sfx.ctx.state === "suspended") { try { const p = Sfx.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    return true;
  }

  root.Sfx = Sfx;
})(typeof window !== "undefined" ? window : globalThis);
