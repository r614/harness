#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cdpPath = join(scriptDir, "cdp.mjs");
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Usage: screenshot.js <target> [file]");
  process.exit(1);
}

const result = spawnSync(process.execPath, [cdpPath, "shot", ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
