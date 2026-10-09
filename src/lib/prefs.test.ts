import { describe, expect, it } from "vitest";
import { accelFromEvent, normalizePrefs } from "./prefs";

const ev = (code: string, o: Partial<KeyboardEvent> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...o,
});

describe("prefs", () => {
  it("defaults y saneo", () => {
    expect(normalizePrefs(undefined)).toEqual({
      focusMin: 25,
      shortMin: 5,
      longMin: 15,
      longEvery: 4,
      autoCycle: true,
      sound: true,
      shortcut: "CommandOrControl+Shift+Space",
    });
    const p = normalizePrefs({ focusMin: "50", shortMin: -3, longMin: 9999, sound: "x" });
    expect([p.focusMin, p.shortMin, p.longMin, p.sound]).toEqual([50, 5, 15, true]);
  });
  it("accelFromEvent", () => {
    expect(accelFromEvent(ev("Space", { metaKey: true, shiftKey: true }))).toBe(
      "CommandOrControl+Shift+Space",
    );
    expect(accelFromEvent(ev("KeyK", { ctrlKey: true, altKey: true }))).toBe("CommandOrControl+Alt+K");
    expect(accelFromEvent(ev("Digit1", { altKey: true }))).toBe("Alt+1");
    expect(accelFromEvent(ev("KeyK"))).toBeNull(); // sin modificador
    expect(accelFromEvent(ev("ShiftLeft", { shiftKey: true }))).toBeNull(); // solo modificador
  });
});
