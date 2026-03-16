import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

type CommandContext = {
  cwd: string;
  ui: {
    notify(message: string, level?: "info" | "warning" | "error"): void;
  };
};

function parseJsonArgs(args: string[]) {
  const raw = args.join(" ").trim();
  if (!raw) {
    throw new Error("Expected a JSON payload.");
  }
  return JSON.parse(raw);
}

async function runTask(input: unknown, ctx: CommandContext) {
  const modulePath = resolve(ROOT, "extensions/google-workspace/scripts/google-workspace.mjs");
  const workspace = await import(modulePath);
  return workspace.runWorkspaceTask(input, { cwd: ctx.cwd || ROOT });
}

export default function (pi: any) {
  pi.registerCommand("gmail-workspace", {
    description: "Run a Gmail workflow through the local gws CLI using a JSON task payload.",
    handler: async (args: string[], ctx: CommandContext) => {
      try {
        const input = parseJsonArgs(args);
        const result = await runTask(input, ctx);
        return JSON.stringify(result, null, 2);
      } catch (error: any) {
        ctx.ui?.notify?.(error.message || String(error), "error");
        return `gmail-workspace error: ${error.message || String(error)}`;
      }
    }
  });

  pi.registerCommand("calendar-workspace", {
    description: "Run a Calendar workflow through the local gws CLI using a JSON task payload.",
    handler: async (args: string[], ctx: CommandContext) => {
      try {
        const input = parseJsonArgs(args);
        const result = await runTask(input, ctx);
        return JSON.stringify(result, null, 2);
      } catch (error: any) {
        ctx.ui?.notify?.(error.message || String(error), "error");
        return `calendar-workspace error: ${error.message || String(error)}`;
      }
    }
  });
}
