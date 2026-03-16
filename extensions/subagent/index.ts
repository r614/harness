import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { getRole, roleNames, validateStructuredOutput, type SubagentRoleName } from "./roles.js";
import { extractText, readMessagesFromSessionFile, summarizeMessages } from "./rpc.js";
import { ProcessSubagentProcess } from "./process.js";
import {
  SPINNER,
  describeActivity,
  renderRunSummary,
  statusIcon,
  truncate,
  type DisplayRun,
  type PersistedRunRecord,
  type RunMode,
} from "./ui.js";

const SUBAGENT_ENTRY_TYPE = "subagent-run";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TODO_EXTENSION_PATH = path.join(PACKAGE_ROOT, "extensions", "todos", "index.ts");
const WEB_BROWSER_SCRIPT_PATH = path.join(PACKAGE_ROOT, "skills", "web-browser", "scripts", "cdp.mjs");
const WEB_SEARCH_SCRIPT_PATH = path.join(PACKAGE_ROOT, "skills", "native-web-search", "search.mjs");

interface SubagentToolDetails {
  run?: PersistedRunRecord;
  runs?: PersistedRunRecord[];
  title?: string;
  error?: string;
}

interface RuntimeRun extends PersistedRunRecord {
  process?: ProcessSubagentProcess;
  latestTool?: string;
  latestActivity?: string;
  abortRequested?: boolean;
}

const SingleParams = Type.Object({
  mode: Type.Optional(StringEnum(["single"] as const)),
  role: StringEnum(roleNames() as readonly SubagentRoleName[], { description: "Built-in subagent role." }),
  task: Type.String({ description: "Task to delegate to the subagent." }),
  name: Type.Optional(Type.String({ description: "Optional display name." })),
  cwd: Type.Optional(Type.String({ description: "Working directory override. Defaults to current cwd." })),
  modelOverride: Type.Optional(Type.String({ description: "Optional model override; defaults to role pinned model." })),
});

const ParallelTaskParams = Type.Object({
  role: StringEnum(roleNames() as readonly SubagentRoleName[], { description: "Built-in subagent role." }),
  task: Type.String({ description: "Task to delegate to this subagent." }),
  name: Type.Optional(Type.String({ description: "Optional display name." })),
  cwd: Type.Optional(Type.String({ description: "Working directory override. Defaults to current cwd." })),
  modelOverride: Type.Optional(Type.String({ description: "Optional model override for this task." }))
});

const ChainTaskParams = Type.Object({
  role: StringEnum(roleNames() as readonly SubagentRoleName[], { description: "Built-in subagent role." }),
  task: Type.String({ description: "Task for this step. Use {previous} to inject the prior step's final output." }),
  name: Type.Optional(Type.String({ description: "Optional display name." })),
  cwd: Type.Optional(Type.String({ description: "Working directory override. Defaults to current cwd." })),
  modelOverride: Type.Optional(Type.String({ description: "Optional model override for this step." }))
});

const SubagentParams = Type.Object({
  mode: StringEnum(["single", "parallel", "chain"] as const, { description: "Execution mode." }),
  role: Type.Optional(StringEnum(roleNames() as readonly SubagentRoleName[])),
  task: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  modelOverride: Type.Optional(Type.String()),
  tasks: Type.Optional(Type.Array(ParallelTaskParams, { description: "Parallel tasks when mode is parallel." })),
  chain: Type.Optional(Type.Array(ChainTaskParams, { description: "Sequential chain steps when mode is chain." })),
  allowParallelWrites: Type.Optional(Type.Boolean({ description: "Allow multiple write-capable subagents in the shared worktree. Default: true with warnings." }))
});

