import { describe, expect, it } from "vitest";
import {
  normalizeZipPaths,
  parseManifest,
  pickAnim,
  resolveAnim,
  singleImageManifest,
  slug,
  topInset,
} from "./schema";

const a = (file: string, frames = 4) => ({ file, frames, fps: 8, loop: true });
const base = {
  id: "zorro-default",
  name: "Zorro",
  frameWidth: 128,
  frameHeight: 128,
  animations: { idle: a("idle.png", 6), walk: a("walk.png", 8) },
};

describe("manifest", () => {
  it("aplica defaults", () => {
    const m = parseManifest(base);
    expect(m.scale).toBe(1);
    expect(m.walkSpeed).toBe(40);
    expect(m.groundOffset).toBe(0);
  });
  it("exige idle", () => {
    expect(() => parseManifest({ ...base, animations: { walk: a("walk.png") } })).toThrow();
  });
  it("rechaza ids y archivos peligrosos", () => {
    expect(() => parseManifest({ ...base, id: "../x" })).toThrow();
    expect(() => parseManifest({ ...base, animations: { idle: a("../evil.png") } })).toThrow();
    expect(() => parseManifest({ ...base, animations: { idle: a("a/b.png") } })).toThrow();
    expect(() => parseManifest({ ...base, frameWidth: 0 })).toThrow();
  });
  it("resolveAnim: respaldo a idle y mapeos", () => {
    const m = parseManifest(base);
    expect(resolveAnim(m, "walk").key).toBe("walk");
    expect(resolveAnim(m, "sleep").key).toBe("idle");
    expect(resolveAnim(m, "fall").key).toBe("idle"); // sin "dragged" -> idle
    expect(resolveAnim(m, "break").key).toBe("idle");
  });
  it("imagen única: todas las animaciones, 1 frame, escala a 128", () => {
    const m = singleImageManifest("img-a", "A", "sprite.png", 512, 256);
    expect(Object.keys(m.animations)).toHaveLength(6);
    expect(m.animations.celebrate.frames).toBe(1);
    expect(m.scale).toBe(0.25);
  });
  it("slug y rutas de zip", () => {
    expect(slug("Mi Gato (1).PNG")).toBe("mi-gato-1");
    const f = {
      "pack/manifest.json": new Uint8Array(),
      "pack/idle.png": new Uint8Array(),
      "__MACOSX/pack/._x": new Uint8Array(),
      "pack/": new Uint8Array(),
    };
    expect(Object.keys(normalizeZipPaths(f)).sort()).toEqual(["idle.png", "manifest.json"]);
    expect(Object.keys(normalizeZipPaths({ "a.png": new Uint8Array() }))).toEqual(["a.png"]);
  });
});

describe("skins de ejemplo", () => {
  for (const dir of ["slime-demo", "tortu", "candolita"]) {
    it(`${dir}: manifest válido y archivos presentes`, async () => {
      const { readFileSync, existsSync } = await import("node:fs");
      const root = `examples/${dir}`;
      const m = parseManifest(JSON.parse(readFileSync(`${root}/manifest.json`, "utf8")));
      for (const a of Object.values(m.animations)) expect(existsSync(`${root}/${a.file}`)).toBe(true);
    });
  }
});

describe("ánimos", () => {
  const one = { file: "x.png", frames: 1, fps: 8, loop: true };
  const m = parseManifest({
    id: "t",
    name: "t",
    frameWidth: 8,
    frameHeight: 8,
    animations: { idle: one, focus: one, read: one, guitar: one, maracas: one },
  });
  it("alterna variantes que el skin trae y omite las que no", () => {
    expect([0, 1, 2].map((i) => pickAnim(m, "focus", false, i).key)).toEqual(["focus", "read", "focus"]);
  });
  it("con música rockea; sin variantes cae a la animación base", () => {
    expect([0, 1].map((i) => pickAnim(m, "idle", true, i).key)).toEqual(["guitar", "maracas"]);
    expect(pickAnim(m, "walk", true, 0).key).toBe("idle"); // walk no existe -> idle
  });
  it("topInset: filas vacías arriba", () => {
    const px = new Uint8ClampedArray(2 * 4 * 4);
    px[(2 * 2 + 1) * 4 + 3] = 255; // fila 2
    expect(topInset(px, 2, 4)).toBe(0.5);
  });
});
