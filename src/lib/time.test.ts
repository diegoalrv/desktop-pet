import { describe, expect, it } from "vitest";
import { fmt, fmtDur } from "./time";

it("fmt mm:ss", () => {
  expect(fmt(1500)).toBe("25:00");
  expect(fmt(59.2)).toBe("01:00");
  expect(fmt(-3)).toBe("00:00");
  expect(fmt(65)).toBe("01:05");
});

describe("fmtDur", () => {
  it("minutos y horas", () => {
    expect(fmtDur(0)).toBe("0m");
    expect(fmtDur(45 * 60)).toBe("45m");
    expect(fmtDur(125 * 60 + 20)).toBe("2h 05m");
  });
});
