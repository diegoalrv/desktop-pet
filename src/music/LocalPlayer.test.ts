import { expect, test } from "vitest";
import { parse } from "./LocalPlayer";

test("parse: artista y título del nombre de archivo, o la carpeta como artista", () => {
  expect(parse("/m/Rock/Soda Stereo - De música ligera.mp3")).toEqual({
    artist: "Soda Stereo",
    title: "De música ligera",
  });
  expect(parse("/m/Kind of Blue/01 - So What.flac")).toEqual({ artist: "Kind of Blue", title: "So What" });
  expect(parse("C:\\m\\Lofi\\rain.m4a")).toEqual({ artist: "Lofi", title: "rain" });
});
