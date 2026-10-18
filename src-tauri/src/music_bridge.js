// Inyectado en la ventana de YouTube Music. La web NO tiene IPC con la app:
// el estado sale por document.title (Rust lo lee con on_document_title_changed)
// y los comandos entran por eval() -> window.__pet(cmd, arg).
(() => {
  if (location.hostname !== "music.youtube.com" || window.__pet) return;
  const P = "PETSTATE:";
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, "title");
  // YTM reescribe el título; se bloquea para que el canal sea solo nuestro.
  Object.defineProperty(document, "title", { get: () => desc.get.call(document), set: () => {} });

  // YTM registra estos manejadores para las teclas multimedia del sistema; se capturan para reusarlos
  // (los botones de la barra viven en shadow DOM y no son accesibles por selector).
  const actions = {};
  const ms = navigator.mediaSession;
  const setAH = ms?.setActionHandler?.bind(ms);
  if (setAH) ms.setActionHandler = (a, fn) => ((actions[a] = fn), setAH(a, fn));

  const player = () => document.getElementById("movie_player");
  const video = () => document.querySelector("video");
  const txt = (el, sel) => el.querySelector(sel)?.textContent.trim().replace(/\s+/g, " ") ?? "";
  const queueItems = () => [...document.querySelectorAll("ytmusic-player-queue-item")];
  // Los siguientes (hasta 12) tras el que suena; `i` es el índice absoluto para `jump`.
  const upNext = (title) => {
    const items = queueItems();
    let cur = items.findIndex((el) => el.hasAttribute("selected"));
    if (cur < 0) cur = items.findIndex((el) => txt(el, ".song-title") === title);
    return items.slice(cur + 1, cur + 13).map((el, k) => ({
      t: txt(el, ".song-title"),
      a: txt(el, ".byline"),
      i: cur + 1 + k,
    }));
  };

  let last = "";
  const push = () => {
    const v = video(), p = player(), m = navigator.mediaSession?.metadata;
    const j = JSON.stringify({
      title: m?.title ?? "",
      artist: m?.artist ?? "",
      art: m?.artwork?.at(-1)?.src ?? "",
      playing: !!v && !v.paused,
      t: v ? Math.floor(v.currentTime) : 0,
      d: v && isFinite(v.duration) ? Math.floor(v.duration) : 0,
      q: upNext(m?.title ?? ""),
      vol: p?.getVolume?.() ?? (v ? Math.round(v.volume * 100) : 100),
    });
    if (j !== last) desc.set.call(document, P + (last = j));
  };
  setInterval(push, 1000);

  let duck;
  window.__pet = (cmd, arg) => {
    const v = video(), p = player();
    if (cmd === "toggle") v && (v.paused ? v.play() : v.pause());
    else if (cmd === "next") actions.nexttrack?.({ action: "nexttrack" });
    else if (cmd === "prev") actions.previoustrack?.({ action: "previoustrack" });
    else if (cmd === "jump") {
      const el = queueItems()[arg];
      (el?.querySelector("ytmusic-play-button-renderer") ?? el)?.click();
    } else if (cmd === "vol") p?.setVolume ? p.setVolume(arg) : v && (v.volume = arg / 100);
    else if (cmd === "seek" && v) v.currentTime = arg;
    else if (cmd === "search") location.href = "/search?q=" + encodeURIComponent(arg);
    else if (cmd === "duck" && v && !v.paused && !v.muted) {
      // Baja la música de a poco mientras suena la campanilla del cambio de ciclo y la vuelve a subir suave.
      clearInterval(duck?.i);
      clearTimeout(duck?.t);
      const d = (duck = { base: duck?.base ?? v.volume });
      const fade = (to, ms, done) => {
        const from = v.volume, t0 = Date.now();
        clearInterval(d.i);
        d.i = setInterval(() => {
          const k = Math.min(1, (Date.now() - t0) / ms);
          // curva exponencial: el oído percibe el volumen en escala log, así no se nota el salto
          v.volume = Math.min(1, Math.max(0.001, from) * (Math.max(0.001, to) / Math.max(0.001, from)) ** k);
          if (k === 1) clearInterval(d.i), done?.();
        }, 30);
      };
      fade(d.base * 0.07, 500); // muy baja, no muda
      d.t = setTimeout(() => fade(d.base, 1500, () => duck === d && (duck = null)), arg * 1000);
    }
    setTimeout(push, 200);
  };
})();
