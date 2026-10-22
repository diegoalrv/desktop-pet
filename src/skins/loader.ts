import { unzipSync } from "fflate";
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

/** Carga un skin; las imágenes pasan a blob URLs (sin configurar asset protocol/CSP). */
export async function loadSkin(id: string): Promise<Skin> {
  if (id === BUILTIN) return { kind: "builtin" };
  if (id === DEFAULT)
    return { kind: "pack", manifest: parseManifest(candolitaManifest), urls: candolitaUrls };
  const manifest = await readManifest(id);
  const urls: Record<string, string> = {};
  for (const f of new Set(Object.values(manifest.animations).map((a) => a.file))) {
    urls[f] = URL.createObjectURL(new Blob([await readFile(`skins/${id}/${f}`, base)]));
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
    for (const a of Object.values(manifest.animations)) {
      if (!files[a.file]) throw new Error(`Falta el archivo ${a.file}`);
      out[a.file] = files[a.file];
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
