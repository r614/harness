#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cdpPath = join(scriptDir, "cdp.mjs");
const [target, ...exprParts] = process.argv.slice(2);

if (!target || exprParts.length === 0) {
  console.log("Usage: eval.js <target> <expression>");
  process.exit(1);
}

const result = spawnSync(process.execPath, [cdpPath, "eval", target, exprParts.join(" ")], { stdio: "inherit" });
process.exit(result.status ?? 1);
