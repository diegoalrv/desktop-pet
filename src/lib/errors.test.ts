import { expect, test } from "vitest";
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
