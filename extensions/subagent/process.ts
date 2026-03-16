import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { SessionStats } from "./ui.js";
import { extractText, readMessagesFromSessionFile } from "./rpc.js";

export interface ProcessSubagentOptions {
  cwd: string;
  sessionDir: string;
  model: string;
  builtins: string[];
  extensionPaths?: string[];
  onEvent?: (event: any) => void;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function listSessionFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(dir, name))
    .sort();
}

function latestSessionFile(dir: string): string | undefined {
  const files = listSessionFiles(dir)
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.file;
}

function deriveSessionStats(messages: any[], sessionFile?: string): SessionStats {
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let toolResults = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let sessionId: string | undefined;

  for (const message of messages) {
    if (message?.role === "user") userMessages += 1;
    if (message?.role === "assistant") {
      assistantMessages += 1;
      const usage = message.usage || {};
      totalInput += Number(usage.input || 0);
      totalOutput += Number(usage.output || 0);
      totalCacheRead += Number(usage.cacheRead || 0);
      totalCacheWrite += Number(usage.cacheWrite || 0);
      totalTokens += Number(usage.totalTokens || usage.total || 0);
      totalCost += Number(usage.cost?.total || usage.cost || 0);
      if (!sessionId && typeof message.sessionId === "string") sessionId = message.sessionId;
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type === "toolCall") toolCalls += 1;
        }
      }
    }
    if (message?.role === "toolResult") toolResults += 1;
  }

  return {
    sessionFile,
    sessionId,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: messages.length,
    tokens: {
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      total: totalTokens || totalInput + totalOutput + totalCacheRead + totalCacheWrite,
    },
    cost: totalCost,
  };
}

export class ProcessSubagentProcess {
  readonly cwd: string;
  readonly sessionDir: string;
  readonly model: string;
  readonly builtins: string[];
  readonly extensionPaths: string[];
  sessionFile?: string;
  sessionId?: string;
  latestAssistantText = "";
  latestTool = "";
  lastEventAt = Date.now();

  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private completion?: Promise<{ exitCode: number }>;
  private eventListeners: Array<(event: any) => void> = [];
  private stats?: SessionStats;

  constructor(options: ProcessSubagentOptions) {
    this.cwd = options.cwd;
    this.sessionDir = options.sessionDir;
    this.model = options.model;
    this.builtins = options.builtins;
    this.extensionPaths = options.extensionPaths || [];
    if (options.onEvent) this.eventListeners.push(options.onEvent);
  }

  private emitEvent(event: any) {
    this.lastEventAt = Date.now();
    if (event?.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta") {
        this.latestAssistantText += update.delta ?? "";
      } else if (update?.type === "text_start") {
        this.latestAssistantText = update.partial?.content?.[update.contentIndex]?.text ?? this.latestAssistantText;
      } else if (update?.type === "text_end" && typeof update.content === "string") {
        this.latestAssistantText = update.content;
      }
    }
    if (event?.type === "tool_execution_start") {
      this.latestTool = event.toolName || "tool";
    }
    if (event?.type === "message_end" && event.message?.role === "assistant") {
      const text = extractText(event.message.content);
      if (text.trim()) this.latestAssistantText = text;
      if (!this.sessionId && typeof event.message?.sessionId === "string") this.sessionId = event.message.sessionId;
    }
    for (const listener of this.eventListeners) listener(event);
  }

  private consumeStdout(chunk: string) {
    this.stdoutBuffer += chunk;
    while (true) {
      const index = this.stdoutBuffer.indexOf("\n");
      if (index < 0) break;
      const line = this.stdoutBuffer.slice(0, index).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        this.emitEvent(JSON.parse(line));
      } catch {
        // ignore non-json output
      }
    }
  }

  async initialize() {
    ensureDir(this.sessionDir);
    return { sessionDir: this.sessionDir, existingSessionFiles: listSessionFiles(this.sessionDir).length };
  }

  async prompt(message: string) {
    if (this.child) throw new Error("Subagent process already started");
    ensureDir(this.sessionDir);

    const args = ["--mode", "json", "--session-dir", this.sessionDir, "--model", this.model];
    if (this.builtins.length > 0) args.push("--tools", this.builtins.join(","));
    for (const extensionPath of this.extensionPaths) args.push("-e", extensionPath);
    args.push(message);

    this.child = spawn("pi", args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk) => this.consumeStdout(String(chunk)));
    this.child.stderr.on("data", (chunk) => {
      this.stderrBuffer += String(chunk);
      if (this.stderrBuffer.length > 16000) this.stderrBuffer = this.stderrBuffer.slice(-16000);
    });

    this.completion = new Promise<{ exitCode: number }>((resolve, reject) => {
      this.child?.on("error", reject);
      this.child?.on("close", (code, signal) => {
        if (this.stdoutBuffer.trim()) this.consumeStdout("\n");
        this.sessionFile = latestSessionFile(this.sessionDir);
        const messages = readMessagesFromSessionFile(this.sessionFile);
        this.stats = deriveSessionStats(messages, this.sessionFile);
        this.sessionId = this.stats.sessionId;
        const exitCode = code ?? (signal ? 1 : 0);
        if (exitCode !== 0 && !this.latestAssistantText.trim()) {
          const stderr = this.stderrBuffer.trim();
          if (stderr) this.latestAssistantText = stderr;
        }
        resolve({ exitCode });
      });
    });
  }

  async waitForQuiescence(timeoutMs = 30 * 60 * 1000): Promise<{ exitCode: number; stderrTail?: string }> {
    if (!this.completion) throw new Error("Subagent process not started");
    const result = await Promise.race([
      this.completion,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for subagent completion after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)),
    ]);
    return { exitCode: result.exitCode, stderrTail: this.stderrTail || undefined };
  }

  async getSessionStats(): Promise<SessionStats> {
    if (this.stats) return this.stats;
    const messages = readMessagesFromSessionFile(this.sessionFile);
    this.stats = deriveSessionStats(messages, this.sessionFile);
    this.sessionId = this.stats.sessionId;
    return this.stats;
  }

  async abort() {
    if (!this.child || this.child.killed) return false;
    this.child.kill("SIGTERM");
    return true;
  }

  async forceTerminate() {
    const child = this.child;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) return;

    child.kill("SIGTERM");

    const exitedAfterTerm = await Promise.race([
      new Promise<boolean>((resolve) => child.once("close", () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);

    if (!exitedAfterTerm && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }

  async shutdown() {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }

  get stderrTail() {
    return this.stderrBuffer.trim();
  }
}
