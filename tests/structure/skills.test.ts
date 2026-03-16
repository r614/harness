import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const skillsDir = path.resolve("skills");

describe("skills layout", () => {
  it("keeps one SKILL.md per skill directory", () => {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const entry of entries) {
      expect(fs.existsSync(path.join(skillsDir, entry.name, "SKILL.md"))).toBe(true);
    }
  });

  it("removes repo-operator", () => {
    expect(fs.existsSync(path.join(skillsDir, "repo-operator"))).toBe(false);
  });
});
