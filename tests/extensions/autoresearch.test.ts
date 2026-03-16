import { describe, expect, it } from "vitest";
import {
  appendIdea,
  buildResumeMessage,
  detectMetricUnit,
  findBaselineSecondary,
  normalizeIdeasContent,
  pruneIdeasContent,
  reconstructStateFromJsonlContent,
  shouldAutoResume
} from "../../scripts/autoresearch.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("autoresearch helpers", () => {
  it("reconstructs state from jsonl content", () => {
    const state = reconstructStateFromJsonlContent([
      JSON.stringify({ type: "config", name: "Bench", metricName: "latency_ms", metricUnit: "ms", bestDirection: "lower" }),
      JSON.stringify({ run: 1, commit: "abc1234", metric: 100, metrics: { throughput_mb: 12 }, status: "keep", description: "baseline" }),
      JSON.stringify({ run: 2, commit: "def5678", metric: 95, metrics: { throughput_mb: 13 }, status: "keep", description: "improved" })
    ].join("\n"));

    expect(state.name).toBe("Bench");
    expect(state.bestMetric).toBe(100);
    expect(findBaselineSecondary(state.results, state.currentSegment, state.secondaryMetrics)).toEqual({ throughput_mb: 12 });
  });

  it("normalizes and prunes ideas content", () => {
    const normalized = normalizeIdeasContent("idea one\n- idea two\n");
    expect(normalized).toEqual(["- idea one", "- idea two"]);

    const pruned = pruneIdeasContent("- idea one\n- idea one\n- later attempt\n", ["later"]);
    expect(pruned).toBe("- idea one\n");
  });

  it("appends deduplicated ideas to disk", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "harness-ideas-"));
    await appendIdea(cwd, "try caching");
    await appendIdea(cwd, "try caching");
    const content = await fs.readFile(path.join(cwd, "autoresearch.ideas.md"), "utf8");
    expect(content).toBe("- try caching\n");
  });

  it("computes resume policy and copy", () => {
    expect(shouldAutoResume({ autoresearchMode: true, experimentsThisSession: 1, now: 1000, lastAutoResumeTime: 0, autoResumeTurns: 0 }).resume).toBe(true);
    expect(shouldAutoResume({ autoresearchMode: false, experimentsThisSession: 1, now: 1000, lastAutoResumeTime: 0, autoResumeTurns: 0 }).resume).toBe(false);
    expect(buildResumeMessage({ hasIdeas: true })).toContain("autoresearch.ideas.md");
  });

  it("detects metric units", () => {
    expect(detectMetricUnit("latency_ms")).toBe("ms");
    expect(detectMetricUnit("throughput_mb")).toBe("mb");
  });
});
