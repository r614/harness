import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));

describe("package metadata", () => {
  it("uses directory-based pi metadata", () => {
    expect(pkg.pi.extensions).toEqual(["./extensions"]);
    expect(pkg.pi.skills).toEqual(["./skills"]);
    expect(pkg.pi.themes).toEqual(["./themes"]);
  });

  it("does not publish deleted legacy directories", () => {
    expect(pkg.files).not.toContain("fixtures/");
    expect(pkg.files).not.toContain("manifests/");
    expect(pkg.files).not.toContain("vendor/");
  });

  it("uses vitest as the primary validation flow", () => {
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.evals).toBeUndefined();
    expect(pkg.scripts["self-improve"]).toBeUndefined();
  });
});
