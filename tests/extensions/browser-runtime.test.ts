import { describe, expect, it } from "vitest";
import { isRiskyTarget } from "../../scripts/browser-runtime.mjs";

describe("browser runtime helpers", () => {
  it("treats side-effectful targets as risky", () => {
    expect(isRiskyTarget({ role: "button", text: "Submit" })).toBe(true);
    expect(isRiskyTarget({ role: "link", href: "javascript:void(0)" })).toBe(true);
    expect(isRiskyTarget({ role: "link", href: "https://example.com", text: "Docs" })).toBe(false);
  });
});
