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
    else if (cmd === "vol") p?.setVolume ? p.setVolume(arg) : v && (v.volume = arg / 100);
    else if (cmd === "seek" && v) v.currentTime = arg;
    else if (cmd === "search") location.href = "/search?q=" + encodeURIComponent(arg);
    else if (cmd === "duck" && v && !v.paused && !v.muted) {
      // Silencia la música mientras suena la campanilla del cambio de ciclo.
      v.muted = true;
      clearTimeout(duck);
      duck = setTimeout(() => (v.muted = false), arg * 1000);
    }
    setTimeout(push, 200);
  };
})();
