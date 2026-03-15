import fs from "node:fs/promises";
import path from "node:path";

const ALLOWED_PREFIXES = [
  "skills/",
  "extensions/",
  "commands/",
  "evals/",
  "fixtures/",
  "manifests/",
  "README.md"
];

export function listCapabilities() {
  return [
    "list_allowed_paths",
    "prepare_change_summary",
    "validate_repo",
    "open_pr_request"
  ];
}

export async function search(query) {
  return {
    query,
    matches: ALLOWED_PREFIXES.filter((item) => item.includes(query))
  };
}

export async function read(resourceId, config) {
  const filePath = path.join(config.repoRoot, resourceId);
  const content = await fs.readFile(filePath, "utf8");
  return { resourceId, content };
}

export async function prepareAction(input) {
  const invalidTargets = input.files.filter(
    (file) => !ALLOWED_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix))
  );

  if (invalidTargets.length > 0) {
    return {
      type: "pr_request",
      allowed: false,
      invalidTargets,
      summary: "PR request rejected because it touches disallowed paths."
    };
  }

  return {
    type: "pr_request",
    allowed: true,
    summary: input.title,
    sideEffects: ["opens a GitHub pull request after human review of the generated diff"],
    reversible: true,
    payload: input
  };
}

export async function executeAction(preparedAction) {
  return {
    status: "manual_review_required",
    preparedAction
  };
}

export async function listArtifacts() {
  return [];
}
