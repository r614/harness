import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function readPolicy() {
  const raw = await readFile(join(ROOT, "manifests/policies.json"), "utf8");
  return JSON.parse(raw).selfImprovement;
}

function buildTemplate(policy: {
  allowedPaths: string[];
  requiredChecks: string[];
  mergePolicy: string;
}) {
  return {
    title: "Short change title",
    problemStatement: "One sentence describing the workflow gap you fixed.",
    changedFiles: ["extensions/repo-operator.mjs", "evals/self-improvement/README.md"],
    evidence: ["npm run validate", "npm run evals"],
    riskClassification: "low",
    requiredChecks: policy.requiredChecks,
    rollbackGuidance: "Revert the PR or restore the touched files.",
    mergePolicy: policy.mergePolicy,
    allowedPaths: policy.allowedPaths
  };
}

export default function (pi: any) {
  pi.registerCommand("self-improve-policy", {
    description: "Show Harness self-improvement boundaries, PR fields, and required checks.",
    handler: async () => {
      const policy = await readPolicy();
      return [
        "Harness self-improvement policy",
        "",
        `Merge policy: ${policy.mergePolicy}`,
        "",
        "Allowed paths:",
        ...policy.allowedPaths.map((item: string) => `- ${item}`),
        "",
        "Required checks:",
        ...policy.requiredChecks.map((item: string) => `- ${item}`),
        "",
        "PR-ready fields:",
        "- problem statement",
        "- changed files",
        "- evidence",
        "- risk classification",
        "- required checks",
        "- rollback guidance"
      ].join("\n");
    }
  });

  pi.registerCommand("prepare-self-improvement-pr", {
    description: "Show the end-to-end Harness self-improvement workflow and output template.",
    handler: async () => {
      const policy = await readPolicy();
      const template = buildTemplate(policy);
      return [
        "1. Limit changes to allowed paths.",
        "2. Update fixtures and eval guidance with the behavior change.",
        "3. Run npm run validate.",
        "4. Run npm run evals.",
        "5. Run npm run self-improve -- --title \"...\" --problem \"...\".",
        "6. Copy the structured summary below into the PR body and wait for human review.",
        "",
        JSON.stringify(template, null, 2)
      ].join("\n");
    }
  });
}
