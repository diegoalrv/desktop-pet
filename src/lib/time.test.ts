import { expect, it } from "vitest";
import { fmt } from "./time";

it("fmt mm:ss", () => {
  expect(fmt(1500)).toBe("25:00");
  expect(fmt(59.2)).toBe("01:00");
  expect(fmt(-3)).toBe("00:00");
  expect(fmt(65)).toBe("01:05");
});
