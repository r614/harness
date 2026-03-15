import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(relativePath: string) {
  return readFile(join(ROOT, relativePath), "utf8");
}

export default function (pi: any) {
  pi.registerCommand("harness-help", {
    description: "Show the installed Harness package resources and production-usable entry points.",
    handler: async () => {
      return [
        "Harness package loaded.",
        "",
        "Production-usable today:",
        "- repo-operator: repo-scoped self-improvement workflow with eval-backed PR summaries",
        "- gmail-workspace: Gmail search/read/draft/slop-triage workflows through local gws",
        "- calendar-workspace: Calendar list/draft/apply workflows through local gws",
        "- browser-runtime: persistent local Chrome-backed browser sessions with structured actions",
        "",
        "Requires local setup:",
        "- install and authenticate the Google Workspace CLI (`gws`) for Gmail/Calendar commands",
        "- local Google Chrome or Chromium for browser-runtime",
        "",
        "Scaffolding / future work:",
        "- intercepted-commands/: placeholder wrappers, not part of the production workflow",
        "- web-browser: imported supporting guidance, superseded by browser-runtime for local automation",
        "",
        "Available resources:",
        "- skills/: on-demand capability instructions",
        "- extensions/: runtime commands and guardrails",
        "- manifests/: explicit package policies",
        "",
        "Try /harness-skills next."
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
}
