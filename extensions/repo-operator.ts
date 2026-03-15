import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function readPolicy() {
  const raw = await readFile(join(ROOT, "manifests/policies.json"), "utf8");
  return JSON.parse(raw);
}

export default function (pi: any) {
  pi.registerCommand("self-improve-policy", {
    description: "Show Harness self-improvement boundaries and required checks.",
    handler: async () => {
      const policy = await readPolicy();
      return [
        "Harness self-improvement policy",
        "",
        `Merge policy: ${policy.selfImprovement.mergePolicy}`,
        "",
        "Allowed paths:",
        ...policy.selfImprovement.allowedPaths.map((item: string) => `- ${item}`),
        "",
        "Required checks:",
        ...policy.selfImprovement.requiredChecks.map((item: string) => `- ${item}`)
      ].join("\n");
    }
  });

  pi.registerCommand("prepare-self-improvement-pr", {
    description: "Explain how to prepare a compliant Harness self-improvement PR.",
    handler: async () => {
      return [
        "1. Limit changes to allowed paths.",
        "2. Run npm run validate.",
        "3. Run npm run evals.",
        "4. Run npm run self-improve -- --title \"...\" --problem \"...\".",
        "5. Open the PR and wait for human review."
      ].join("\n");
    }
  });
}
