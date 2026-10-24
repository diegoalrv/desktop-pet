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
import { normalizeZipPaths, parseManifest, singleImageManifest, slug, type Manifest } from "./schema";
import candolitaManifest from "../../examples/candolita/manifest.json";

const base = { baseDir: BaseDirectory.AppData };
const IMG = /\.(png|webp|gif|jpe?g)$/i;
const AUDIO_MIME: Record<string, string> = { m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg" };

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
export type Skin = { kind: "builtin" } | { kind: "pack"; manifest: Manifest; urls: Record<string, string> };

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
  if (id === DEFAULT) {
    out["manifest.json"] = new TextEncoder().encode(JSON.stringify(candolitaManifest, null, 2));
    for (const [f, url] of Object.entries(candolitaUrls))
      out[f] = new Uint8Array(await (await fetch(url)).arrayBuffer());
  } else {
    const m = await readManifest(id);
    for (const f of ["manifest.json", ...filesOf(m)]) out[f] = await readFile(`skins/${id}/${f}`, base);
  }
  return zipSync({ [id]: out }); // carpeta raíz: normalizeZipPaths la quita al importar
}

/** Carga un skin; las imágenes pasan a blob URLs (sin configurar asset protocol/CSP). */
export async function loadSkin(id: string): Promise<Skin> {
  if (id === BUILTIN) return { kind: "builtin" };
  if (id === DEFAULT)
    return { kind: "pack", manifest: parseManifest(candolitaManifest), urls: candolitaUrls };
  const manifest = await readManifest(id);
  const urls: Record<string, string> = {};
  for (const f of filesOf(manifest)) {
    const type = AUDIO_MIME[f.split(".").pop()!.toLowerCase()] ?? ""; // WebKit no reproduce audio de un blob sin tipo
    urls[f] = URL.createObjectURL(new Blob([await readFile(`skins/${id}/${f}`, base)], { type }));
  }
  return { kind: "pack", manifest, urls };
}

export const revokeSkin = (s: Skin) =>
  s.kind === "pack" && s.urls !== candolitaUrls && Object.values(s.urls).forEach(URL.revokeObjectURL);

export const removeSkin = (id: string) => remove(`skins/${id}`, { ...base, recursive: true });

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
