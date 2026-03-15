import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function detectMetricUnit(name = "") {
  if (name.endsWith("_µs") || name.includes("µs")) return "µs";
  if (name.endsWith("_ms") || name.includes("ms")) return "ms";
  if (name.endsWith("_s") || name.includes("sec")) return "s";
  if (name.endsWith("_kb") || name.includes("kb")) return "kb";
  if (name.endsWith("_mb") || name.includes("mb")) return "mb";
  return "";
}

export function defaultState() {
  return {
    results: [],
    bestMetric: null,
    bestDirection: "lower",
    metricName: "metric",
    metricUnit: "",
    secondaryMetrics: [],
    name: null,
    currentSegment: 0
  };
}

export function currentResults(results, segment) {
  return results.filter((r) => r.segment === segment);
}

export function findBaselineMetric(results, segment) {
  const current = currentResults(results, segment);
  return current.length > 0 ? current[0].metric : null;
}

export function findBaselineSecondary(results, segment, knownMetrics = []) {
  const current = currentResults(results, segment);
  const baseline = current.length > 0 ? { ...(current[0].metrics ?? {}) } : {};
  for (const metric of knownMetrics) {
    if (baseline[metric.name] !== undefined) continue;
    for (const result of current) {
      const value = (result.metrics ?? {})[metric.name];
      if (value !== undefined) {
        baseline[metric.name] = value;
        break;
      }
    }
  }
  return baseline;
}

export function isBetter(current, best, direction) {
  return direction === "lower" ? current < best : current > best;
}

export function reconstructStateFromJsonlContent(content) {
  const state = defaultState();
  let segment = 0;
  const lines = String(content || "").split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "config") {
      if (entry.name) state.name = entry.name;
      if (entry.metricName) state.metricName = entry.metricName;
      if (entry.metricUnit !== undefined) state.metricUnit = entry.metricUnit;
      if (entry.bestDirection === "lower" || entry.bestDirection === "higher") {
        state.bestDirection = entry.bestDirection;
      }
      if (state.results.length > 0) segment += 1;
      state.currentSegment = segment;
      continue;
    }

    const result = {
      commit: entry.commit ?? "",
      metric: Number(entry.metric ?? 0),
      metrics: entry.metrics ?? {},
      status: entry.status ?? "keep",
      description: entry.description ?? "",
      timestamp: Number(entry.timestamp ?? 0),
      segment
    };
    state.results.push(result);

    for (const name of Object.keys(result.metrics)) {
      if (!state.secondaryMetrics.find((metric) => metric.name === name)) {
        state.secondaryMetrics.push({ name, unit: detectMetricUnit(name) });
      }
    }
  }

  state.bestMetric = findBaselineMetric(state.results, state.currentSegment);
  return state;
}

export async function reconstructState(cwd) {
  const jsonlPath = path.join(cwd, "autoresearch.jsonl");
  const content = await fsp.readFile(jsonlPath, "utf8").catch(() => "");
  return reconstructStateFromJsonlContent(content);
}

export async function initExperiment(cwd, params) {
  const existing = await reconstructState(cwd);
  const isReinit = existing.results.length > 0;
  const nextSegment = isReinit ? existing.currentSegment + 1 : 0;
  const config = {
    type: "config",
    name: params.name,
    metricName: params.metric_name,
    metricUnit: params.metric_unit ?? "",
    bestDirection: params.direction === "higher" ? "higher" : "lower"
  };
  const jsonlPath = path.join(cwd, "autoresearch.jsonl");
  const serialized = `${JSON.stringify(config)}\n`;
  if (isReinit && fs.existsSync(jsonlPath)) {
    await fsp.appendFile(jsonlPath, serialized);
  } else {
    await fsp.writeFile(jsonlPath, serialized);
  }
  return {
    ...defaultState(),
    name: config.name,
    metricName: config.metricName,
    metricUnit: config.metricUnit,
    bestDirection: config.bestDirection,
    currentSegment: nextSegment
  };
}

