import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateTail } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, matchesKey } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import {
  appendIdea,
  buildResumeMessage,
  defaultState,
  findBaselineSecondary,
  formatNum,
  initExperiment,
  isBetter,
  logExperimentResult,
  pruneIdeasFile,
  reconstructState,
  revertExperimentChanges,
  runExperimentTask,
  shouldAutoResume
} from "./autoresearch/scripts/autoresearch.mjs";

const InitParams = Type.Object({
  name: Type.String({ description: "Human-readable experiment name." }),
  metric_name: Type.String({ description: "Primary metric name." }),
  metric_unit: Type.Optional(Type.String({ description: "Primary metric unit." })),
  direction: Type.Optional(Type.String({ description: '"lower" or "higher".' }))
});

const RunParams = Type.Object({
  command: Type.String({ description: "Shell command to run for the experiment." }),
  timeout_seconds: Type.Optional(Type.Number({ description: "Timeout in seconds (default 600)." })),
  checks_timeout_seconds: Type.Optional(Type.Number({ description: "Timeout for autoresearch.checks.sh in seconds (default 300)." }))
});

const LogParams = Type.Object({
  commit: Type.String({ description: "Short git commit hash or placeholder." }),
  metric: Type.Number({ description: "Primary metric value for this run." }),
  status: StringEnum(["keep", "discard", "crash", "checks_failed"] as const),
  description: Type.String({ description: "Short description of the experiment." }),
  metrics: Type.Optional(Type.Record(Type.String(), Type.Number())),
  force: Type.Optional(Type.Boolean()),
  idea: Type.Optional(Type.String({ description: "Optional promising follow-up idea to append to autoresearch.ideas.md." })),
  revertWorkingTree: Type.Optional(Type.Boolean({ description: "When true, discard/crash/checks_failed will revert working tree changes with git checkout -- ." }))
});

function currentResults(state: any) {
  return state.results.filter((result: any) => result.segment === state.currentSegment);
}

function computeBest(state: any) {
  let best = state.bestMetric;
  let bestRun = 1;
  let bestSecondary: Record<string, number> = {};
  for (let index = 0; index < state.results.length; index += 1) {
    const result = state.results[index];
    if (result.segment !== state.currentSegment || result.status !== "keep" || result.metric <= 0) continue;
    if (best === null || isBetter(result.metric, best, state.bestDirection)) {
      best = result.metric;
      bestRun = index + 1;
      bestSecondary = result.metrics ?? {};
    }
  }
  return { best, bestRun, bestSecondary };
}

