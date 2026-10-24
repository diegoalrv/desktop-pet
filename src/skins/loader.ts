import { unzipSync, zipSync } from "fflate";
import { join } from "@tauri-apps/api/path";
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
} from "@tauri-apps/plugin-fs";
import {
  CALLS,
  normalizeZipPaths,
  parseManifest,
  singleImageManifest,
  slug,
  type Call,
  type Manifest,
} from "./schema";
import candolitaManifest from "../../examples/candolita/manifest.json";

const base = { baseDir: BaseDirectory.AppData };
const IMG = /\.(png|webp|gif|jpe?g)$/i;
const AUDIO = /\.(m4a|mp3|wav|ogg)$/i;
const AUDIO_MIME: Record<string, string> = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};
const MAX_SOUND_MB = 5;
/** WebKit no reproduce audio de un blob sin tipo; a las imágenes no les hace falta. */
const blobUrl = (bytes: Uint8Array, name: string) =>
  URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: AUDIO_MIME[name.split(".").pop()!.toLowerCase()] ?? "" }),
  );

export const BUILTIN = "zorro-default";
/** Skin por defecto, empaquetada con la app (examples/candolita). */
export const DEFAULT = "candolita";
const candolitaUrls = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../examples/candolita/*.png", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => [path.split("/").pop()!, url]),
);
/** URL de cada llamado: el sonido que cargó el usuario, si no el del pack; sin ninguno suena el de public/sounds. */
export type Sounds = Partial<Record<Call, string>>;
export type Skin =
  | { kind: "builtin"; sounds: Sounds }
  | { kind: "pack"; manifest: Manifest; urls: Record<string, string>; sounds: Sounds };

export async function listSkins(): Promise<{ id: string; name: string }[]> {
  const out = [
    { id: DEFAULT, name: candolitaManifest.name },
    { id: BUILTIN, name: "Zorro (original)" },
  ];
  if (!(await exists("skins", base))) return out;
  for (const e of await readDir("skins", base)) {
    try {
      const m = await readManifest(e.name);
      if (m.id !== DEFAULT) out.push({ id: m.id, name: m.name });
    } catch {
      /* skin inválido: se ignora */
    }
  }
  return out;
}

const readManifest = async (id: string) =>
  parseManifest(JSON.parse(await readTextFile(`skins/${id}/manifest.json`, base)));

/** Imágenes y sonidos que usa un manifest. */
const filesOf = (m: Manifest) =>
  new Set([...Object.values(m.animations).map((a) => a.file), ...Object.values(m.sounds)]);

/** Solo el manifest (sin cargar imágenes); null para el zorro integrado. */
export async function loadManifest(id: string): Promise<Manifest | null> {
  if (id === BUILTIN) return null;
  return id === DEFAULT ? parseManifest(candolitaManifest) : readManifest(id);
}

/** El skin como .zip listo para compartir e importar en otro equipo. */
export async function exportSkin(id: string): Promise<Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  let m: Manifest;
  if (id === DEFAULT) {
    m = parseManifest(candolitaManifest);
    for (const [f, url] of Object.entries(candolitaUrls))
      out[f] = new Uint8Array(await (await fetch(url)).arrayBuffer());
  } else {
    m = await readManifest(id);
    for (const f of filesOf(m)) out[f] = await readFile(`skins/${id}/${f}`, base);
  }
  // Los sonidos cargados desde Ajustes viajan dentro del pack.
  for (const [c, f] of Object.entries(await soundOverrides(id))) {
    out[`sound-${f}`] = await readFile(`sounds/${id}/${f}`, base);
    m.sounds[c as Call] = `sound-${f}`;
  }
  out["manifest.json"] = new TextEncoder().encode(JSON.stringify(m, null, 2));
  return zipSync({ [id]: out }); // carpeta raíz: normalizeZipPaths la quita al importar
}

/** Sonidos que el usuario cargó desde Ajustes, por mascota: `sounds/<id>/<llamado>.<ext>` (archivo por llamado). */
export async function soundOverrides(id: string): Promise<Sounds> {
  const dir = `sounds/${id}`;
  if (!(await exists(dir, base))) return {};
  const out: Sounds = {};
  for (const e of await readDir(dir, base)) {
    const call = e.name.replace(/\.[^.]+$/, "") as Call;
    if (CALLS.includes(call) && AUDIO.test(e.name)) out[call] = e.name;
  }
  return out;
}

