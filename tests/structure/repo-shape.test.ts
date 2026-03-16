import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("repo shape", () => {
  it("does not keep legacy top-level directories", () => {
    expect(fs.existsSync(path.resolve("evals"))).toBe(false);
    expect(fs.existsSync(path.resolve("fixtures"))).toBe(false);
    expect(fs.existsSync(path.resolve("manifests"))).toBe(false);
    expect(fs.existsSync(path.resolve("vendor", "agent-stuff"))).toBe(false);
  });
});
