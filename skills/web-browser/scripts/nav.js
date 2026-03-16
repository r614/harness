#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cdpPath = join(scriptDir, "cdp.mjs");
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Usage: nav.js <target> <url>");
  console.log("       nav.js --new <url>");
  process.exit(1);
}

const mapped = args[0] === "--new" ? ["open", args[1] || "about:blank"] : ["nav", ...args];
const result = spawnSync(process.execPath, [cdpPath, ...mapped], { stdio: "inherit" });
process.exit(result.status ?? 1);
