// Inyectado en la ventana de música (YouTube Music, Spotify o el reproductor local). La web NO tiene IPC con la app:
// el estado sale por document.title (Rust lo lee con on_document_title_changed)
// y los comandos entran por eval() -> window.__pet(cmd, arg).
(() => {
  // localhost / tauri.localhost = la app (src/music/LocalPlayer.tsx, que expone window.__petLocal); fuera de esto, p. ej. el login, nada.
  const site = { "music.youtube.com": "ytm", "open.spotify.com": "spotify", localhost: "local", "tauri.localhost": "local" }[
    location.hostname
  ];
  if (!site || window.__pet) return;
  const local = () => window.__petLocal;
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

  // Último <video>/<audio> que sonó: Spotify lo crea fuera del DOM.
  let media;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    media = this;
    return play.apply(this, arguments);
  };
  const player = () => document.getElementById("movie_player"); // solo YTM
  const video = () => media ?? document.querySelector("video, audio");
  const txt = (el, sel) => el.querySelector(sel)?.textContent.trim().replace(/\s+/g, " ") ?? "";
  // Spotify: la cola vive en el panel lateral derecho; se abre una vez (la ventana está oculta, no molesta) y se leen sus filas.
  // ponytail: selectores del DOM de Spotify sin API pública; si un rediseño los rompe, la lista vuelve a salir vacía.
  let spOpened = false;
  const spRows = () => {
    const b = document.querySelector('[data-testid="control-button-queue"]');
    if (b && !spOpened && b.getAttribute("aria-pressed") !== "true") (spOpened = true), b.click();
    return [...document.querySelectorAll('aside [data-testid="tracklist-row"], aside [role="row"]')];
  };
  const spTitle = (el) =>
    (el.querySelector('[data-testid="internal-track-link"], a[href*="/track/"]')?.textContent ?? "").trim();
  const spArtist = (el) => [...el.querySelectorAll('a[href*="/artist/"]')].map((a) => a.textContent.trim()).join(", ");
  const queueItems = () =>
    site === "spotify" ? spRows().filter(spTitle) : [...document.querySelectorAll("ytmusic-player-queue-item")];
  // Los siguientes (hasta 12) tras el que suena; `i` es el índice absoluto para `jump`.
  const upNext = (title) => {
    if (site === "local") return local()?.queue() ?? [];
    const items = queueItems();
    const t = site === "ytm" ? (el) => txt(el, ".song-title") : spTitle;
    let cur = site === "ytm" ? items.findIndex((el) => el.hasAttribute("selected")) : -1;
    if (cur < 0) cur = items.findIndex((el) => t(el) === title);
    return items.slice(cur + 1, cur + 13).map((el, k) => ({
      t: t(el),
      a: site === "ytm" ? txt(el, ".byline") : spArtist(el),
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
    if (cmd === "toggle") {
      // Spotify quiere sus propios manejadores (antes del primer play no hay elemento que pausar).
      const a = !v || v.paused ? "play" : "pause";
      actions[a] ? actions[a]({ action: a }) : v && (v.paused ? v.play() : v.pause());
    } else if (cmd === "next") actions.nexttrack?.({ action: "nexttrack" });
    else if (cmd === "prev") actions.previoustrack?.({ action: "previoustrack" });
    else if (cmd === "jump") {
      if (site === "local") local()?.jump(arg);
      const el = site !== "local" && queueItems()[arg];
      if (site === "spotify") el?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); // filas de Spotify: doble clic = reproducir
      else el && (el.querySelector("ytmusic-play-button-renderer") ?? el).click();
    } else if (cmd === "vol") p?.setVolume ? p.setVolume(arg) : v && (v.volume = arg / 100);
    else if (cmd === "seek")
      actions.seekto ? actions.seekto({ action: "seekto", seekTime: arg }) : v && (v.currentTime = arg);
    else if (cmd === "search") {
      if (site === "local") local()?.search(arg);
      else location.href = (site === "spotify" ? "/search/" : "/search?q=") + encodeURIComponent(arg);
    }
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
