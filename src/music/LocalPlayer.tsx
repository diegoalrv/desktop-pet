import { useEffect, useRef, useState } from "react";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { useSettings } from "../store/useSettings";
import { PN_CSS } from "../panel/ui";

// Reproductor local: la ventana "music" carga la app cuando el proveedor es "local" (music.rs). El panel lo maneja
// igual que a YouTube Music: music_bridge.js publica el estado y llama a los mediaSession handlers y a __petLocal.
const AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|opus|aiff?)$/i;
// Sin tipo, WebKit no reproduce el Blob.
const MIME: Record<string, string> = { mp3: "mpeg", m4a: "mp4", aif: "aiff", opus: "ogg" };
const mime = (p: string) => {
  const ext = p.split(".").pop()!.toLowerCase();
  return `audio/${MIME[ext] ?? ext}`;
};

async function walk(dir: string, depth = 4): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readDir(dir).catch(() => [])) {
    if (e.name.startsWith(".")) continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory && depth) out.push(...(await walk(p, depth - 1)));
    else if (e.isFile && AUDIO.test(e.name)) out.push(p);
  }
  return out;
}

/** "Artista - Título.mp3" → { artist, title }; si no (o es "01 - Título"), el artista es la carpeta. */
export function parse(path: string) {
  const parts = path.split(/[\\/]/);
  const name = parts.pop()!.replace(/\.[^.]+$/, "");
  const folder = parts.pop() ?? "";
  const [a, ...t] = name.split(" - ");
  if (!t.length) return { title: name, artist: folder };
  return /^\d+$/.test(a) ? { title: t.join(" - "), artist: folder } : { title: t.join(" - "), artist: a };
}

// Blobs del tema actual y del siguiente. El siguiente se lee mientras suena el actual: con la ventana oculta y sin
// audio, WebKit congela la página y un readFile al terminar el tema no vuelve hasta que la ventana se muestra.
// ponytail: archivo entero por IPC; si los FLAC grandes tardan, protocolo asset con streaming.
const blobs = new Map<string, Promise<string>>();
const load = (p: string) => {
  let u = blobs.get(p);
  if (!u) {
    u = readFile(p).then((b) => URL.createObjectURL(new Blob([b], { type: mime(p) })));
    u.catch(() => blobs.delete(p));
    blobs.set(p, u);
  }
  return u;
};
const keep = (...ps: string[]) => {
  for (const [p, u] of blobs)
    if (!ps.includes(p)) {
      blobs.delete(p);
      u.then(URL.revokeObjectURL, () => {});
    }
};

export function LocalPlayer() {
  const folder = useSettings((s) => s.prefs.musicFolder);
  const [all, setAll] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [cur, setCur] = useState("");
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    setAll([]);
    if (folder) walk(folder).then((l) => setAll(l.sort((a, b) => a.localeCompare(b))));
  }, [folder]);

  const match = (s: string) => all.filter((p) => p.toLowerCase().includes(s.toLowerCase()));
  const list = q ? match(q) : all; // la búsqueda es la lista de reproducción

  const play = async (p: string) => {
    const a = audio.current!;
    a.src = await load(p);
    setCur(p);
    navigator.mediaSession.metadata = new MediaMetadata(parse(p));
    await a.play();
    const { list } = st.current;
    const next = list[(list.indexOf(p) + 1) % list.length];
    keep(p, next);
    if (next) void load(next);
  };

  // Los handlers se registran una vez y leen siempre lo último.
  const st = useRef({ list, cur, play, match, setQ });
  st.current = { list, cur, play, match, setQ };
  useEffect(() => {
    const a = audio.current!;
    const step = (d: number) => {
      const { list, cur, play } = st.current;
      if (!list.length) return;
      const i = list.indexOf(cur);
      void play(list[i < 0 ? 0 : (i + d + list.length) % list.length]);
    };
    const ms = navigator.mediaSession;
    ms.setActionHandler("nexttrack", () => step(1));
    ms.setActionHandler("previoustrack", () => (a.currentTime > 3 ? (a.currentTime = 0) : step(-1)));
    ms.setActionHandler("play", () => (a.src ? void a.play() : step(1)));
    ms.setActionHandler("pause", () => a.pause());
    a.onended = () => step(1);
    Object.assign(window, {
      __petLocal: {
        queue: () => {
          const { list, cur } = st.current;
          const i = list.indexOf(cur);
          return list
            .slice(i + 1, i + 13)
            .map((p, k) => ({ t: parse(p).title, a: parse(p).artist, i: i + 1 + k }));
        },
        jump: (i: number) => st.current.list[i] && void st.current.play(st.current.list[i]),
        search: (s: string) => {
          const m = st.current.match(s);
          st.current.setQ(s);
          if (m[0]) void st.current.play(m[0]);
        },
      },
    });
  }, []);

  return (
    <div className="pn" style={{ display: "block", overflowY: "auto", padding: "1em" }}>
      <style>{PN_CSS}</style>
      <div className="stack" style={{ gap: ".8em" }}>
        <b>Música local</b>
        <span className="small muted ellipsis" title={folder}>
          {folder || "Elige una carpeta en la pestaña Música del panel."}
        </span>
        <audio ref={audio} controls style={{ width: "100%" }} />
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…" />
        <div className="card" style={{ padding: ".25em", display: "grid" }}>
          {list.map((p) => (
            <button
              key={p}
              className="b b-ghost"
              onClick={() => play(p)}
              style={{
                justifyContent: "start",
                textAlign: "left",
                color: p === cur ? "var(--accent)" : "var(--text)",
              }}
            >
              <span className="ellipsis">
                {parse(p).title} <span className="small muted">· {parse(p).artist}</span>
              </span>
            </button>
          ))}
          {!list.length && (
            <span className="small muted" style={{ padding: ".6em" }}>
              Sin canciones.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
