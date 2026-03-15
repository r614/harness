import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

type CommandContext = {
  cwd: string;
  ui: {
    notify(message: string, level?: "info" | "warning" | "error"): void;
  };
};

function parsePayload(args: string[]) {
  const raw = args.join(" ").trim();
  return raw ? JSON.parse(raw) : {};
}

async function loadClient() {
  return import(resolve(ROOT, "scripts/browser-runtime.mjs"));
}

export default function (pi: any) {
  pi.registerCommand("browser-runtime-start", {
    description: "Start the persistent local browser runtime daemon.",
    handler: async (_args: string[], ctx: CommandContext) => {
      try {
        const client = await loadClient();
        const result = await client.startBrowserRuntime();
        return JSON.stringify(result, null, 2);
      } catch (error: any) {
        ctx.ui?.notify?.(error.message || String(error), "error");
        return `browser-runtime-start error: ${error.message || String(error)}`;
      }
    }
  });

  pi.registerCommand("browser-runtime-status", {
    description: "Show persistent local browser runtime status.",
    handler: async (_args: string[], ctx: CommandContext) => {
      try {
        const client = await loadClient();
        const result = await client.browserRuntimeStatus();
        return JSON.stringify(result, null, 2);
      } catch (error: any) {
        ctx.ui?.notify?.(error.message || String(error), "error");
        return `browser-runtime-status error: ${error.message || String(error)}`;
      }
    }
  });

  pi.registerCommand("browser-session", {
    description: "Create a persistent browser session from a JSON payload.",
    handler: async (args: string[], ctx: CommandContext) => {
      try {
        const client = await loadClient();
        const result = await client.createBrowserSession(parsePayload(args));
        return JSON.stringify(result, null, 2);
      } catch (error: any) {
        ctx.ui?.notify?.(error.message || String(error), "error");
        return `browser-session error: ${error.message || String(error)}`;
      }
    }
  });

  pi.registerCommand("browser-action", {
    description: "Run a browser action against a persistent session using a JSON payload.",
    handler: async (args: string[], ctx: CommandContext) => {
      try {
        const payload = parsePayload(args);
        if (!payload.sessionId) throw new Error("browser-action requires sessionId");
        const client = await loadClient();
        const result = await client.performBrowserAction(payload.sessionId, payload);
        return JSON.stringify(result, null, 2);
      } catch (error: any) {
        ctx.ui?.notify?.(error.message || String(error), "error");
        return `browser-action error: ${error.message || String(error)}`;
      }
    }
  });
}
