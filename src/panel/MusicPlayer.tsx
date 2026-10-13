import { useState } from "react";
import { fmt } from "../lib/time";
import { music, openMusic, useMusic } from "../store/useMusic";
import { btn } from "./ui";

const round = { ...btn, width: 44, height: 44, padding: 0, borderRadius: 22, fontSize: 18 } as const;

export function MusicPlayer() {
  const s = useMusic((m) => m.s);
  const [q, setQ] = useState("");
  // Mientras se arrastra un slider se muestra el valor local, no el que llega de la web.
  const [seek, setSeek] = useState<number | null>(null);
  const [vol, setVol] = useState<number | null>(null);

  if (!s)
    return (
      <div style={{ display: "grid", gap: 10, justifyItems: "center", paddingTop: 30, color: "#666" }}>
        <div style={{ fontSize: 40 }}>♫</div>
        <div>YouTube Music no está abierto.</div>
        <button style={btn} onClick={() => openMusic()}>
          Abrir YouTube Music
        </button>
        <small>La primera vez inicia sesión en la ventana que se abre.</small>
      </div>
    );

  const search = () => {
    if (!q.trim()) return;
    music("search", q.trim());
    openMusic();
    setQ("");
  };

  return (
    // minWidth 0: sin esto un título largo ensancha la columna del grid del panel.
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {s.art ? (
          <img src={s.art} width={72} height={72} style={{ borderRadius: 8, objectFit: "cover" }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: 8, background: "#eee", display: "grid", placeItems: "center", fontSize: 28 }}>♫</div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.title || "Nada sonando"}
          </div>
          <div style={{ color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.artist}</div>
        </div>
      </div>

      <div>
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
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888" }}>
          <span>{fmt(seek ?? s.t)}</span>
          <span>{fmt(s.d)}</span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 14 }}>
        <button style={round} aria-label="Anterior" onClick={() => music("prev")}>⏮</button>
        <button style={{ ...round, background: "#222", color: "#fff" }} aria-label={s.playing ? "Pausar" : "Reproducir"} onClick={() => music("toggle")}>
          {s.playing ? "⏸" : "▶"}
        </button>
        <button style={round} aria-label="Siguiente" onClick={() => music("next")}>⏭</button>
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span aria-hidden>🔈</span>
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
          style={{ flex: 1 }}
        />
        <span aria-hidden>🔊</span>
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Buscar canción, artista…"
          style={{ ...btn, flex: 1, cursor: "text" }}
        />
        <button style={btn} onClick={search}>Buscar</button>
      </div>
      <button style={{ ...btn, color: "#666" }} onClick={() => openMusic()}>
        Mostrar YouTube Music
      </button>
    </div>
  );
}
