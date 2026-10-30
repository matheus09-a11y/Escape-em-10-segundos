/* Worker do verificador: analisa uma fase por mensagem (roda em paralelo). */
importScripts("../levels.js?" + Date.now(), "../missions.js?" + Date.now(), "../engine.js?" + Date.now(), "verify-core.js?" + Date.now()); // ?t= evita cache antigo
onmessage = (e) => postMessage(VerifyCore.analyze(e.data));
