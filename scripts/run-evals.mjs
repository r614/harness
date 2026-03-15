import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareAction } from "../extensions/repo-operator.mjs";
import { buildPrPayload } from "./open-pr.mjs";
import { runWorkspaceTask } from "./google-workspace.mjs";
import { isRiskyTarget } from "./browser-runtime.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function stableStringify(value) {
  return JSON.stringify(value, null, 2);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadJson(relativePath) {
  const raw = await fs.readFile(path.join(ROOT, relativePath), "utf8");
  return JSON.parse(raw);
}

function assertStructuredSummary(summary) {
  assert(typeof summary.problemStatement === "string" && summary.problemStatement.length > 0, "missing problemStatement");
  assert(Array.isArray(summary.changedFiles), "missing changedFiles");
  assert(Array.isArray(summary.evidence), "missing evidence");
  assert(typeof summary.riskClassification === "string" && summary.riskClassification.length > 0, "missing riskClassification");
  assert(Array.isArray(summary.requiredChecks) && summary.requiredChecks.length > 0, "missing requiredChecks");
  assert(typeof summary.rollbackGuidance === "string" && summary.rollbackGuidance.length > 0, "missing rollbackGuidance");
}

function assertExpectedSubset(actual, expected, pathPrefix = "expect") {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    const keyPath = `${pathPrefix}.${key}`;

    if (Array.isArray(expectedValue)) {
      assert(Array.isArray(actualValue), `${keyPath} should be an array`);
      assert(
        stableStringify(actualValue) === stableStringify(expectedValue),
        `${keyPath} mismatch. expected ${stableStringify(expectedValue)}, got ${stableStringify(actualValue)}`
      );
      continue;
    }

    if (expectedValue && typeof expectedValue === "object") {
      assert(actualValue && typeof actualValue === "object", `${keyPath} should be an object`);
      assertExpectedSubset(actualValue, expectedValue, keyPath);
      continue;
    }

    assert(actualValue === expectedValue, `${keyPath} mismatch. expected ${expectedValue}, got ${actualValue}`);
  }
}

async function runSelfImprovementCase(testCase) {
  const input = await loadJson(testCase.input);
  const prepared = await prepareAction(input, { repoRoot: ROOT });
  assertStructuredSummary(prepared.payload);
  assertExpectedSubset(prepared.payload, testCase.expect);

  if (testCase.expectChangedFilesFromInput) {
    assert(
      stableStringify(prepared.payload.changedFiles) === stableStringify(input.files),
      "changedFiles should match fixture input"
    );
  }

  return { name: testCase.name, status: "pass" };
}

async function runOpenPrCase(testCase) {
  const input = await loadJson(testCase.input);
  const payload = await buildPrPayload(input, { repoRoot: ROOT });
  assertStructuredSummary(payload);
  assertExpectedSubset(payload, testCase.expect);

  return { name: testCase.name, status: "pass" };
}

function classifyBrowserTask(task) {
  const classification = task.mode === "side_effect" ? "side_effect" : "read_only";
  const approvalRequired = classification === "side_effect" || task.requiresApproval === true;
  return { classification, approvalRequired };
}

async function runBrowserCase(testCase) {
  const input = await loadJson(testCase.input);
  assert(typeof input.goal === "string" && input.goal.length > 0, "browser task goal is required");
  const actual = classifyBrowserTask(input);
  assertExpectedSubset(actual, testCase.expect);
  return { name: testCase.name, status: "pass" };
}

async function runBrowserRuntimeCase(testCase) {
  if (testCase.name === "named-session-reuse-preserves-target") {
    const { HarnessBrowserRuntime } = await import("./browser-runtime.mjs");
    const runtime = new HarnessBrowserRuntime();
    runtime.startChrome = async () => ({ running: true });
    runtime.navigate = async () => ({ action: "navigate", approvalRequired: false });

    let targetCount = 0;
    const originalFetch = global.fetch;
    global.fetch = async (url) => ({
      ok: true,
      async json() {
        if (String(url).includes("/json/new")) {
          targetCount += 1;
          return { id: `target-${targetCount}`, webSocketDebuggerUrl: `ws://example/${targetCount}` };
        }
        return {};
      }
    });

    try {
      const first = await runtime.createSession({ sessionId: "same", url: "about:blank" });
      const second = await runtime.createSession({ sessionId: "same", url: "about:blank" });
      assertExpectedSubset(
        {
          sameTarget: first.targetId === second.targetId,
          reused: second.reused === true
        },
        testCase.expect
      );
      return { name: testCase.name, status: "pass" };
    } finally {
      global.fetch = originalFetch;
    }
  }

  const snapshot = await loadJson(testCase.input);
  if (testCase.name === "page-model-risk-classification") {
    const riskyRefs = snapshot.actionable.filter((target) => isRiskyTarget(target)).map((target) => target.ref);
    const readOnlyRefs = snapshot.actionable.filter((target) => !isRiskyTarget(target)).map((target) => target.ref);
    assertExpectedSubset({ riskyRefs, readOnlyRefs }, testCase.expect);
    return { name: testCase.name, status: "pass" };
  }

  if (testCase.name === "approval-required-for-click-on-risky-target") {
    const target = snapshot.actionable.find((item) => item.ref === testCase.expect.targetRef);
    assert(target, "target ref not found in fixture snapshot");
    assertExpectedSubset({ approvalRequired: isRiskyTarget(target), targetRef: target.ref }, testCase.expect);
    return { name: testCase.name, status: "pass" };
  }

  throw new Error(`Unsupported browser runtime case: ${testCase.name}`);
}

