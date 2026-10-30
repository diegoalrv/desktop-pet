import { expect, test, vi } from "vitest";
import { frames, scrub } from "./errors";

test("scrub quita el usuario de las rutas", () => {
  expect(scrub("no existe /Users/ana/lab/x.ts")).toBe("no existe ~/lab/x.ts");
  expect(scrub("C:\\Users\\Ana Pérez\\AppData\\x")).toBe("~\\AppData\\x");
  expect(scrub("a".repeat(999))).toHaveLength(300);
});

test("frames de WebKit y de Chromium", () => {
  expect(frames("Error: x\nf@tauri://localhost/assets/a.js:1:20\n@tauri://localhost/assets/a.js:2:3")).toEqual([
    { function: "?", filename: "tauri://localhost/assets/a.js", lineno: 2, colno: 3 },
    { function: "f", filename: "tauri://localhost/assets/a.js", lineno: 1, colno: 20 },
  ]);
  expect(frames("Error: x\n    at g (http://localhost:1420/src/a.ts:10:5)\n    at http://localhost:1420/b.js:3:4")).toEqual([
    { function: "?", filename: "http://localhost:1420/b.js", lineno: 3, colno: 4 },
    { function: "g", filename: "http://localhost:1420/src/a.ts", lineno: 10, colno: 5 },
  ]);
});

const setup = async (prefs: object, answer: boolean) => {
  vi.resetModules();
  const ask = vi.fn(async () => answer);
  const setPrefs = vi.fn();
  vi.doMock("@tauri-apps/plugin-dialog", () => ({ ask }));
  vi.doMock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
  vi.doMock("../store/useSettings", () => ({ useSettings: { getState: () => ({ prefs, setPrefs }) } }));
  const { askErrorReports } = await import("./errors");
  await askErrorReports();
  return { ask, setPrefs };
};

test("pregunta una vez y guarda la respuesta, sin prender nada si dice que no", async () => {
  const { ask, setPrefs } = await setup({ errorReports: false, errorReportsAsked: false }, false);
  expect(ask).toHaveBeenCalledOnce();
  expect(setPrefs).toHaveBeenCalledWith({ errorReports: false, errorReportsAsked: true });
});

test("no vuelve a preguntar, y quien ya lo tenía prendido lo conserva", async () => {
  expect((await setup({ errorReports: false, errorReportsAsked: true }, true)).ask).not.toHaveBeenCalled();
  const on = await setup({ errorReports: true, errorReportsAsked: false }, false);
  expect(on.ask).not.toHaveBeenCalled();
  expect(on.setPrefs).toHaveBeenCalledWith({ errorReports: true, errorReportsAsked: true });
});
