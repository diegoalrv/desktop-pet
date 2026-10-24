import { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { PET_SIZE } from "../lib/prefs";
import { clip } from "../lib/sound";
import { Sheet } from "../pet/Sprite";
import {
  BUILTIN,
  DEFAULT,
  exportSkin,
  importFile,
  importFolder,
  listSkins,
  loadSkin,
  removeSkin,
  revokeSkin,
  type Skin,
} from "../skins/loader";
import { CALLS, DEFAULT_VOICE, type Call } from "../skins/schema";
import { useSettings } from "../store/useSettings";
import { btn, T } from "../panel/ui";
import spritesPrompt from "../../examples/Genera Sprites Pet.md?raw";

const PROMPT_FILE = "Genera Sprites Pet.md";
const CALL_LABEL: Record<Call, string> = {
  growl: "Advertencia (te ve con el teléfono)",
  bark: "Llamado de atención (distracción)",
};
const TILE = 56;

export const sub = { margin: "6px 0 0", fontSize: 12, color: T.dim, fontWeight: 600 } as const;
const small = { ...btn, padding: "2px 8px" } as const;

/** Personaliza tu mascota: elegir/importar/exportar skins, ver sus animaciones y llamados, y cómo crear una propia. */
export function PetSection() {
  const { skin, setSkin, reloadSkin, prefs, setPrefs } = useSettings();
  const [skins, setSkins] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState<Skin>({ kind: "builtin" });
  const [msg, setMsg] = useState("");
  const refresh = useCallback(() => listSkins().then(setSkins), []);
  useEffect(() => void refresh(), [refresh]);

  // Skin activo cargado aquí también, para la vista previa y probar sus sonidos.
  useEffect(() => {
    let cancelled = false;
    let mine: Skin | null = null;
    loadSkin(skin)
      .catch(() => loadSkin(BUILTIN))
      .then((s) => {
        if (cancelled) return revokeSkin(s);
        mine = s;
        setLoaded(s);
      });
    return () => {
      cancelled = true;
      if (mine) revokeSkin(mine);
    };
  }, [skin]);

  const fail = (what: string, e: unknown) => setMsg(`${what}: ${e instanceof Error ? e.message : String(e)}`);

  const run = async (pick: () => Promise<string | null>, imp: (p: string) => Promise<string>) => {
    try {
      const p = await pick();
      if (!p) return;
      const id = await imp(p);
      await refresh();
      await setSkin(id);
      await reloadSkin(); // reimportar el mismo id también refresca en caliente
      setMsg(`Mascota "${id}" importada y aplicada.`);
    } catch (e) {
      fail("No se pudo importar", e);
    }
  };

  const saveAs = async (name: string, ext: string, bytes: () => Promise<Uint8Array>) => {
    try {
      const p = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (!p) return;
      await writeFile(p, await bytes());
      setMsg(`Guardado en ${p}`);
    } catch (e) {
      fail("No se pudo guardar", e);
    }
  };

  const pack = loaded.kind === "pack" ? loaded : null;
  const voice = { ...DEFAULT_VOICE, ...pack?.manifest.voice };

  return (
    <>
      <div style={{ display: "grid", gap: 6 }}>
        {skins.map((s) => (
          <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" name="skin" checked={skin === s.id} onChange={() => setSkin(s.id)} />
              {s.name} <small style={{ color: T.dim }}>{s.id}</small>
            </label>
            {s.id !== BUILTIN && s.id !== DEFAULT && (
              <button
                style={small}
                onClick={async () => {
                  if (skin === s.id) await setSkin(DEFAULT);
                  await removeSkin(s.id);
                  refresh();
                }}
              >
                Quitar
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          style={btn}
          onClick={() => run(async () => (await open({ directory: true })) as string | null, importFolder)}
        >
          Importar carpeta…
        </button>
        <button
          style={btn}
          onClick={() =>
            run(
              async () =>
                (await open({
                  filters: [
                    {
                      name: "Mascota (.zip) o imagen",
                      extensions: ["zip", "png", "webp", "gif", "jpg", "jpeg"],
                    },
                  ],
                })) as string | null,
              importFile,
            )
          }
        >
          Importar .zip / imagen…
        </button>
        {pack && (
          <button style={btn} onClick={() => saveAs(`${skin}.zip`, "zip", () => exportSkin(skin))}>
            Exportar .zip…
          </button>
        )}
      </div>
      {msg && <div style={{ fontSize: 12, color: T.dim, overflowWrap: "anywhere" }}>{msg}</div>}

      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Tamaño en pantalla
        <input
          type="range"
          min={PET_SIZE.min}
          max={PET_SIZE.max}
          step={8}
          value={prefs.petSize}
          onChange={(e) => setPrefs({ petSize: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <span style={{ width: 52, textAlign: "right", color: T.dim }}>{prefs.petSize} px</span>
        {prefs.petSize !== PET_SIZE.def && (
          <button style={small} onClick={() => setPrefs({ petSize: PET_SIZE.def })}>
            Restablecer
          </button>
        )}
      </label>

      <h3 style={sub}>Animaciones</h3>
      {pack ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${TILE + 16}px, 1fr))`,
              gap: 6,
            }}
          >
            {Object.entries(pack.manifest.animations).map(([key, anim]) => {
              const w = Math.round((pack.manifest.frameWidth * TILE) / pack.manifest.frameHeight);
              return (
                <div
                  key={key}
                  title={anim.prompt ?? `${anim.frames} cuadros a ${anim.fps} fps`}
                  style={{
                    display: "grid",
                    justifyItems: "center",
                    gap: 2,
                    padding: 4,
                    borderRadius: 8,
                    background: T.card,
                  }}
                >
                  {anim.frames === 1 ? (
                    <img
                      src={pack.urls[anim.file]}
                      style={{ width: w, height: TILE, objectFit: "contain" }}
                    />
                  ) : (
                    <Sheet
                      id={`pv_${pack.manifest.id}`}
                      animKey={key}
                      anim={{ ...anim, loop: true }} // en la vista previa todas se repiten
                      url={pack.urls[anim.file]}
                      w={w}
                      h={TILE}
                    />
                  )}
                  <small style={{ color: T.dim, fontSize: 11 }}>{key}</small>
                </div>
              );
            })}
          </div>
          {pack.manifest.character && (
            <small style={{ color: T.dim }}>
              <b>Ficha:</b> {pack.manifest.character}
            </small>
          )}
          <small style={{ opacity: 0.7 }}>
            Las que falten usan una parecida (o la de reposo). Pasa el mouse sobre una para ver cómo se
            generó.
          </small>
        </>
      ) : (
        <small style={{ color: T.dim }}>El zorro original se dibuja solo, sin imágenes.</small>
      )}

      <h3 style={sub}>Llamados de atención</h3>
      {CALLS.map((c) => (
        <div key={c} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ flex: 1 }}>
            {CALL_LABEL[c]} <b style={{ color: c === "bark" ? "#e34948" : "#eda100" }}>{voice[c]}</b>{" "}
            <small style={{ color: T.dim }}>
              {pack?.manifest.sounds[c] ? "sonido propio" : "sonido por defecto"}
            </small>
          </span>
          <button
            style={small}
            onClick={() => {
              const stop = clip(c, false, pack ? pack.urls[pack.manifest.sounds[c] ?? ""] : undefined);
              setTimeout(stop, 4000);
            }}
          >
            Probar
          </button>
        </div>
      ))}

      <h3 style={sub}>Crea tu propia mascota</h3>
      <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4, lineHeight: 1.4 }}>
        <li>Arma un set de fotos de tu mascota, al menos 5, de cuerpo entero y desde distintos ángulos.</li>
        <li>
          Entrégaselas a la IA que genere imágenes que prefieras (ChatGPT, Gemini…) junto con este prompt:{" "}
          <button
            style={small}
            onClick={() => saveAs(PROMPT_FILE, "md", async () => new TextEncoder().encode(spritesPrompt))}
          >
            Descargar “{PROMPT_FILE}”
          </button>
        </li>
        <li>
          Eso debería entregarte un .zip con las imágenes de tu mascota, listo para cargar con “Importar
          .zip”.
        </li>
      </ol>
      <small style={{ opacity: 0.7 }}>
        Si quieres que suene propia (un maullido en vez de ladrido), el final del prompt explica cómo
        agregarle sonidos al .zip.
      </small>
    </>
  );
}
