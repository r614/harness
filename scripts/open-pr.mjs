import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

function getArg(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

const title = getArg("--title") || "Harness self-improvement";
const problem = getArg("--problem") || "Unspecified problem statement";
const evidence = getArg("--evidence") || "Attach eval or run evidence before opening the PR.";
const risk = getArg("--risk") || "low";
const rollback = getArg("--rollback") || "Revert the PR.";

const output = {
  title,
  problem,
  evidence,
  risk,
  rollback,
  requiredChecks: ["npm run validate", "npm run evals"],
  allowedPaths: [
    "skills/",
    "extensions/",
    "commands/",
    "evals/",
    "fixtures/",
    "manifests/",
    "README.md"
  ]
};

const outPath = path.resolve("tmp/self-improvement-pr.json");
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(`Prepared PR payload at ${outPath}`);
