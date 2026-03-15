import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareAction } from "../extensions/repo-operator.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function getArgValues(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function getArg(argv, flag) {
  return getArgValues(argv, flag)[0] || "";
}

function parseList(values) {
  return values
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  return {
    title: getArg(argv, "--title") || "Harness self-improvement",
    problem: getArg(argv, "--problem") || "Unspecified problem statement",
    evidence: parseList(getArgValues(argv, "--evidence")),
    files: parseList(getArgValues(argv, "--files")),
    risk: getArg(argv, "--risk") || "",
    rollback:
      getArg(argv, "--rollback") ||
      "Revert the PR or restore the previous version of the touched files."
  };
}

export async function getChangedFiles(repoRoot = process.cwd()) {
  const gitDir = path.join(repoRoot, ".git");
  try {
    await fs.access(gitDir);
  } catch {
    return [];
  }

  const { execFile } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["status", "--short"],
      { cwd: repoRoot },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        const files = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.slice(3).trim())
          .map((file) => file.replace(/\\/g, "/"));

        resolve(files);
      }
    );
  });
}

export async function buildPrPayload(options = {}, runtime = {}) {
  const repoRoot = runtime.repoRoot || process.cwd();
  const files = options.files?.length ? options.files : await getChangedFiles(repoRoot);
  const evidence = options.evidence?.length
    ? options.evidence
    : ["Attach command output or eval references before opening the PR."];

  const prepared = await prepareAction(
    {
      title: options.title,
      problem: options.problem,
      files,
      evidence,
      risk: options.risk,
      rollback: options.rollback
    },
    { repoRoot }
  );

  return prepared.payload;
}

export async function writePrPayload(payload, outPath = path.resolve("tmp/self-improvement-pr.json")) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return outPath;
}

async function main() {
  const options = parseCliArgs();
  const payload = await buildPrPayload(options, { repoRoot: ROOT });
  const outPath = await writePrPayload(payload);

  console.log(`Prepared structured PR payload at ${outPath}`);
  console.log(`Allowed: ${payload.allowed ? "yes" : "no"}`);
  console.log(`Changed files: ${payload.changedFiles.length}`);
  console.log(`Risk: ${payload.riskClassification}`);

  if (!payload.allowed) {
    console.error(`Blocked by disallowed paths: ${payload.invalidTargets.join(", ")}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
