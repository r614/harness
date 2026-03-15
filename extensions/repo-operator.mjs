import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_POLICY = {
  allowedPaths: [
    "skills/",
    "extensions/",
    "evals/",
    "fixtures/",
    "manifests/",
    "README.md"
  ],
  requiredChecks: ["npm run validate", "npm run evals"],
  mergePolicy: "human_review_required"
};

async function readPolicy(repoRoot) {
  try {
    const raw = await fs.readFile(path.join(repoRoot, "manifests/policies.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.selfImprovement || DEFAULT_POLICY;
  } catch {
    return DEFAULT_POLICY;
  }
}

function normalizeFile(file) {
  return String(file || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function matchesAllowedPath(file, allowedPaths) {
  return allowedPaths.some((prefix) => file === prefix || file.startsWith(prefix));
}

function classifyRisk(files, explicitRisk = "") {
  if (explicitRisk) {
    return explicitRisk;
  }

  if (files.some((file) => file.startsWith("extensions/") || file.startsWith("manifests/"))) {
    return "medium";
  }

  if (files.some((file) => file.startsWith("skills/") || file === "README.md")) {
    return "low";
  }

  return "low";
}

function buildEvidence(evidence) {
  if (Array.isArray(evidence)) {
    return evidence.map((item) => String(item)).filter(Boolean);
  }

  if (typeof evidence === "string" && evidence.trim()) {
    return [evidence.trim()];
  }

  return [];
}

function buildSummary(input, policy, files, invalidTargets) {
  const evidence = buildEvidence(input.evidence);
  const risk = classifyRisk(files, input.risk);
  const rollback = input.rollback || "Revert the PR or restore the previous version of the touched files.";

  return {
    title: input.title || "Harness self-improvement",
    problemStatement: input.problem || "Unspecified problem statement",
    changedFiles: files,
    evidence,
    riskClassification: risk,
    requiredChecks: policy.requiredChecks,
    rollbackGuidance: rollback,
    mergePolicy: policy.mergePolicy,
    allowed: invalidTargets.length === 0,
    invalidTargets,
    nextStep:
      invalidTargets.length === 0
        ? "Open a PR for human review after required checks pass."
        : "Remove disallowed files from the change set before opening a PR."
  };
}

export function listCapabilities() {
  return [
    "list_allowed_paths",
    "validate_changed_files",
    "prepare_change_summary",
    "validate_repo",
    "open_pr_request"
  ];
}

export async function search(query, config = {}) {
  const policy = await readPolicy(config.repoRoot || process.cwd());
  const haystack = [...policy.allowedPaths, ...policy.requiredChecks, policy.mergePolicy];

  return {
    query,
    matches: haystack.filter((item) => item.includes(query))
  };
}

export async function read(resourceId, config) {
  const filePath = path.join(config.repoRoot, resourceId);
  const content = await fs.readFile(filePath, "utf8");
  return { resourceId, content };
}

export async function prepareAction(input = {}, config = {}) {
  const repoRoot = config.repoRoot || process.cwd();
  const policy = await readPolicy(repoRoot);
  const files = Array.isArray(input.files) ? input.files.map(normalizeFile).filter(Boolean) : [];
  const invalidTargets = files.filter((file) => !matchesAllowedPath(file, policy.allowedPaths));
  const summary = buildSummary(input, policy, files, invalidTargets);

  return {
    type: "pr_request",
    allowed: summary.allowed,
    summary,
    sideEffects: summary.allowed
      ? ["opens a GitHub pull request after human review of the generated diff"]
      : [],
    reversible: true,
    payload: summary
  };
}

export async function executeAction(preparedAction) {
  return {
    status: preparedAction.allowed ? "manual_review_required" : "blocked",
    preparedAction
  };
}

export async function listArtifacts(config = {}) {
  const policy = await readPolicy(config.repoRoot || process.cwd());
  return [
    {
      name: "self-improvement-pr-summary",
      type: "json",
      requiredFields: [
        "problemStatement",
        "changedFiles",
        "evidence",
        "riskClassification",
        "requiredChecks",
        "rollbackGuidance"
      ],
      allowedPaths: policy.allowedPaths
    }
  ];
}