function renderDashboardLines(state: any, theme: any, width: number, maxRows = 6) {
  if (state.results.length === 0) {
    return [theme.fg("dim", "No experiments yet.")];
  }

  const current = currentResults(state);
  const kept = current.filter((result: any) => result.status === "keep").length;
  const discarded = current.filter((result: any) => result.status === "discard").length;
  const crashed = current.filter((result: any) => result.status === "crash").length;
  const checksFailed = current.filter((result: any) => result.status === "checks_failed").length;
  const { best, bestRun, bestSecondary } = computeBest(state);
  const baselineSecondary = findBaselineSecondary(state.results, state.currentSegment, state.secondaryMetrics);
  const lines = [
    `${theme.fg("accent", "🔬 autoresearch")} ${theme.fg("muted", state.name || "")}`.trim(),
    `${theme.fg("muted", "Runs:")} ${state.results.length}  ${theme.fg("success", `${kept} kept`)}${discarded ? `  ${theme.fg("warning", `${discarded} discarded`)}` : ""}${crashed ? `  ${theme.fg("error", `${crashed} crashed`)}` : ""}${checksFailed ? `  ${theme.fg("error", `${checksFailed} checks failed`)}` : ""}`,
    `${theme.fg("muted", "Baseline:")} ${theme.fg("warning", `★ ${state.metricName}: ${formatNum(state.bestMetric, state.metricUnit)}`)}`,
    `${theme.fg("muted", "Best:")} ${theme.fg("warning", `★ ${state.metricName}: ${formatNum(best, state.metricUnit)}`)}${theme.fg("dim", ` #${bestRun}`)}`,
    ""
  ];

  if (Object.keys(bestSecondary).length > 0) {
    const secondaryText = Object.entries(bestSecondary)
      .map(([name, value]) => {
        const metric = state.secondaryMetrics.find((item: any) => item.name === name);
        const baseline = baselineSecondary[name];
        let text = `${name}: ${formatNum(Number(value), metric?.unit ?? "")}`;
        if (baseline !== undefined && baseline !== 0 && baseline !== value) {
          const pct = ((Number(value) - baseline) / baseline) * 100;
          text += ` ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
        }
        return text;
      })
      .join("  ");
    lines.push(`${theme.fg("muted", "Secondary:")} ${theme.fg("dim", secondaryText)}`.slice(0, width));
    lines.push("");
  }

  lines.push(theme.fg("muted", "#  commit   metric      status          description"));
  const visible = state.results.slice(Math.max(0, state.results.length - maxRows));
  if (visible.length < state.results.length) {
    lines.push(theme.fg("dim", `… ${state.results.length - visible.length} earlier runs`));
  }
  for (const result of visible) {
    const index = state.results.indexOf(result) + 1;
    const metricText = formatNum(result.metric, state.metricUnit).padEnd(10);
    let row = `${String(index).padEnd(3)}${String(result.commit || "").slice(0, 7).padEnd(9)}${metricText}${String(result.status).padEnd(16)}${result.description}`;
    if (result.metrics && Object.keys(result.metrics).length > 0) {
      const extras = Object.entries(result.metrics)
        .map(([name, value]) => {
          const baseline = baselineSecondary[name];
          const suffix = baseline !== undefined && baseline !== value && baseline !== 0
            ? ` (${Number(value) > baseline ? "+" : ""}${(((Number(value) - baseline) / baseline) * 100).toFixed(1)}%)`
            : "";
          return `${name}=${value}${suffix}`;
        })
        .join(" ");
      row += ` ${theme.fg("dim", extras)}`;
    }
    lines.push(row.slice(0, width));
  }
  return lines;
}

export default function autoresearchExtension(pi: ExtensionAPI) {
  let state = defaultState();
  let autoresearchMode = false;
  let dashboardExpanded = false;
  let lastRunChecks: { pass: boolean; output: string; duration: number } | null = null;
  let experimentsThisSession = 0;
  let lastAutoResumeTime = 0;
  let autoResumeTurns = 0;

  async function refreshState(ctx: ExtensionContext) {
    state = await reconstructState(ctx.cwd);
    autoresearchMode = fs.existsSync(path.join(ctx.cwd, "autoresearch.jsonl"));
    updateWidget(ctx);
  }

  function updateWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    if (state.results.length === 0) {
      ctx.ui.setWidget("autoresearch", undefined);
      return;
    }

    ctx.ui.setWidget("autoresearch", (_tui, theme) => {
      if (dashboardExpanded) {
        const width = process.stdout.columns || 120;
        const lines = renderDashboardLines(state, theme, width, 8);
        lines.unshift(theme.fg("dim", "ctrl+x collapse • ctrl+shift+x fullscreen"));
        return new Text(lines.join("\n"), 0, 0);
      }

      const current = currentResults(state);
      const kept = current.filter((result: any) => result.status === "keep").length;
      const crashed = current.filter((result: any) => result.status === "crash").length;
      const checksFailed = current.filter((result: any) => result.status === "checks_failed").length;
      const baselineSecondary = findBaselineSecondary(state.results, state.currentSegment, state.secondaryMetrics);
      const { best, bestRun, bestSecondary } = computeBest(state);
      const parts = [
        theme.fg("accent", "🔬"),
        theme.fg("muted", ` ${state.results.length} runs`),
        theme.fg("success", ` ${kept} kept`),
        crashed > 0 ? theme.fg("error", ` ${crashed}💥`) : "",
        checksFailed > 0 ? theme.fg("error", ` ${checksFailed}⚠`) : "",
        theme.fg("dim", " │ "),
        theme.fg("warning", `★ ${state.metricName}: ${formatNum(best ?? state.bestMetric, state.metricUnit)}`),
        theme.fg("dim", ` #${bestRun}`)
      ];
      if (state.bestMetric !== null && best !== null && best !== state.bestMetric && state.bestMetric !== 0) {
        const pct = ((best - state.bestMetric) / state.bestMetric) * 100;
        parts.push(theme.fg(isBetter(best, state.bestMetric, state.bestDirection) ? "success" : "error", ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`));
      }
      for (const metric of state.secondaryMetrics.slice(0, 2)) {
        const value = bestSecondary[metric.name];
        if (value === undefined) continue;
        const baseline = baselineSecondary[metric.name];
        let text = `${metric.name}: ${formatNum(value, metric.unit)}`;
        if (baseline !== undefined && baseline !== 0 && baseline !== value) {
          const pct = ((value - baseline) / baseline) * 100;
          text += ` ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
        }
        parts.push(theme.fg("muted", `  ${text}`));
      }
      if (state.name) parts.push(theme.fg("dim", ` │ ${state.name}`));
      parts.push(theme.fg("dim", "  (ctrl+x expand • ctrl+shift+x fullscreen)"));
      return new Text(parts.join(""), 0, 0);
    });
  }

  async function showFullscreenDashboard(ctx: ExtensionContext) {
    if (!ctx.hasUI || state.results.length === 0) {
      ctx.ui?.notify?.("No experiments yet", "info");
      return;
    }

    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      let scrollOffset = 0;

      const render = (width: number) => {
        const termRows = process.stdout.rows || 40;
        const lines = renderDashboardLines(state, theme, width, 0);
        const viewportRows = Math.max(6, termRows - 4);
        const maxScroll = Math.max(0, lines.length - viewportRows);
        scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));
        const visible = lines.slice(scrollOffset, scrollOffset + viewportRows);
        const footer = theme.fg("dim", `↑↓/j/k scroll • g/G jump • esc close  ${scrollOffset + 1}-${Math.min(scrollOffset + viewportRows, lines.length)}/${lines.length}`);
        const out = [theme.fg("accent", "🔬 autoresearch fullscreen")];
        out.push(...visible);
        while (out.length < viewportRows + 1) out.push("");
        out.push(footer.slice(0, width));
        return out;
      };

      return {
        render(width: number) {
          return render(width);
        },
        invalidate() {},
        handleInput(data: string) {
          const termRows = process.stdout.rows || 40;
          const viewportRows = Math.max(6, termRows - 4);
          const lineCount = renderDashboardLines(state, theme, process.stdout.columns || 120, 0).length;
          const maxScroll = Math.max(0, lineCount - viewportRows);
          if (matchesKey(data, "escape") || data === "q") {
            done(undefined);
            return;
          }
          if (matchesKey(data, "up") || data === "k") scrollOffset = Math.max(0, scrollOffset - 1);
          else if (matchesKey(data, "down") || data === "j") scrollOffset = Math.min(maxScroll, scrollOffset + 1);
          else if (data === "g") scrollOffset = 0;
          else if (data === "G") scrollOffset = maxScroll;
          else if (matchesKey(data, "pageUp")) scrollOffset = Math.max(0, scrollOffset - viewportRows);
          else if (matchesKey(data, "pageDown")) scrollOffset = Math.min(maxScroll, scrollOffset + viewportRows);
          tui.requestRender();
        }
      };
    }, {
      overlay: true,
      overlayOptions: {
        width: "95%",
        maxHeight: "90%",
        anchor: "center"
      }
    });
  }

  for (const eventName of ["session_start", "session_switch", "session_fork", "session_tree"] as const) {
    pi.on(eventName, async (_event: any, ctx: ExtensionContext) => {
      await refreshState(ctx);
    });
  }

  pi.on("agent_start", async () => {
    experimentsThisSession = 0;
  });

  pi.on("agent_end", async (_event: any, ctx: ExtensionContext) => {
    const decision = shouldAutoResume({
      autoresearchMode,
      experimentsThisSession,
      now: Date.now(),
      lastAutoResumeTime,
      autoResumeTurns
    });
    if (!decision.resume) return;
    lastAutoResumeTime = Date.now();
    autoResumeTurns += 1;
    const hasIdeas = fs.existsSync(path.join(ctx.cwd, "autoresearch.ideas.md"));
    pi.sendUserMessage(buildResumeMessage({ hasIdeas }));
  });

  pi.on("before_agent_start", async (event: any, ctx: ExtensionContext) => {
    if (!autoresearchMode) return;
    const mdPath = path.join(ctx.cwd, "autoresearch.md");
    const checksPath = path.join(ctx.cwd, "autoresearch.checks.sh");
    const ideasPath = path.join(ctx.cwd, "autoresearch.ideas.md");
    let extra = "\n\n## Autoresearch Mode (ACTIVE)";
    extra += "\nUse init_experiment, run_experiment, and log_experiment for the active experiment loop.";
    extra += `\nRead ${mdPath} at the start of the session and after compaction.`;
    if (fs.existsSync(checksPath)) {
      extra += `\n${checksPath} exists and runs after passing benchmarks. If it fails, log checks_failed instead of keep.`;
    }
    if (fs.existsSync(ideasPath)) {
      extra += `\nCheck ${ideasPath} for promising deferred ideas before repeating old experiments.`;
    }
    return { systemPrompt: event.systemPrompt + extra };
  });

  pi.registerTool({
    name: "init_experiment",
    label: "Init Experiment",
    description: "Initialize autoresearch for the current working directory.",
    promptSnippet: "Initialize the current autoresearch session.",
    promptGuidelines: [
      "Call once before the first baseline run.",
      "Reinitialize only if the optimization target changes."
    ],
    parameters: InitParams,
    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: any, ctx: ExtensionContext) {
      state = await initExperiment(ctx.cwd, params);
      autoresearchMode = true;
      updateWidget(ctx);
      return {
        content: [{ type: "text", text: `✅ Experiment initialized: ${state.name}\nMetric: ${state.metricName} (${state.metricUnit || "unitless"}, ${state.bestDirection} is better)` }],
        details: { state }
      };
    },
    renderCall(args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold(`init_experiment ${args.name ?? ""}`)), 0, 0);
    },
    renderResult(result: any) {
      const item = result.content[0];
      return new Text(item?.type === "text" ? item.text : "", 0, 0);
    }
  });

  pi.registerTool({
    name: "run_experiment",
    label: "Run Experiment",
    description: "Run a benchmark command and capture timing/output.",
    promptSnippet: "Run a benchmark command for autoresearch.",
    promptGuidelines: [
      "Use run_experiment instead of bash for benchmark runs.",
      "Always follow with log_experiment."
    ],
    parameters: RunParams,
    async execute(_id: string, params: any, signal: AbortSignal, onUpdate: any, ctx: ExtensionContext) {
      onUpdate?.({ content: [{ type: "text", text: `Running: ${params.command}` }], details: { phase: "running" } });
      const details = await runExperimentTask({
        cwd: ctx.cwd,
        command: params.command,
        timeoutSeconds: params.timeout_seconds,
        checksTimeoutSeconds: params.checks_timeout_seconds,
        exec: (command: string, args: string[], options: any) => pi.exec(command, args, { ...options, signal })
      });
      lastRunChecks = details.checksPass === null ? null : { pass: details.checksPass, output: details.checksOutput, duration: details.checksDuration };
      let text = details.timedOut
        ? `⏰ TIMEOUT after ${details.durationSeconds.toFixed(1)}s`
        : details.exitCode !== 0
          ? `💥 FAILED (exit code ${details.exitCode}) in ${details.durationSeconds.toFixed(1)}s`
          : `✅ PASSED in ${details.durationSeconds.toFixed(1)}s`;
      if (details.checksTimedOut) text += `\n⏰ CHECKS TIMEOUT after ${details.checksDuration.toFixed(1)}s`;
      if (details.checksPass === false) text += `\n💥 CHECKS FAILED in ${details.checksDuration.toFixed(1)}s`;
      if (state.bestMetric !== null) text += `\n📊 Baseline ${state.metricName}: ${formatNum(state.bestMetric, state.metricUnit)}`;
      text += `\n\nLast 80 lines of output:\n${details.tailOutput}`;
      if (details.checksPass === false) {
        text += `\n\nChecks output:\n${details.checksOutput}`;
      }
      const truncated = truncateTail(text, { maxLines: 150, maxBytes: 40000 });
      return { content: [{ type: "text", text: truncated.content }], details };
    },
    renderCall(args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold(`run_experiment ${args.command ?? ""}`)), 0, 0);
    },
    renderResult(result: any, _options: any, theme: any) {
      const details = result.details;
      if (!details) return new Text("", 0, 0);
      let text = details.passed ? theme.fg("success", `✅ ${details.durationSeconds.toFixed(1)}s`) : theme.fg("error", `💥 ${details.durationSeconds.toFixed(1)}s`);
      if (details.checksPass === true) text += theme.fg("success", ` ✓ checks ${details.checksDuration.toFixed(1)}s`);
      if (details.checksPass === false) text += theme.fg("error", ` ✗ checks ${details.checksDuration.toFixed(1)}s`);
      return new Text(text, 0, 0);
    }
  });

  pi.registerTool({
    name: "log_experiment",
    label: "Log Experiment",
    description: "Log the result of the last experiment and auto-commit keeps.",
    promptSnippet: "Log the last run_experiment result.",
    promptGuidelines: [
      "Always call after run_experiment.",
      "Use keep only for primary-metric improvements.",
      "Use checks_failed if the benchmark passed but autoresearch.checks.sh failed.",
      "If a discarded path is promising later, include idea to append it to autoresearch.ideas.md.",
      "For discard/crash/checks_failed, pass revertWorkingTree: true when you want the tool to reset local changes before the next attempt."
    ],
    parameters: LogParams,
    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: any, ctx: ExtensionContext) {
      try {
        const result = await logExperimentResult({
          cwd: ctx.cwd,
          state,
          params,
          lastRunChecks,
          exec: (command: string, args: string[], options: any) => pi.exec(command, args, options)
        });
        state = result.state;
        experimentsThisSession += 1;
        lastRunChecks = null;
        updateWidget(ctx);
        let text = `Logged #${state.results.length}: ${result.experiment.status} — ${result.experiment.description}`;
        text += `\nBaseline ${state.metricName}: ${formatNum(state.bestMetric, state.metricUnit)}`;
        if (params.idea?.trim()) {
          const ideaResult = await appendIdea(ctx.cwd, params.idea.trim());
          if (ideaResult.updated) text += `\n💡 Added idea to ${path.basename(ideaResult.path)}`;
        }
        if (result.committed) text += `\n📝 Git: committed`;
        else if (params.status === "keep") text += `\n📝 Git: nothing to commit`;
        else text += `\n📝 Git: skipped commit (${params.status})`;
        if (params.status !== "keep" && params.revertWorkingTree) {
          const reverted = await revertExperimentChanges(ctx.cwd, (command: string, args: string[], options: any) => pi.exec(command, args, options));
          text += reverted.reverted ? `\n↩️ Reverted working tree` : `\n⚠️ Revert failed (exit ${reverted.exitCode}): ${reverted.output.slice(0, 200)}`;
        } else if (params.status !== "keep") {
          text += ` — revert with git checkout -- .`;
        }
        return { content: [{ type: "text", text }], details: { experiment: result.experiment, state } };
      } catch (error: any) {
        return { content: [{ type: "text", text: `❌ ${error.message || String(error)}` }], details: {} };
      }
    },
    renderCall(args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold(`log_experiment ${args.status} ${args.description ?? ""}`)), 0, 0);
    },
    renderResult(result: any, _options: any, theme: any) {
      const experiment = result.details?.experiment;
      if (!experiment) {
        const item = result.content[0];
        return new Text(item?.type === "text" ? item.text : "", 0, 0);
      }
      return new Text(`${theme.fg(experiment.status === "keep" ? "success" : experiment.status === "discard" ? "warning" : "error", experiment.status)} ${theme.fg("muted", experiment.description)}`, 0, 0);
    }
  });

  pi.registerShortcut("ctrl+x", {
    description: "Toggle autoresearch dashboard",
    handler: async (ctx: ExtensionContext) => {
      dashboardExpanded = !dashboardExpanded;
      updateWidget(ctx);
    }
  });

  pi.registerShortcut("ctrl+shift+x", {
    description: "Open fullscreen autoresearch dashboard",
    handler: async (ctx: ExtensionContext) => {
      await showFullscreenDashboard(ctx);
    }
  });

  pi.registerCommand("autoresearch-ideas-prune", {
    description: "Prune stale or tried ideas from autoresearch.ideas.md.",
    handler: async (args: string, ctx: any) => {
      const tried = String(args || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const result = await pruneIdeasFile(ctx.cwd, tried);
      if (result.deleted) return "Pruned all ideas and removed autoresearch.ideas.md";
      return `Ideas pruned: remaining ${result.remaining}`;
    }
  });

  pi.registerCommand("autoresearch", {
    description: "Start, stop, clear, or resume autoresearch mode.",
    handler: async (args: string, ctx: any) => {
      const command = String(args || "").trim();
      if (!command) {
        return [
          "Usage: /autoresearch [off|clear|dashboard|<goal>]",
          "",
          "<goal> turns autoresearch mode on and asks the agent to start or resume the loop.",
          "dashboard opens the fullscreen dashboard.",
          "off turns autoresearch mode off.",
          "clear deletes autoresearch.jsonl and turns the mode off."
        ].join("\n");
      }
      if (command === "dashboard") {
        await showFullscreenDashboard(ctx);
        return "Opened autoresearch dashboard";
      }
      if (command === "off") {
        autoresearchMode = false;
        ctx.ui.notify?.("Autoresearch mode OFF", "info");
        return "Autoresearch mode OFF";
      }
      if (command === "clear") {
        const jsonlPath = path.join(ctx.cwd, "autoresearch.jsonl");
        if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath);
        state = defaultState();
        autoresearchMode = false;
        updateWidget(ctx);
        return "Deleted autoresearch.jsonl and turned autoresearch mode OFF";
      }
      autoresearchMode = true;
      ctx.ui.notify?.("Autoresearch mode ON", "info");
      pi.sendUserMessage(`Autoresearch mode active. ${command}. Read autoresearch.md, check autoresearch.ideas.md if present, and continue the experiment loop.`);
      return `Autoresearch mode ON: ${command}`;
    }
  });
}
