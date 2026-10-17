import { useState } from "react";
import { fmt } from "../lib/time";
import { music, openMusic, useMusic } from "../store/useMusic";
import { Icon } from "./icons";

export function MusicPlayer() {
  const s = useMusic((m) => m.s);
  const [q, setQ] = useState("");
  // Mientras se arrastra un slider se muestra el valor local, no el que llega de la web.
  const [seek, setSeek] = useState<number | null>(null);
  const [vol, setVol] = useState<number | null>(null);

  if (!s)
    return (
      <div className="card stack center" style={{ gap: ".8em", padding: "2em 1em", marginTop: "1em" }}>
        <div style={{ display: "grid", placeItems: "center", width: "3.4em", height: "3.4em", borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)" }}>
          <Icon name="music" size="1.6em" />
        </div>
        <b>YouTube Music no está abierto</b>
        <span className="small muted">La primera vez inicia sesión en la ventana que se abre.</span>
        <button className="b b-primary" onClick={() => openMusic()}>
          <Icon name="external" size="1em" /> Abrir YouTube Music
        </button>
      </div>
    );

  const search = () => {
    if (!q.trim()) return;
    music("search", q.trim());
    openMusic();
    setQ("");
  };

  return (
    <div className="stack" style={{ gap: "1em" }}>
      <div className="card stack" style={{ gap: ".9em" }}>
        <div className="row" style={{ gap: ".8em" }}>
          {s.art ? (
            <img src={s.art} style={{ width: "4.6em", height: "4.6em", borderRadius: "var(--r-sm)", objectFit: "cover", flex: "none", boxShadow: "0 6px 18px -6px #000" }} />
          ) : (
            <div style={{ width: "4.6em", height: "4.6em", borderRadius: "var(--r-sm)", background: "var(--surface-2)", display: "grid", placeItems: "center", flex: "none", color: "var(--muted)" }}>
              <Icon name="music" size="1.8em" />
            </div>
          )}
          <div className="grow" style={{ display: "grid", gap: ".15em" }}>
            <b className="ellipsis">{s.title || "Nada sonando"}</b>
            <span className="small muted ellipsis">{s.artist}</span>
          </div>
        </div>

        <div className="stack" style={{ gap: ".25em" }}>
          <input
            type="range"
            aria-label="Posición"
            min={0}
            max={s.d || 1}
            value={seek ?? s.t}
            disabled={!s.d}
            onChange={(e) => setSeek(+e.target.value)}
            onPointerUp={() => seek !== null && (music("seek", seek), setSeek(null))}
            onKeyUp={() => seek !== null && (music("seek", seek), setSeek(null))}
          />
          <div className="row small muted" style={{ justifyContent: "space-between", fontVariantNumeric: "tabular-nums" }}>
            <span>{fmt(seek ?? s.t)}</span>
            <span>{fmt(s.d)}</span>
          </div>
        </div>

        <div className="row" style={{ justifyContent: "center", gap: "1em" }}>
          <button className="b b-ghost b-round" aria-label="Anterior" onClick={() => music("prev")}>
            <Icon name="prev" />
          </button>
          <button className="b b-primary b-round" style={{ fontSize: "1.3em" }} aria-label={s.playing ? "Pausar" : "Reproducir"} onClick={() => music("toggle")}>
            <Icon name={s.playing ? "pause" : "play"} />
          </button>
          <button className="b b-ghost b-round" aria-label="Siguiente" onClick={() => music("next")}>
            <Icon name="next" />
          </button>
        </div>

        <label className="row muted">
          <Icon name="volume" size="1em" />
          <input
            type="range"
            aria-label="Volumen"
            min={0}
            max={100}
            value={vol ?? s.vol}
            onChange={(e) => {
              setVol(+e.target.value);
              music("vol", +e.target.value);
            }}
            onPointerUp={() => setVol(null)}
          />
        </label>
      </div>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <div className="field-wrap grow">
          <Icon name="search" size="1em" />
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar canción, artista…" />
        </div>
        <button className="b b-ghost b-sq" title="Mostrar YouTube Music" aria-label="Mostrar YouTube Music" type="button" onClick={() => openMusic()}>
          <Icon name="external" />
        </button>
      </form>

      {!!s.q?.length && (
        <section className="stack" style={{ gap: ".4em" }}>
          <span className="label">A continuación</span>
          <div className="card" style={{ padding: ".25em", maxHeight: "15em", overflowY: "auto", display: "grid" }}>
            {s.q.map((it) => (
              <button
                key={it.i}
                className="b b-ghost"
                title={`${it.t} · ${it.a}`}
                onClick={() => music("jump", it.i)}
                style={{ display: "grid", justifyContent: "stretch", justifyItems: "start", gap: ".1em", padding: ".45em .6em", textAlign: "left", minWidth: 0, color: "var(--text)" }}
              >
                <span className="ellipsis" style={{ maxWidth: "100%" }}>{it.t}</span>
                <span className="small muted ellipsis" style={{ maxWidth: "100%" }}>{it.a}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
