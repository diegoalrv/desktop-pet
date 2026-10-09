import { describe, expect, it } from "vitest";
import { fallStep, groundY, walkStep } from "./physics";

describe("physics", () => {
  it("groundY apoya la ventana en el borde inferior", () => {
    expect(groundY({ x: 0, y: 25, w: 1000, h: 700 }, 180)).toBe(545);
  });
  it("walkStep avanza y llega sin pasarse", () => {
    expect(walkStep(0, 100, 40, 1)).toEqual({ x: 40, dir: 1, arrived: false });
    expect(walkStep(90, 100, 40, 1)).toEqual({ x: 100, dir: 1, arrived: true });
    expect(walkStep(100, 0, 40, 1).dir).toBe(-1);
  });
  it("fallStep acelera y aterriza en el piso", () => {
    let s = { y: 0, vy: 0, landed: false };
    for (let i = 0; i < 200 && !s.landed; i++) s = fallStep(s.y, s.vy, 1 / 60, 500, 2000);
    expect(s).toEqual({ y: 500, vy: 0, landed: true });
  });
});