export async function runExperimentTask({
  cwd,
  command,
  timeoutSeconds = 600,
  checksTimeoutSeconds = 300,
  exec
}) {
  const executor = exec ?? defaultExec;
  const start = Date.now();
  const result = await executor("bash", ["-c", command], { cwd, timeout: timeoutSeconds * 1000 });
  const durationSeconds = (Date.now() - start) / 1000;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const benchmarkPassed = result.code === 0 && !result.killed;

  let checksPass = null;
  let checksTimedOut = false;
  let checksOutput = "";
  let checksDuration = 0;
  const checksPath = path.join(cwd, "autoresearch.checks.sh");

  if (benchmarkPassed && fs.existsSync(checksPath)) {
    const checksStart = Date.now();
    const checksResult = await executor("bash", [checksPath], { cwd, timeout: checksTimeoutSeconds * 1000 });
    checksDuration = (Date.now() - checksStart) / 1000;
    checksTimedOut = !!checksResult.killed;
    checksPass = checksResult.code === 0 && !checksResult.killed;
    checksOutput = `${checksResult.stdout ?? ""}\n${checksResult.stderr ?? ""}`.trim();
  }

  return {
    command,
    exitCode: result.code,
    durationSeconds,
    passed: benchmarkPassed && (checksPass === null || checksPass),
    crashed: !(benchmarkPassed && (checksPass === null || checksPass)),
    timedOut: !!result.killed,
    tailOutput: output.split(/\r?\n/).slice(-80).join("\n"),
    checksPass,
    checksTimedOut,
    checksOutput: checksOutput.split(/\r?\n/).slice(-80).join("\n"),
    checksDuration
  };
}

export async function logExperimentResult({
  cwd,
  state,
  params,
  lastRunChecks = null,
  exec
}) {
  const executor = exec ?? defaultExec;
  if (params.status === "keep" && lastRunChecks && lastRunChecks.pass === false) {
    throw new Error("Cannot keep experiment because autoresearch.checks.sh failed");
  }

  const secondaryMetrics = params.metrics ?? {};
  if (state.secondaryMetrics.length > 0) {
    const known = new Set(state.secondaryMetrics.map((metric) => metric.name));
    const provided = new Set(Object.keys(secondaryMetrics));
    const missing = [...known].filter((name) => !provided.has(name));
    if (missing.length > 0) {
      throw new Error(`Missing secondary metrics: ${missing.join(", ")}`);
    }
    const added = [...provided].filter((name) => !known.has(name));
    if (added.length > 0 && !params.force) {
      throw new Error(`New secondary metrics require force: ${added.join(", ")}`);
    }
  }

  const experiment = {
    commit: String(params.commit || "").slice(0, 7),
    metric: Number(params.metric ?? 0),
    metrics: secondaryMetrics,
    status: params.status,
    description: params.description,
    timestamp: Date.now(),
    segment: state.currentSegment
  };

  const nextState = {
    ...state,
    results: [...state.results, experiment],
    secondaryMetrics: [...state.secondaryMetrics]
  };

  for (const name of Object.keys(secondaryMetrics)) {
    if (!nextState.secondaryMetrics.find((metric) => metric.name === name)) {
      nextState.secondaryMetrics.push({ name, unit: detectMetricUnit(name) });
    }
  }
  nextState.bestMetric = findBaselineMetric(nextState.results, nextState.currentSegment);

  let committed = false;
  let commitOutput = "";
  if (params.status === "keep") {
    const resultData = {
      status: params.status,
      [nextState.metricName || "metric"]: params.metric,
      ...secondaryMetrics
    };
    const message = `${params.description}\n\nResult: ${JSON.stringify(resultData)}`;
    const gitResult = await executor(
      "bash",
      ["-c", `git add -A && git diff --cached --quiet && echo NOTHING_TO_COMMIT || git commit -m ${JSON.stringify(message)}`],
      { cwd, timeout: 10000 }
    );
    commitOutput = `${gitResult.stdout ?? ""}${gitResult.stderr ?? ""}`.trim();
    if (gitResult.code === 0 && !commitOutput.includes("NOTHING_TO_COMMIT")) {
      committed = true;
      const shaResult = await executor("git", ["rev-parse", "--short=7", "HEAD"], { cwd, timeout: 5000 });
      const newSha = String(shaResult.stdout ?? "").trim();
      if (newSha) {
        experiment.commit = newSha;
        nextState.results[nextState.results.length - 1].commit = newSha;
      }
    }
  }

  const jsonlPath = path.join(cwd, "autoresearch.jsonl");
  await fsp.appendFile(jsonlPath, JSON.stringify({ run: nextState.results.length, ...experiment }) + "\n");

  return { state: nextState, experiment, committed, commitOutput };
}