async function loadFixtureMap(fixtures = {}) {
  const entries = await Promise.all(
    Object.entries(fixtures).map(async ([operation, fixturePath]) => [operation, await loadJson(fixturePath)])
  );
  return Object.fromEntries(entries);
}

function projectWorkspaceResult(result, testCase) {
  if (testCase.kind === "gmail.search") {
    return {
      action: result.action,
      threadCount: result.threads.length,
      firstThreadId: result.threads[0]?.threadId || ""
    };
  }

  if (testCase.kind === "gmail.draftReply") {
    return {
      action: result.action,
      approvalRequiredToSend: result.approvalRequiredToSend,
      draftResultStatus: result.draftResult?.id ? "draft_created" : result.draftResult?.status || ""
    };
  }

  if (testCase.kind === "gmail.archive") {
    return {
      action: result.action,
      executed: result.executed,
      approvalRequired: result.approvalRequired,
      archiveStatus: result.archiveResult?.id || result.archiveResult?.threadId ? "archived" : result.archiveResult?.status || "",
      classificationIsLowValue: result.classification?.isLowValue || false
    };
  }

  if (testCase.kind === "gmail.prepareUnsubscribe") {
    return {
      action: result.action,
      approvalRequired: result.approvalRequired,
      unsubscribeMethod: result.unsubscribe?.method || "",
      unsubscribeUrl: result.unsubscribe?.url || ""
    };
  }

  if (testCase.kind === "calendar.listUpcoming") {
    return {
      action: result.action,
      count: result.count,
      firstEventId: result.events[0]?.eventId || ""
    };
  }

  if (testCase.kind === "calendar.draftEvent") {
    return {
      action: result.action,
      approvalRequired: result.approvalRequired,
      summary: result.eventDraft?.summary || ""
    };
  }

  if (testCase.kind === "calendar.applyDraft") {
    return {
      action: result.action,
      executed: result.executed,
      eventId: result.event?.eventId || ""
    };
  }

  return result;
}

async function runWorkspaceCase(testCase) {
  const fixtures = await loadFixtureMap(testCase.fixtures || {});
  const result = await runWorkspaceTask(testCase.input ? { kind: testCase.kind, ...testCase.input } : { kind: testCase.kind }, {
    cwd: ROOT,
    transport: "fixture",
    fixtures
  });
  const projected = projectWorkspaceResult(result, testCase);
  assertExpectedSubset(projected, testCase.expect);
  return { name: testCase.name, status: "pass" };
}

async function runSuite(casesPath, runner) {
  const cases = await loadJson(casesPath);
  const results = [];

  for (const testCase of cases) {
    try {
      results.push(await runner(testCase));
    } catch (error) {
      results.push({
        name: testCase.name,
        status: "fail",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

async function main() {
  console.log("Harness evals");

  const suiteResults = {
    "self-improvement": await runSuite("evals/self-improvement/cases.json", async (testCase) => {
      const runner = testCase.runner === "open-pr" ? runOpenPrCase : runSelfImprovementCase;
      return runner(testCase);
    }),
    browser: await runSuite("evals/browser/cases.json", runBrowserCase),
    "browser-runtime": await runSuite("evals/browser-runtime/cases.json", runBrowserRuntimeCase),
    gmail: await runSuite("evals/gmail/cases.json", runWorkspaceCase),
    calendar: await runSuite("evals/calendar/cases.json", runWorkspaceCase)
  };

  let failures = 0;

  for (const [suiteName, results] of Object.entries(suiteResults)) {
    const passes = results.filter((result) => result.status === "pass").length;
    const suiteFailures = results.filter((result) => result.status === "fail");
    failures += suiteFailures.length;

    const statusParts = [];
    if (passes > 0) {
      statusParts.push(`${passes} passed`);
    }
    if (suiteFailures.length > 0) {
      statusParts.push(`${suiteFailures.length} failed`);
    }

    console.log(`- ${suiteName}: ${statusParts.join(", ") || "no cases"}`);

    for (const result of suiteFailures) {
      console.log(`  - ${result.name}: ${result.error}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
