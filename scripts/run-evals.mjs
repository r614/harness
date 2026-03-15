import fs from "node:fs/promises";
import path from "node:path";

const evalsDir = path.resolve("evals");
const entries = await fs.readdir(evalsDir, { withFileTypes: true }).catch(() => []);

const suites = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

console.log("Harness evals");
for (const suite of suites) {
  console.log(`- ${suite}: placeholder pass`);
}

if (suites.length === 0) {
  console.log("- no eval suites found");
}