/** Copia un audio elegido por el usuario como sonido de un llamado de esa mascota (reemplaza el anterior). */
export async function setSkinSound(id: string, call: Call, path: string) {
  const ext = path.match(AUDIO)?.[0].toLowerCase();
  if (!ext) throw new Error("Usa un audio .m4a, .mp3, .wav u .ogg");
  const bytes = await readFile(path);
  if (bytes.length > MAX_SOUND_MB * 1024 * 1024)
    throw new Error(`El audio pesa más de ${MAX_SOUND_MB} MB; usa uno más corto`);
  await clearSkinSound(id, call);
  await mkdir(`sounds/${id}`, { ...base, recursive: true });
  await writeFile(`sounds/${id}/${call}${ext}`, bytes, base);
}

export async function clearSkinSound(id: string, call: Call) {
  const old = (await soundOverrides(id))[call];
  if (old) await remove(`sounds/${id}/${old}`, base);
}

/** Carga un skin; las imágenes pasan a blob URLs (sin configurar asset protocol/CSP). */
export async function loadSkin(id: string): Promise<Skin> {
  const sounds: Sounds = {};
  for (const [c, f] of Object.entries(await soundOverrides(id)))
    sounds[c as Call] = blobUrl(await readFile(`sounds/${id}/${f}`, base), f);
  if (id === BUILTIN) return { kind: "builtin", sounds };
  const manifest = id === DEFAULT ? parseManifest(candolitaManifest) : await readManifest(id);
  const urls: Record<string, string> = id === DEFAULT ? candolitaUrls : {};
  if (id !== DEFAULT)
    for (const f of filesOf(manifest)) urls[f] = blobUrl(await readFile(`skins/${id}/${f}`, base), f);
  for (const c of CALLS) sounds[c] ??= urls[manifest.sounds[c] ?? ""];
  return { kind: "pack", manifest, urls, sounds };
}

export const revokeSkin = (s: Skin) => {
  Object.values(s.sounds).forEach(URL.revokeObjectURL); // las del pack se revocan de nuevo abajo: no pasa nada
  if (s.kind === "pack" && s.urls !== candolitaUrls) Object.values(s.urls).forEach(URL.revokeObjectURL);
};

export async function removeSkin(id: string) {
  for (const dir of [`skins/${id}`, `sounds/${id}`])
    if (await exists(dir, base)) await remove(dir, { ...base, recursive: true });
}

/** Instala un pack (manifest.json + imágenes) o, si solo hay una imagen, genera el pack. Devuelve el id. */
export async function installFiles(files: Record<string, Uint8Array>): Promise<string> {
  let manifest: Manifest;
  let out: Record<string, Uint8Array>;
  const raw = files["manifest.json"];
  if (raw) {
    manifest = parseManifest(JSON.parse(new TextDecoder().decode(raw)));
    out = { "manifest.json": raw };
    for (const f of filesOf(manifest)) {
      if (!files[f]) throw new Error(`Falta el archivo ${f}`);
      out[f] = files[f];
    }
  } else {
    const img = Object.keys(files).find((n) => IMG.test(n));
    if (!img) throw new Error("No se encontró manifest.json ni una imagen");
    const bmp = await createImageBitmap(new Blob([files[img] as BlobPart]));
    const ext = img.match(IMG)![0].toLowerCase();
    manifest = singleImageManifest(`img-${slug(img)}`, slug(img), `sprite${ext}`, bmp.width, bmp.height);
    out = {
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      [`sprite${ext}`]: files[img],
    };
  }
  const dir = `skins/${manifest.id}`;
  await mkdir(dir, { ...base, recursive: true });
  for (const [name, bytes] of Object.entries(out)) await writeFile(`${dir}/${name}`, bytes, base);
  return manifest.id;
}

/** Carpeta del usuario (con manifest.json o con una sola imagen). */
export async function importFolder(path: string) {
  const files: Record<string, Uint8Array> = {};
  for (const e of await readDir(path)) {
    if (e.isFile && !e.name.startsWith(".")) files[e.name] = await readFile(await join(path, e.name));
  }
  return installFiles(files);
}

/** .zip o imagen suelta. */
export async function importFile(path: string) {
  const bytes = await readFile(path);
  if (/\.zip$/i.test(path)) return installFiles(normalizeZipPaths(unzipSync(bytes)));
  return installFiles({ [path.split(/[\\/]/).pop()!]: bytes });
}
