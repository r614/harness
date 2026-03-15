import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(relativePath: string) {
  return readFile(join(ROOT, relativePath), "utf8");
}

export default function (pi: any) {
  pi.registerCommand("harness-help", {
    description: "Show the installed Harness package resources and entry points.",
    handler: async () => {
      return [
        "Harness package loaded.",
        "",
        "Available resources:",
        "- skills/: on-demand capability instructions",
        "- prompts/: reusable slash-command templates",
        "- extensions/: runtime commands and guardrails",
        "- manifests/: explicit package policies",
        "",
        "Try /harness-skills or /harness-prompts next."
      ].join("\n");
    }
  });

  pi.registerCommand("harness-skills", {
    description: "List the built-in Harness skills.",
    handler: async () => {
      const raw = await readText("manifests/skills.json");
      const manifest = JSON.parse(raw);
      return manifest.skills.map((skill: { name: string; path: string }) => `- ${skill.name}: ${skill.path}`).join("\n");
    }
  });

  pi.registerCommand("harness-prompts", {
    description: "List the packaged prompt templates.",
    handler: async () => {
      return [
        "- /improve-extension",
        "- /open-self-improvement-pr",
        "- /sync-email",
        "- /run-browser-task"
      ].join("\n");
    }
  });
}