function makeId(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

function sessionsDir(cwd: string) {
  return path.join(cwd, ".pi", "subagents", "sessions");
}

function runSessionDir(cwd: string, runId: string) {
  return path.join(sessionsDir(cwd), runId);
}

function effectiveTaskCwd(baseCwd: string, taskCwd?: string) {
  const resolved = path.resolve(baseCwd, taskCwd || ".");
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

function parseSummary(run: PersistedRunRecord) {
  const text = run.summary || "";
  const role = getRole(run.role);
  if (!role) return { valid: false, missing: ["unknown role"] };
  return validateStructuredOutput(role, text);
}

function subagentExtensionPaths() {
  const paths = [TODO_EXTENSION_PATH];
  return paths.filter((candidate) => fs.existsSync(candidate));
}

function browserInstructionBlock() {
  if (!fs.existsSync(WEB_BROWSER_SCRIPT_PATH)) return "";
  return [
    "Browser verification helper:",
    `- Use bash to run ${WEB_BROWSER_SCRIPT_PATH} list to discover tabs.`,
    `- Then use commands like ${WEB_BROWSER_SCRIPT_PATH} snap <target>, html <target>, click <target> \"selector\", type <target> \"text\", or shot <target> to verify UI flows.`,
    "- Prefer real browser evidence over guessing for UI assertions."
  ].join("\n");
}

function webSearchInstructionBlock() {
  if (!fs.existsSync(WEB_SEARCH_SCRIPT_PATH)) return "";
  return [
    "Native web search helper:",
    `- Use bash to run node ${WEB_SEARCH_SCRIPT_PATH} \"query\" for fast web research when external context is needed.`,
    "- Summarize the returned sources and findings with URLs in your final answer."
  ].join("\n");
}

function buildTaskPrompt(role: SubagentRoleName, task: string, warnings: string[] = []) {
  const definition = getRole(role)!;
  const warningText = warnings.length > 0 ? `\nWarnings:\n- ${warnings.join("\n- ")}` : "";
  const runtimeInstructions: string[] = [];
  if (fs.existsSync(TODO_EXTENSION_PATH)) {
    runtimeInstructions.push("The Harness todo extension is preloaded in this subagent. Use the todo tool directly when it helps coordinate or validate work.");
  }
  if (role === "researcher") {
    const searchBlock = webSearchInstructionBlock();
    if (searchBlock) runtimeInstructions.push(searchBlock);
  }
  if (role === "qa" || role === "researcher") {
    const browserBlock = browserInstructionBlock();
    if (browserBlock) runtimeInstructions.push(browserBlock);
  }
  if (role === "qa") {
    runtimeInstructions.push("For QA work, prefer executable evidence: run tests, start local apps if needed, and verify behavior with browser automation when appropriate.");
  }
  return [
    definition.systemPrompt,
    runtimeInstructions.join("\n\n"),
    "Top-level delegated task:",
    task,
    warningText,
    "Keep the work scoped to your role. If the todo tool is available, use it deliberately instead of merely mentioning it. If browser helpers are available and the task implies UI verification, use them when appropriate."
  ].filter(Boolean).join("\n\n");
}

export default function subagentExtension(pi: ExtensionAPI) {
  const activeRuns = new Map<string, RuntimeRun>();

  function persistRun(run: PersistedRunRecord) {
    pi.appendEntry(SUBAGENT_ENTRY_TYPE, JSON.parse(JSON.stringify(run)));
  }

  function toPersistedRun(run: RuntimeRun): PersistedRunRecord {
    return {
      id: run.id,
      groupId: run.groupId,
      name: run.name,
      role: run.role,
      task: run.task,
      mode: run.mode,
      cwd: run.cwd,
      model: run.model,
      builtins: run.builtins,
      canWrite: run.canWrite,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      summary: run.summary,
      error: run.error,
      sessionFile: run.sessionFile,
      sessionId: run.sessionId,
      parentSessionFile: run.parentSessionFile,
      structuredValid: run.structuredValid,
      missingSections: run.missingSections,
      stats: run.stats,
      warnings: run.warnings,
    };
  }

  async function emitProgress(onUpdate: any, title: string, runs: DisplayRun[]) {
    if (!onUpdate) return;
    const orderedRuns = [...runs].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    const text = [title, ...orderedRuns.slice(0, 8).map((run) => renderRunSummary(run))].join("\n");
    onUpdate({ content: [{ type: "text", text }], details: { title, runs: orderedRuns } });
  }

  function toDisplayRun(run: RuntimeRun): DisplayRun {
    return {
      id: run.id,
      groupId: run.groupId,
      name: run.name,
      role: run.role,
      task: run.task,
      mode: run.mode,
      cwd: run.cwd,
      model: run.model,
      builtins: run.builtins,
      canWrite: run.canWrite,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      summary: run.summary,
      error: run.error,
      sessionFile: run.sessionFile,
      sessionId: run.sessionId,
      parentSessionFile: run.parentSessionFile,
      structuredValid: run.structuredValid,
      missingSections: run.missingSections,
      stats: run.stats,
      warnings: run.warnings,
      latestActivity: run.latestActivity,
      latestTool: run.latestTool,
    };
  }

  function getGroupRuns(run: RuntimeRun, completedRuns: PersistedRunRecord[] = []): DisplayRun[] {
    if (!run.groupId) return [toDisplayRun(run)];

    const active = Array.from(activeRuns.values())
      .filter((candidate) => candidate.groupId === run.groupId)
      .map((candidate) => toDisplayRun(candidate));
    const completed = completedRuns
      .filter((candidate) => candidate.groupId === run.groupId)
      .map((candidate) => ({ ...candidate }));

    const byId = new Map<string, DisplayRun>();
    for (const item of [...completed, ...active]) byId.set(item.id, item);
    return Array.from(byId.values()).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  }

  function progressTitleForRun(run: RuntimeRun): string {
    if (run.mode === "parallel") return `Parallel subagents running (${getGroupRuns(run).length})`;
    if (run.mode === "chain") return `Chain subagents running`;
    return `Subagent ${run.role} running`;
  }

  async function executeRun(ctx: ExtensionContext, spec: { role: SubagentRoleName; task: string; name?: string; cwd?: string; modelOverride?: string; mode: RunMode; groupId?: string; warnings?: string[]; completedRunsProvider?: () => PersistedRunRecord[] }, signal?: AbortSignal, onUpdate?: any): Promise<PersistedRunRecord> {
    const role = getRole(spec.role);
    if (!role) throw new Error(`Unknown role: ${spec.role}`);
    const run: RuntimeRun = {
      id: makeId("subagent"),
      groupId: spec.groupId,
      name: spec.name || role.title,
      role: spec.role,
      task: spec.task,
      mode: spec.mode,
      cwd: spec.cwd || ctx.cwd,
      model: spec.modelOverride || role.model,
      builtins: role.builtins,
      canWrite: role.canWrite,
      status: "queued",
      startedAt: new Date().toISOString(),
      parentSessionFile: ctx.sessionManager.getSessionFile(),
      warnings: [...(spec.warnings || [])]
    };
    activeRuns.set(run.id, run);
    persistRun(toPersistedRun(run));

    let abortHandler: (() => void) | undefined;

    try {
      run.process = new ProcessSubagentProcess({
        cwd: run.cwd,
        sessionDir: runSessionDir(run.cwd, run.id),
        model: run.model,
        builtins: run.builtins,
        extensionPaths: subagentExtensionPaths(),
        onEvent: async (event) => {
          if (event?.type === "tool_execution_start") {
            run.latestTool = event.toolName;
            run.latestActivity = `running ${event.toolName}`;
          }
          if (event?.type === "message_update") {
            if (run.process?.latestAssistantText?.trim()) {
              run.latestActivity = truncate(run.process.latestAssistantText, 100);
            }
          }
          if (event?.type === "message_end" && event.message?.role === "assistant") {
            const text = extractText(event.message.content || []);
            if (text.trim()) run.latestActivity = truncate(text, 100);
          }
          await emitProgress(onUpdate, progressTitleForRun(run), getGroupRuns(run, spec.completedRunsProvider?.() || []));
        }
      });
      await run.process.initialize();
      if (signal) {
        abortHandler = () => {
          run.abortRequested = true;
          run.process?.forceTerminate().catch(() => undefined);
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      }
      run.sessionFile = run.process.sessionFile;
      run.sessionId = run.process.sessionId;
      run.status = "running";
      persistRun(toPersistedRun(run));
      await emitProgress(onUpdate, progressTitleForRun(run), getGroupRuns(run));
      await run.process.prompt(buildTaskPrompt(run.role, run.task, run.warnings));
      const completion = await run.process.waitForQuiescence(DEFAULT_TIMEOUT_MS);
      run.sessionFile = run.process.sessionFile;
      run.sessionId = run.process.sessionId;
      const messages = readMessagesFromSessionFile(run.sessionFile);
      run.summary = summarizeMessages(messages) || run.process.latestAssistantText || "";
      if (completion.exitCode !== 0) {
        const failureText = completion.stderrTail || run.summary || `subagent exited with code ${completion.exitCode}`;
        throw new Error(failureText);
      }
      run.stats = await run.process.getSessionStats().catch(() => undefined);
      const validation = parseSummary(run);
      run.structuredValid = validation.valid;
      run.missingSections = validation.missing;
      run.status = "done";
      run.endedAt = new Date().toISOString();
      if (run.missingSections.length > 0) {
        run.warnings = [...new Set([...(run.warnings || []), `missing sections: ${run.missingSections.join(", ")}`])];
      }
      persistRun(toPersistedRun(run));
      return toPersistedRun(run);
    } catch (error: any) {
      run.status = run.abortRequested ? "cancelled" : "error";
      run.error = error?.message || String(error);
      run.summary = run.summary || run.latestActivity || run.error;
      run.endedAt = new Date().toISOString();
      run.stats = await run.process?.getSessionStats().catch(() => undefined);
      persistRun(toPersistedRun(run));
      return toPersistedRun(run);
    } finally {
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      activeRuns.delete(run.id);
      await run.process?.shutdown().catch(() => undefined);
    }
  }

  async function executeParallel(ctx: ExtensionContext, tasks: Array<{ role: SubagentRoleName; task: string; name?: string; cwd?: string; modelOverride?: string }>, allowParallelWrites: boolean | undefined, signal?: AbortSignal, onUpdate?: any) {
    const groupId = makeId("group");
    const cwdCounts = new Map<string, number>();
    for (const task of tasks) {
      if (!getRole(task.role)?.canWrite) continue;
      const taskCwd = effectiveTaskCwd(ctx.cwd, task.cwd);
      cwdCounts.set(taskCwd, (cwdCounts.get(taskCwd) || 0) + 1);
    }
    const conflictingWriteCwds = Array.from(cwdCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([taskCwd]) => taskCwd);
    if (allowParallelWrites === false && conflictingWriteCwds.length > 0) {
      throw new Error(`allowParallelWrites=false forbids parallel write-capable subagents in the same worktree: ${conflictingWriteCwds.join(", ")}`);
    }
    const warnings = conflictingWriteCwds.length > 0
      ? ["multiple write-capable subagents are running in parallel in the same worktree"]
      : [];
    const completedRuns: PersistedRunRecord[] = [];
    const promises = tasks.map(async (task) => {
      const result = await executeRun(ctx, { ...task, mode: "parallel", groupId, warnings, completedRunsProvider: () => completedRuns }, signal, onUpdate);
      completedRuns.push(result);
      await emitProgress(onUpdate, `Parallel subagents finished (${completedRuns.filter((item) => item.status === "done").length}/${tasks.length})`, getGroupRuns({ ...result, process: undefined }, completedRuns));
      return result;
    });
    const results = await Promise.all(promises);
    await emitProgress(onUpdate, `Parallel subagents finished (${results.filter((item) => item.status === "done").length}/${results.length})`, results);
    return results;
  }

  async function executeChain(ctx: ExtensionContext, chain: Array<{ role: SubagentRoleName; task: string; name?: string; cwd?: string; modelOverride?: string }>, signal?: AbortSignal, onUpdate?: any) {
    const groupId = makeId("group");
    const results: PersistedRunRecord[] = [];
    let previous = "";
    for (const step of chain) {
      const task = step.task.replace(/\{previous\}/g, previous);
      const result = await executeRun(ctx, { ...step, task, mode: "chain", groupId }, signal, onUpdate);
      results.push(result);
      await emitProgress(onUpdate, `Chain step ${results.length}/${chain.length}`, results);
      if (result.status !== "done") break;
      previous = result.summary || previous;
    }
    return results;
  }

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Launch built-in role-based subagents as persisted Pi subprocess sessions. Supports single, parallel, and chain execution.",
    promptSnippet: "Use subagent for delegated single, parallel, or chained work with role-pinned models and toolsets.",
    promptGuidelines: [
      "Prefer scout/planner/reviewer for read-only work and worker for actual code changes.",
      "QA can run tests, execute code, and use browser tools if available for UI verification.",
      "If multiple write-capable subagents run in parallel in the same worktree, call that out explicitly."
    ],
    parameters: SubagentParams,
    async execute(_toolCallId: string, params: any, signal: AbortSignal, onUpdate: any, ctx: ExtensionContext): Promise<{ content: { type: "text"; text: string }[]; details: SubagentToolDetails; isError?: boolean }> {
      const mode = params.mode || "single";
      let closed = false;
      const safeOnUpdate = (payload: unknown) => {
        if (closed || !onUpdate) return;
        onUpdate(payload);
      };
      try {
        if (mode === "single") {
          if (!params.role || !params.task) throw new Error("single mode requires role and task");
          const result = await executeRun(ctx, {
            role: params.role,
            task: params.task,
            name: params.name,
            cwd: params.cwd,
            modelOverride: params.modelOverride,
            mode: "single"
          }, signal, safeOnUpdate);
          const text = result.status === "done"
            ? result.summary || `${result.role} completed`
            : `${result.role} ${result.status}: ${result.error || result.summary || "no output"}`;
          closed = true;
          return { content: [{ type: "text", text }], details: { run: result } };
        }

        if (mode === "parallel") {
          const tasks = params.tasks || [];
          if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("parallel mode requires tasks[]");
          const results = await executeParallel(ctx, tasks, params.allowParallelWrites, signal, safeOnUpdate);
          const text = results.map((run) => `${statusIcon(run.status)} ${run.role}: ${truncate(run.summary || run.error || run.task, 100)}`).join("\n");
          closed = true;
          return { content: [{ type: "text", text }], details: { runs: results } };
        }

        if (mode === "chain") {
          const chain = params.chain || [];
          if (!Array.isArray(chain) || chain.length === 0) throw new Error("chain mode requires chain[]");
          const results = await executeChain(ctx, chain, signal, safeOnUpdate);
          const text = results.map((run, index) => `${index + 1}. ${statusIcon(run.status)} ${run.role}: ${truncate(run.summary || run.error || run.task, 100)}`).join("\n");
          closed = true;
          return { content: [{ type: "text", text }], details: { runs: results } };
        }

        throw new Error(`Unsupported mode: ${mode}`);
      } catch (error: any) {
        closed = true;
        return { content: [{ type: "text", text: `subagent error: ${error?.message || String(error)}` }], details: { error: error?.message || String(error) }, isError: true };
      }
    },
    renderCall(args: any, theme: any) {
      const mode = args.mode || "single";
      if (mode === "single") {
        return new Text(`${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", args.role || "role")} ${theme.fg("dim", truncate(args.task || "", 80))}`, 0, 0);
      }
      if (mode === "parallel") {
        return new Text(`${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", "parallel")}`, 0, 0);
      }
      return new Text(`${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", `chain (${(args.chain || []).length})`)}`, 0, 0);
    },
    renderResult(result: any, options: any, theme: any) {
      const details = (result?.details || {}) as SubagentToolDetails;
      const runs = (details.runs && details.runs.length > 0)
        ? details.runs
        : details.run
          ? [details.run]
          : [];

      if (runs.length === 0) {
        const text = result?.content?.[0]?.text || "";
        return new Text(theme.fg(result?.isError ? "error" : "muted", text), 0, 0);
      }

      const frame = Math.floor(Date.now() / 100) % SPINNER.length;
      const lines: string[] = [];
      if (details.title) lines.push(theme.fg("accent", details.title));

      for (const run of runs) {
        const color = run.status === "error" ? "error" : run.status === "done" ? "success" : "warning";
        const icon = run.status === "running" ? SPINNER[frame % SPINNER.length] : statusIcon(run.status);
        const liveDetail = (run as DisplayRun).latestActivity;
        const expanded = Boolean(options?.expanded);
        const headline = run.status === "running"
          ? `${icon} ${run.role} · ${run.summary || liveDetail || run.task}`
          : renderRunSummary(run, frame);
        lines.push(theme.fg(color, headline));
        if (expanded) {
          const fullActivity = run.status === "running"
            ? ((run as DisplayRun).latestTool
              ? describeActivity(run)
              : ((run as DisplayRun).latestActivity || run.task || "thinking…"))
            : describeActivity(run);
          lines.push(theme.fg("dim", `  ⎿ ${fullActivity}`));
          if (run.task) {
            lines.push(theme.fg("dim", `  task: ${run.task}`));
          }
          if ((run as DisplayRun).latestActivity && (run as DisplayRun).latestActivity !== run.task) {
            lines.push(theme.fg("dim", `  latest: ${(run as DisplayRun).latestActivity}`));
          }
          if (run.summary && run.summary !== (run as DisplayRun).latestActivity) {
            lines.push(theme.fg("dim", `  summary: ${run.summary}`));
          }
          if (run.error) {
            lines.push(theme.fg("error", `  ${run.error}`));
          }
        }
      }

      if (!options?.expanded && runs.length > 1) {
        lines.push(theme.fg("dim", "Expand tool to view per-agent trace."));
      }

      return new Text(lines.join("\n"), 0, 0);
    }
  });
}