export async function createTempGitRepo() {
  const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "harness-autoresearch-"));
  await defaultExec("git", ["init"], { cwd, timeout: 10000 });
  await defaultExec("git", ["config", "user.name", "Harness Evals"], { cwd, timeout: 10000 });
  await defaultExec("git", ["config", "user.email", "harness@example.com"], { cwd, timeout: 10000 });
  await fsp.writeFile(path.join(cwd, "README.md"), "# temp\n");
  await defaultExec("git", ["add", "README.md"], { cwd, timeout: 10000 });
  await defaultExec("git", ["commit", "-m", "init"], { cwd, timeout: 10000 });
  return cwd;
}

export function formatNum(value, unit = "") {
  if (value === null || value === undefined) return "—";
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${rounded}${unit}`;
}

export function shouldAutoResume({
  autoresearchMode,
  experimentsThisSession,
  now,
  lastAutoResumeTime,
  autoResumeTurns,
  maxAutoResumeTurns = 20,
  minIntervalMs = 5 * 60 * 1000
}) {
  if (!autoresearchMode) return { resume: false, reason: "mode_off" };
  if (!experimentsThisSession || experimentsThisSession <= 0) return { resume: false, reason: "no_experiments" };
  if (autoResumeTurns >= maxAutoResumeTurns) return { resume: false, reason: "turn_limit" };
  if (lastAutoResumeTime && now - lastAutoResumeTime < minIntervalMs) return { resume: false, reason: "rate_limited" };
  return { resume: true, reason: "ok" };
}

export function buildResumeMessage({ hasIdeas = false } = {}) {
  let message = "Autoresearch loop ended (likely context limit). Resume the experiment loop — read autoresearch.md and git log for context.";
  if (hasIdeas) {
    message += " Check autoresearch.ideas.md for promising paths to explore. Prune stale or already-tried ideas.";
  }
  message += " Be careful not to overfit to the benchmark or cheat on it.";
  return message;
}

export function normalizeIdeasContent(content = "") {
  return String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("-") ? line : `- ${line.replace(/^[-*+]\s*/, "")}`));
}

export function pruneIdeasContent(content = "", tried = []) {
  const triedNormalized = tried.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  const seen = new Set();
  const kept = [];
  for (const line of normalizeIdeasContent(content)) {
    const normalized = line.replace(/^[-*+]\s*/, "").trim();
    const key = normalized.toLowerCase();
    if (!normalized) continue;
    if (seen.has(key)) continue;
    if (triedNormalized.some((item) => key.includes(item) || item.includes(key))) continue;
    seen.add(key);
    kept.push(`- ${normalized}`);
  }
  return kept.join("\n") + (kept.length ? "\n" : "");
}

export async function appendIdea(cwd, idea) {
  const normalized = pruneIdeasContent(`- ${idea}\n`, []);
  if (!normalized.trim()) return { updated: false, path: path.join(cwd, "autoresearch.ideas.md") };
  const ideasPath = path.join(cwd, "autoresearch.ideas.md");
  const existing = await fsp.readFile(ideasPath, "utf8").catch(() => "");
  const merged = pruneIdeasContent(`${existing}${existing.endsWith("\n") || !existing ? "" : "\n"}${normalized}`, []);
  const updated = merged !== existing;
  if (updated) await fsp.writeFile(ideasPath, merged);
  return { updated, path: ideasPath };
}

export async function pruneIdeasFile(cwd, tried = []) {
  const ideasPath = path.join(cwd, "autoresearch.ideas.md");
  const existing = await fsp.readFile(ideasPath, "utf8").catch(() => "");
  const pruned = pruneIdeasContent(existing, tried);
  if (pruned) {
    await fsp.writeFile(ideasPath, pruned);
    return { removed: existing !== pruned, remaining: normalizeIdeasContent(pruned).length, deleted: false, path: ideasPath };
  }
  if (existing) {
    await fsp.rm(ideasPath, { force: true });
    return { removed: true, remaining: 0, deleted: true, path: ideasPath };
  }
  return { removed: false, remaining: 0, deleted: false, path: ideasPath };
}

export async function revertExperimentChanges(cwd, exec) {
  const executor = exec ?? defaultExec;
  const result = await executor("git", ["checkout", "--", "."], { cwd, timeout: 10000 });
  return {
    reverted: result.code === 0,
    exitCode: result.code,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  };
}

async function defaultExec(command, args, options = {}) {
  const { spawn } = await import("node:child_process");
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timeout = options.timeout
      ? setTimeout(() => {
          killed = child.kill("SIGTERM");
        }, options.timeout)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ stdout, stderr, code, killed });
    });
  });
}
