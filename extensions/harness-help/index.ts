import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import answerExtension from "../answer/index.ts";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SKILLS_DIR = join(ROOT, "skills");

async function listSkillEntries() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export default function (pi: any) {
  answerExtension(pi);

  pi.registerCommand("harness-help", {
    description: "Show the installed Harness package resources and production-usable entry points.",
    handler: async () => {
      return [
        "Harness package loaded.",
        "",
        "Available today:",
        "- answer: interactive extraction of unanswered questions from the last assistant message",
        "- autoresearch: iterative optimization workflow helpers with logging and dashboard UI",
        "- gmail-workspace: Gmail search/read/draft/slop-triage workflows through local gws",
        "- calendar-workspace: Calendar list/draft/apply workflows through local gws",
        "- context: session and context-window inspection helpers",
        "- files: interactive file browser for repo and session-referenced files",
        "- review: review workflows for local changes, branches, commits, folders, and PRs",
        "",
        "Requires local setup:",
        "- install and authenticate the Google Workspace CLI (`gws`) for Gmail/Calendar commands",
        "",
        "Package layout:",
        "- extensions/: runtime commands and UI helpers",
        "- skills/: on-demand capability instructions",
        "- themes/: JSON themes",
        "",
        "Try /harness-skills next."
      ].join("\n");
    }
  });

  pi.registerCommand("harness-skills", {
    description: "List the built-in Harness skills.",
    handler: async () => {
      const skills = await listSkillEntries();
      return skills.map((skill) => `- ${skill}: skills/${skill}/SKILL.md`).join("\n");
    }
  });
}
