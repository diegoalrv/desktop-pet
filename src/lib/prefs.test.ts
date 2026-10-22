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
      trayTimer: true,
      sound: true,
      shortcut: "CommandOrControl+Shift+Space",
      focusShortcut: "CommandOrControl+Shift+F",
      icalUrl: "",
      llms: [{ provider: "claude-code", apikey: "", models: ["sonnet"] }],
      claudeCwd: "",
      petSize: 128,
    });
    const p = normalizePrefs({ focusMin: "50", shortMin: -3, longMin: 9999, sound: "x" });
    expect([p.focusMin, p.shortMin, p.longMin, p.sound]).toEqual([50, 5, 15, true]);
    expect([normalizePrefs({ petSize: "200" }).petSize, normalizePrefs({ petSize: 9000 }).petSize]).toEqual([
      200, 128,
    ]);
  });
  it("llms: migra las prefs viejas y descarta listas inválidas", () => {
    const viejo = { llmUrl: "https://x.dev/v1", llmModel: "m1", llmKey: "k" };
    expect(normalizePrefs(viejo).llms).toEqual([
      { provider: "claude-code", apikey: "", models: ["sonnet"] },
      { provider: "https://x.dev/v1", apikey: "k", models: ["m1"] },
    ]);
    const gemini = { ...viejo, llmUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" };
    expect(normalizePrefs(gemini).llms[1].provider).toBe("gemini");
    expect(normalizePrefs({ llms: [{ provider: "gemini", models: [] }] }).llms).toEqual([
      { provider: "claude-code", apikey: "", models: ["sonnet"] },
    ]);
    // ya lo tiene: no se duplica ni se reordena
    const mio = [
      { provider: "gemini", apikey: "k", models: ["g"] },
      { provider: "claude-code", apikey: "", models: ["opus"] },
    ];
    expect(normalizePrefs({ llms: mio }).llms).toEqual(mio);
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
