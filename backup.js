/* =====================================================================
 * backup.js — Exportar / importar / apagar progresso (Configurações).
 * Formato do arquivo (versionado):
 *   { format:"dez-segundos-backup", version:1, game:"1.0", exportedAt:"ISO",
 *     campaign:{…}|null, missions:{…}|null, settings:{…}|null, custom:{v,maps:[…]}|null }
 * O arquivo é tratado só como DADOS: JSON.parse + validação campo a campo; nada é executado nem
 * inserido como HTML. Nada é gravado se a validação falhar; a gravação é conferida e, se falhar, desfeita.
 * ===================================================================== */
(function () {
  "use strict";
  const API = window.GameAPI, MK = window.MapKit;
  const $ = (id) => document.getElementById(id);
  const KEYS = { campaign: "dez-segundos-v1", missions: "dez-segundos-missions-v1", settings: "dez-segundos-settings-v1", custom: MK.KEY };
  const FORMAT = "dez-segundos-backup", VERSION = 2, MAX_FILE = 2000000;
  const N = API.N, MISSION_IDS = API.MISSIONS.map((m) => m.id);
  const panel = $("backup"), body = $("bk-body");

  /* ---------- leitura do estado atual ---------- */
  function readKey(k) { try { const r = localStorage.getItem(k); return r === null ? null : JSON.parse(r); } catch (e) { return undefined; } }
  function collect() {
    const out = { campaign: readKey(KEYS.campaign), missions: readKey(KEYS.missions), settings: readKey(KEYS.settings), custom: null };
    const bad = [];
    for (const k of ["campaign", "missions", "settings"]) if (out[k] === undefined) { bad.push(k); out[k] = null; }
    const l = MK.loadAll();
    if (!l.ok) bad.push("custom"); else if (l.items.length) out.custom = MK.storeObject(l.items);
    return { data: out, unreadable: bad };
  }

  /* ---------- validação ---------- */
  const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const onlyKeys = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));
  const validLimit = (v) => v === 0 || isInt(v, 5, 300);
  function intSet(a, max, what) {
    if (!Array.isArray(a) || a.length > max) throw new Error(`${what}: lista inválida.`);
    const seen = new Set();
    for (const v of a) { if (!isInt(v, 0, max - 1) || seen.has(v)) throw new Error(`${what}: valor inválido.`); seen.add(v); }
    return [...seen].sort((x, y) => x - y);
  }
  function times(o, what, maxT) {
    if (!isObj(o) || Object.keys(o).length > N) throw new Error(`${what}: formato inválido.`);
    const r = {};
    for (const k of Object.keys(o)) { if (!/^\d{1,2}$/.test(k) || +k >= N || typeof o[k] !== "number" || !(o[k] > 0 && o[k] <= maxT)) throw new Error(`${what}: tempo inválido.`); r[k] = o[k]; }
    return r;
  }
  function checkCampaign(c) {
    if (!isObj(c) || !isInt(c.v, 1, 5)) throw new Error("Campanha: versão desconhecida.");
    if (!isInt(c.attempts, 0, 1e8)) throw new Error("Campanha: tentativas inválidas.");
    if (c.v === 1) {
      if (!onlyKeys(c, ["v", "level", "attempts"]) || !isInt(c.level, 0, N)) throw new Error("Campanha: dados inválidos.");
      return { v: 5, unlocked: Math.min(c.level, N - 1), attempts: c.attempts, finished: false, done: Array.from({ length: Math.min(c.level, N) }, (_, i) => i), coins: [], fast: [], best: {}, bestBy: {} };
    }
    if (!onlyKeys(c, ["v", "unlocked", "attempts", "finished", "done", "coins", "fast", "best", "bestBy"])) throw new Error("Campanha: campos desconhecidos.");
    if (!isInt(c.unlocked, 0, N - 1)) throw new Error("Campanha: fase liberada inválida.");
    if (c.finished !== undefined && typeof c.finished !== "boolean") throw new Error("Campanha: campo inválido.");
    const out = { v: 5, unlocked: c.unlocked, attempts: c.attempts, finished: c.finished === true, done: intSet(c.done || [], N, "Campanha (concluídas)"), coins: intSet(c.coins || [], N, "Campanha (moedas)"), fast: intSet(c.fast || [], N, "Campanha (medalhas)"), best: times(c.best || {}, "Recordes", 10), bestBy: {} };
    const bb = c.bestBy || {};
    if (!isObj(bb) || Object.keys(bb).length > 400) throw new Error("Recordes por tempo: formato inválido.");
    for (const lk of Object.keys(bb)) { const l = Number(lk); if (!/^\d{1,3}$/.test(lk) || !validLimit(l) || l === 10) throw new Error("Recordes por tempo: limite inválido."); out.bestBy[lk] = times(bb[lk], "Recordes por tempo", 86400); }
    return out;
  }
  function checkMissions(m) {
    if (!isObj(m) || m.v !== 1 || !onlyKeys(m, ["v", "done", "orig", "best"])) throw new Error("Missões: formato inválido.");
    const ids = (a, w) => { if (!Array.isArray(a) || a.length > MISSION_IDS.length) throw new Error(w + ": lista inválida."); const s = new Set(); for (const id of a) { if (typeof id !== "string" || !MISSION_IDS.includes(id) || s.has(id)) throw new Error(w + ": missão desconhecida."); s.add(id); } return [...s]; };
    const out = { v: 1, done: ids(m.done || [], "Missões"), orig: ids(m.orig || [], "Selos"), best: {} };
    const b = m.best || {};
    if (!isObj(b)) throw new Error("Missões: recordes inválidos.");
    for (const id of Object.keys(b)) {
      if (!MISSION_IDS.includes(id) || !isObj(b[id]) || Object.keys(b[id]).length > 400) throw new Error("Missões: recorde inválido.");
      out.best[id] = {};
      for (const lk of Object.keys(b[id])) { if (!/^\d{1,3}$/.test(lk) || !validLimit(Number(lk)) || typeof b[id][lk] !== "number" || !(b[id][lk] > 0 && b[id][lk] < 86400)) throw new Error("Missões: recorde inválido."); out.best[id][lk] = b[id][lk]; }
    }
    return out;
  }
  function checkSettings(s) {
    const allowed = ["sound", "volume", "reduceFx", "touch", "limit", "customLimit", "limitChosen", "skin"];
    if (!isObj(s) || !onlyKeys(s, allowed)) throw new Error("Configurações: campos inválidos.");
    const out = {};
    if (s.sound !== undefined) { if (typeof s.sound !== "boolean") throw new Error("Configurações: som inválido."); out.sound = s.sound; }
    if (s.volume !== undefined) { if (!isInt(s.volume, 0, 100)) throw new Error("Configurações: volume inválido."); out.volume = s.volume; }
    if (s.reduceFx !== undefined) { if (typeof s.reduceFx !== "boolean") throw new Error("Configurações: efeitos inválidos."); out.reduceFx = s.reduceFx; }
    if (s.touch !== undefined) { if (!["auto", "on", "off"].includes(s.touch)) throw new Error("Configurações: controles inválidos."); out.touch = s.touch; }
    if (s.limit !== undefined) { if (!validLimit(s.limit)) throw new Error("Configurações: tempo por sala inválido."); out.limit = s.limit; }
    if (s.customLimit !== undefined) { if (!isInt(s.customLimit, 5, 300)) throw new Error("Configurações: tempo personalizado inválido."); out.customLimit = s.customLimit; }
    if (s.limitChosen !== undefined) { if (typeof s.limitChosen !== "boolean") throw new Error("Configurações: campo inválido."); out.limitChosen = s.limitChosen; }
    if (s.skin !== undefined) { if (typeof s.skin !== "string" || !API.SKIN_IDS.includes(s.skin)) throw new Error("Configurações: skin desconhecida."); out.skin = s.skin; }
    return out;
  }
  function checkCustom(c) {
    const items = MK.parseStore(c);
    if (!items) throw new Error("Fases criadas: dados inválidos (formato, limite de " + MK.MAX_MAPS + " fases ou fase corrompida).");
    return MK.storeObject(items); // reconstrói: "validada" é recalculada, não aceita do arquivo
  }
  /** Devolve {ok:true, data} ou {ok:false, error}. Não grava nada. */
  function validateBackup(text) {
    if (typeof text !== "string" || !text.trim()) return { ok: false, error: "Escolha um arquivo ou cole o conteúdo do backup." };
    if (text.length > MAX_FILE) return { ok: false, error: "Arquivo grande demais para ser um backup deste jogo (máximo 2 MB)." };
    let o;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, error: "O arquivo não é um JSON válido." }; }
    try {
      if (!isObj(o) || o.format !== FORMAT) throw new Error("Isto não é um backup de “Dez segundos para fugir”.");
      if (!onlyKeys(o, ["format", "version", "game", "exportedAt", "campaign", "missions", "settings", "custom"])) throw new Error("O backup tem campos desconhecidos.");
      if (!Number.isInteger(o.version)) throw new Error("Versão do backup ausente.");
      if (o.version !== 1 && o.version !== 2) throw new Error(`Versão do backup incompatível (arquivo: ${o.version}; este jogo lê as versões 1 e 2).`);
      const data = {
        campaign: o.campaign == null ? null : checkCampaign(o.campaign),
        missions: o.missions == null ? null : checkMissions(o.missions),
        settings: o.settings == null ? null : checkSettings(o.settings),
        custom: o.custom == null ? null : checkCustom(o.custom),
      };
      if (!data.campaign && !data.missions && !data.settings && !data.custom) throw new Error("O backup está vazio.");
      return { ok: true, data, exportedAt: typeof o.exportedAt === "string" ? o.exportedAt.slice(0, 40) : "" };
    } catch (e) { return { ok: false, error: e.message || "Backup inválido." }; }
  }

  /* ---------- resumo (números e nomes entram só via textContent) ---------- */
  function summary(d) {
    const c = d.campaign, m = d.missions, s = d.settings, cu = d.custom;
    const cnt = (a) => (Array.isArray(a) ? a.length : 0);
    const nm = (x) => String(x && x.name !== undefined ? x.name : x.map ? x.map.name : "").slice(0, 40);
    return [
      ["Campanha", c ? `${cnt(c.done)}/${N} fases concluídas · ${cnt(c.coins)} moedas · ${cnt(c.fast)} medalhas ⏱` : "sem dados"],
      ["Missões", m ? `${cnt(m.done)}/${MISSION_IDS.length} concluídas` : "sem dados"],
      ["Fases criadas", cu && cu.maps && cu.maps.length ? `${cu.maps.length}: ` + cu.maps.slice(0, 5).map(nm).join(", ") + (cu.maps.length > 5 ? "…" : "") : "nenhuma"],
      ["Configurações", s ? `tempo ${s.limit === undefined ? "padrão" : s.limit === 0 ? "sem limite" : s.limit + " s"} · skin ${s.skin || "padrão"} · som ${s.sound === false ? "desligado" : "ligado"}` : "padrão"],
    ];
  }

  /* ---------- gravação segura: grava, confere e desfaz se algo falhar ---------- */
  function writePlan(plan) {
    const old = {};
    try { for (const [k] of plan) old[k] = localStorage.getItem(k); } catch (e) { return { ok: false, error: "Armazenamento indisponível. Nada foi alterado." }; }
    try {
      for (const [k, v] of plan) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }
      for (const [k, v] of plan) if (localStorage.getItem(k) !== v) throw new Error("verify");
      return { ok: true };
    } catch (e) {
      try { for (const k of Object.keys(old)) { if (old[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, old[k]); } } catch (e2) { return { ok: false, error: "Falha ao gravar e não foi possível restaurar tudo. Recarregue a página e, se tiver o arquivo, importe de novo." }; }
      return { ok: false, error: "O navegador não conseguiu gravar (armazenamento cheio ou bloqueado). Seus dados anteriores foram mantidos." };
    }
  }
  function applyData(data) {
    const j = (v) => (v === null ? null : JSON.stringify(v));
    return writePlan([[KEYS.campaign, j(data.campaign)], [KEYS.missions, j(data.missions)], [KEYS.custom, j(data.custom)], [KEYS.settings, j(data.settings)]]);
  }

  /* ---------- exportação ---------- */
  function buildBackupText() {
    const cur = collect();
    const obj = { format: FORMAT, version: VERSION, game: "1.0", exportedAt: new Date().toISOString(), campaign: cur.data.campaign, missions: cur.data.missions, settings: cur.data.settings, custom: cur.data.custom };
    return { text: JSON.stringify(obj, null, 1), unreadable: cur.unreadable };
  }
  function download(text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = "dez-segundos-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- UI ---------- */
  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      if (k === "text") e.textContent = props[k];
      else if (k === "class") e.className = props[k];
      else if (k === "on") { for (const ev of Object.keys(props.on)) e.addEventListener(ev, props.on[ev]); }
      else e.setAttribute(k, props[k]);
    }
    kids.flat().forEach((c) => c && e.appendChild(c));
    return e;
  };
  const btn = (text, fn, cls) => el("button", { class: "btn " + (cls || "btn-ghost"), type: "button", text, on: { click: fn } });
  const STORAGE_NOTE = "O progresso fica salvo neste navegador e não é sincronizado automaticamente entre dispositivos.";

  function show() {
    API.hideSettings(); API.hideOverlay(); API.releaseInput();
    document.querySelectorAll(".ed-panel").forEach((p) => p.classList.add("hidden"));
    document.body.classList.remove("editing"); document.body.classList.add("ed-lists");
    panel.classList.remove("hidden");
  }
  function close() { panel.classList.add("hidden"); document.body.classList.remove("ed-lists"); }
  function backToSettings() { close(); API.openSettingsAgain(); }
  function done() { close(); API.clearSettingsBack(); API.showMenu(); }
  function render(...kids) { body.textContent = ""; kids.flat().forEach((k) => k && body.appendChild(k)); const f = body.querySelector("input, button"); if (f) f.focus(); }
  const msgEl = (role) => el("p", { class: "bk-msg", role: role || "status", "aria-live": "polite" });

  function copyText(ta, text, m) {
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { /* tenta a API moderna */ }
    const fail = () => { m.textContent = "Não foi possível copiar automaticamente: selecione o texto e copie à mão."; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => { m.textContent = "Texto copiado."; }, () => { if (ok) m.textContent = "Texto copiado."; else fail(); });
    else if (ok) m.textContent = "Texto copiado."; else fail();
  }

  function exportView() {
    show();
    const { text, unreadable } = buildBackupText();
    const m = msgEl();
    const ta = el("textarea", { rows: "5", readonly: "", "aria-label": "Texto do backup", spellcheck: "false" });
    ta.value = text;
    render(
      el("h1", { text: "Exportar progresso" }),
      el("p", { class: "lead", text: "Gera um arquivo de backup com campanha, missões, skins e configurações, resultados e fases criadas. " + STORAGE_NOTE }),
      unreadable.length ? el("p", { class: "bk-warn", text: "Atenção: não foi possível ler parte dos dados salvos (" + unreadable.join(", ") + "). Eles ficam fora do arquivo." }) : null,
      el("div", { class: "ov-actions" },
        btn("Baixar arquivo de backup", () => { m.textContent = download(text) ? "Download solicitado. Se o arquivo não aparecer (alguns navegadores bloqueiam), copie o texto abaixo e salve em um arquivo .json." : "Não foi possível baixar. Copie o texto abaixo e salve em um arquivo .json."; }, "btn"),
        btn("Voltar", backToSettings)),
      m,
      el("details", null, el("summary", { text: "Mostrar o texto do backup (para copiar)" }), ta, btn("Copiar texto", () => copyText(ta, text, m))),
    );
  }

  function summaryTable(cur, next) {
    const a = summary(cur), b = next ? summary(next) : null;
    const t = el("table", { class: "bk-table" }, el("tr", null, el("th", { text: "" }), el("th", { text: "Neste navegador agora" }), b ? el("th", { text: "No backup" }) : null));
    a.forEach((row, i) => t.appendChild(el("tr", null, el("th", { text: row[0] }), el("td", { text: row[1] }), b ? el("td", { text: b[i][1] }) : null)));
    return t;
  }

  function importView() {
    show();
    const m = msgEl("alert");
    const file = el("input", { type: "file", accept: ".json,application/json", "aria-label": "Arquivo de backup" });
    const ta = el("textarea", { rows: "4", placeholder: "…ou cole aqui o conteúdo do backup", "aria-label": "Conteúdo do backup", spellcheck: "false" });
    let loaded = "";
    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      loaded = ""; m.textContent = "";
      if (!f) return;
      if (f.size > MAX_FILE) { m.textContent = "Arquivo grande demais para ser um backup deste jogo (máximo 2 MB)."; return; }
      const r = new FileReader();
      r.onload = () => { loaded = String(r.result || ""); ta.value = ""; m.textContent = "Arquivo lido: " + f.name.slice(0, 60) + ". Toque em “Verificar backup”."; };
      r.onerror = () => { m.textContent = "Não foi possível ler o arquivo."; };
      r.readAsText(f);
    });
    const verify = () => {
      const r = validateBackup(ta.value.trim() ? ta.value : loaded);
      if (!r.ok) { m.textContent = "Backup recusado: " + r.error + " Nada foi alterado."; return; }
      confirmView(r);
    };
    render(
      el("h1", { text: "Importar progresso" }),
      el("p", { class: "lead", text: "Importar substitui os dados locais deste navegador (campanha, missões, configurações e fases criadas) pelos do backup. Você verá um resumo antes de confirmar. " + STORAGE_NOTE }),
      el("label", { class: "bk-file" }, el("span", { text: "Arquivo de backup (.json)" }), file),
      ta, m,
      el("div", { class: "ov-actions" }, btn("Verificar backup", verify, "btn"), btn("Voltar", backToSettings)),
    );
  }

  function confirmView(r) {
    show();
    const m = msgEl("alert");
    const cur = collect().data;
    render(
      el("h1", { text: "Substituir dados locais?" }),
      el("p", { class: "lead", text: "O backup é válido" + (r.exportedAt ? " (gerado em " + r.exportedAt.slice(0, 10) + ")" : "") + ". Ao confirmar, os dados deste navegador serão SUBSTITUÍDOS pelos abaixo; seções sem dados no backup serão apagadas daqui. Uma partida em andamento será descartada." }),
      summaryTable(cur, r.data),
      m,
      el("div", { class: "ov-actions" },
        btn("Exportar o progresso atual antes", () => { m.textContent = download(buildBackupText().text) ? "Download do backup atual solicitado. Confira o arquivo antes de substituir." : "Não foi possível baixar. Cancele e use “Exportar progresso” para copiar o texto."; }),
        btn("Substituir dados locais", () => {
          const w = applyData(r.data);
          if (!w.ok) { m.textContent = w.error; return; }
          API.reloadAll(); done();
        }, "btn danger"),
        btn("Cancelar", importView),
      ),
    );
  }

  function eraseView() {
    show();
    const m = msgEl("alert");
    const chk = el("input", { type: "checkbox", id: "bk-erase-custom" });
    const cur = collect().data;
    render(
      el("h1", { text: "Apagar progresso" }),
      el("p", { class: "lead", text: "Apaga a campanha (fases, moedas, medalhas e recordes) e as missões deste navegador. Não dá para desfazer. Som, controles e tempo por sala ficam; as skins voltam a depender das conquistas. Uma partida em andamento será descartada." }),
      summaryTable(cur, null),
      el("label", { class: "row" }, chk, el("span", { text: "Apagar também as fases que criei" })),
      m,
      el("div", { class: "ov-actions" },
        btn("Exportar antes", () => { m.textContent = download(buildBackupText().text) ? "Download solicitado. Confira o arquivo antes de apagar." : "Não foi possível baixar. Cancele e use “Exportar progresso” para copiar o texto."; }),
        btn("Apagar definitivamente", () => {
          const plan = [[KEYS.campaign, null], [KEYS.missions, null]];
          if (chk.checked) plan.push([KEYS.custom, null]);
          const w = writePlan(plan);
          if (!w.ok) { m.textContent = w.error; return; }
          API.reloadAll(); done();
        }, "btn danger"),
        btn("Cancelar", backToSettings, "btn"),
      ),
    );
  }

  panel.addEventListener("keydown", (e) => { if (e.code === "Escape" && !panel.classList.contains("hidden")) { e.preventDefault(); e.stopPropagation(); backToSettings(); } });
  $("set-export").addEventListener("click", exportView);
  $("set-import").addEventListener("click", importView);
  $("set-erase").addEventListener("click", eraseView);

  window.Backup = { validateBackup, applyData, buildBackupText, collect, summary, writePlan };
})();
