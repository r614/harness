import type { SubagentRoleName } from "./roles.js";

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export type RunMode = "single" | "parallel" | "chain";
export type RunStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface SessionStats {
  sessionFile?: string;
  sessionId?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  cost?: number;
}

export interface PersistedRunRecord {
  id: string;
  groupId?: string;
  name: string;
  role: SubagentRoleName;
  task: string;
  mode: RunMode;
  cwd: string;
  model: string;
  builtins: string[];
  canWrite: boolean;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  error?: string;
  sessionFile?: string;
  sessionId?: string;
  parentSessionFile?: string;
  structuredValid?: boolean;
  missingSections?: string[];
  stats?: SessionStats;
  warnings?: string[];
}

export interface DisplayRun extends PersistedRunRecord {
  latestActivity?: string;
  latestTool?: string;
}

function normalizeText(text: string, fallback = ""): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

export function truncate(text: string, max = 80): string {
  const clean = normalizeText(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1))}…`;
}

export function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export function usageText(stats?: SessionStats): string {
  if (!stats) return "";
  const parts: string[] = [];
  if (stats.toolCalls) parts.push(`${stats.toolCalls} tool use${stats.toolCalls === 1 ? "" : "s"}`);
  if (stats.tokens?.total) parts.push(`${formatTokenCount(stats.tokens.total)} token`);
  else {
    if (stats.tokens?.input) parts.push(`↑${formatTokenCount(stats.tokens.input)}`);
    if (stats.tokens?.output) parts.push(`↓${formatTokenCount(stats.tokens.output)}`);
  }
  if (typeof stats.cost === "number" && stats.cost > 0) parts.push(`$${stats.cost.toFixed(4)}`);
  return parts.join(" · ");
}

export function statusIcon(status: RunStatus): string {
  switch (status) {
    case "queued":
      return "…";
    case "running":
      return "⏳";
    case "done":
      return "✓";
    case "error":
      return "✗";
    case "cancelled":
      return "■";
  }
}

export function describeActivity(run: DisplayRun): string {
  if (run.latestTool) {
    const toolMap: Record<string, string> = {
      read: "reading…",
      bash: "running command…",
      edit: "editing…",
      write: "writing…",
      grep: "searching…",
      find: "finding files…",
      ls: "listing files…",
      todo: "updating todos…",
    };
    return toolMap[run.latestTool] || `${run.latestTool}…`;
  }
  if (run.latestActivity) return truncate(run.latestActivity, 90);
  if (run.status === "queued") return "queued";
  if (run.status === "running") return "thinking…";
  if (run.status === "done") return "Done";
  if (run.status === "cancelled") return "Stopped";
  if (run.status === "error") return run.error ? `Error: ${truncate(run.error, 70)}` : "Error";
  return truncate(run.task, 70);
}

export function renderRunSummary(run: DisplayRun, frame = 0): string {
  const icon = run.status === "running" ? SPINNER[frame % SPINNER.length] : statusIcon(run.status);
  const parts = [
    `${icon} ${run.role}`,
    truncate(run.summary || run.task, 44),
  ];
  const usage = usageText(run.stats);
  if (usage) parts.push(usage);
  parts.push(formatDuration(run.startedAt, run.endedAt));
  return parts.join(" · ");
}
