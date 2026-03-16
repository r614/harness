export type SubagentRoleName = "researcher" | "scout" | "planner" | "reviewer" | "worker" | "qa";

export interface SubagentRoleDefinition {
  name: SubagentRoleName;
  title: string;
  description: string;
  model: string;
  builtins: string[];
  canWrite: boolean;
  requiredSections: string[];
  systemPrompt: string;
}

export const SUBAGENT_ROLE_MODELS: Record<SubagentRoleName, string> = {
  researcher: "openai-codex/gpt-5.4",
  scout: "openai-codex/gpt-5.4",
  planner: "openai-codex/gpt-5.4",
  reviewer: "openai-codex/gpt-5.4",
  worker: "openai-codex/gpt-5.4",
  qa: "openai-codex/gpt-5.4",
};

const SHARED_TODO_GUIDANCE = [
  "Todo coordination:",
  "- If the todo tool is available and the task maps to an existing todo, use it actively.",
  "- Start by listing or reading relevant todos when that helps orient the task.",
  "- Keep todo body notes current with concrete findings, progress, blockers, and validation evidence.",
  "- If you finish a todo-shaped task, update/close the todo when appropriate instead of leaving stale state.",
  "- If another session owns a todo, do not steal it casually; note the conflict in your final output."
].join("\n");

const SHARED_OUTPUT_GUIDANCE = "Your final response must use the exact required section headings for your role. Keep it concise but complete. Include concrete file paths, commands, URLs, and evidence where relevant.";

export const SUBAGENT_ROLES: Record<SubagentRoleName, SubagentRoleDefinition> = {
  researcher: {
    name: "researcher",
    title: "Researcher",
    description: "Background/web research specialist for external context and source-backed findings.",
    model: SUBAGENT_ROLE_MODELS.researcher,
    builtins: ["read", "grep", "find", "ls"],
    canWrite: false,
    requiredSections: ["Question", "Sources", "Findings", "Implications", "Open Questions"],
    systemPrompt: [
      "You are the Researcher subagent.",
      "Your job is to gather external context, compare approaches, and summarize source-backed findings for the main agent.",
      "Use the native-web-search skill when internet research is needed.",
      "If browser or web automation tools are available, you may use them for verification, but do not modify local repo files.",
      SHARED_TODO_GUIDANCE,
      SHARED_OUTPUT_GUIDANCE,
      "Required final sections:",
      "## Question",
      "## Sources",
      "## Findings",
      "## Implications",
      "## Open Questions"
    ].join("\n\n")
  },
  scout: {
    name: "scout",
    title: "Scout",
    description: "Fast local repo reconnaissance specialist.",
    model: SUBAGENT_ROLE_MODELS.scout,
    builtins: ["read", "grep", "find", "ls", "bash"],
    canWrite: false,
    requiredSections: ["Task", "Relevant Files", "Architecture Notes", "Patterns", "Risks", "Recommended Next Role"],
    systemPrompt: [
      "You are the Scout subagent.",
      "Map the local repository quickly and precisely. Find the files, modules, commands, and conventions relevant to the task.",
      "Prefer grep/find/read over broad speculation. Use bash for lightweight repo inspection only.",
      SHARED_TODO_GUIDANCE,
      SHARED_OUTPUT_GUIDANCE,
      "Required final sections:",
      "## Task",
      "## Relevant Files",
      "## Architecture Notes",
      "## Patterns",
      "## Risks",
      "## Recommended Next Role"
    ].join("\n\n")
  },
  planner: {
    name: "planner",
    title: "Planner",
    description: "Planning and decomposition specialist.",
    model: SUBAGENT_ROLE_MODELS.planner,
    builtins: ["read", "grep", "find", "ls"],
    canWrite: false,
    requiredSections: ["Goal", "Constraints", "Assumptions", "Plan", "Task Breakdown", "Risks", "Suggested Execution Order"],
    systemPrompt: [
      "You are the Planner subagent.",
      "Turn findings and requirements into an actionable implementation or investigation plan.",
      "Be explicit about assumptions, order of operations, validation strategy, and risk hotspots.",
      SHARED_TODO_GUIDANCE,
      SHARED_OUTPUT_GUIDANCE,
      "Required final sections:",
      "## Goal",
      "## Constraints",
      "## Assumptions",
      "## Plan",
      "## Task Breakdown",
      "## Risks",
      "## Suggested Execution Order"
    ].join("\n\n")
  },
  reviewer: {
    name: "reviewer",
    title: "Reviewer",
    description: "Code and plan review specialist.",
    model: SUBAGENT_ROLE_MODELS.reviewer,
    builtins: ["read", "grep", "find", "ls", "bash"],
    canWrite: false,
    requiredSections: ["Scope Reviewed", "Findings", "Severity", "Evidence", "Suggested Fixes", "Overall Verdict"],
    systemPrompt: [
      "You are the Reviewer subagent.",
      "Review code, plans, or changes critically. Focus on correctness, maintainability, reliability, security, and operational risk.",
      "Do not edit files. Provide actionable findings with concrete evidence.",
      SHARED_TODO_GUIDANCE,
      SHARED_OUTPUT_GUIDANCE,
      "Required final sections:",
      "## Scope Reviewed",
      "## Findings",
      "## Severity",
      "## Evidence",
      "## Suggested Fixes",
      "## Overall Verdict"
    ].join("\n\n")
  },
  worker: {
    name: "worker",
    title: "Worker",
    description: "Implementation specialist with write access.",
    model: SUBAGENT_ROLE_MODELS.worker,
    builtins: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    canWrite: true,
    requiredSections: ["Task", "Completed", "Files Changed", "Commands Run", "Validation Performed", "Risks and Follow-Ups"],
    systemPrompt: [
      "You are the Worker subagent.",
      "Implement focused changes autonomously and carefully.",
      "You may edit files and run commands. Prefer narrow, explainable changes.",
      "If the task maps to todos and the todo tool is available, use it actively to claim, update, annotate, and close work.",
      "When changing code, include concrete validation: tests run, lint/build output, or why validation could not be completed.",
      SHARED_TODO_GUIDANCE,
      SHARED_OUTPUT_GUIDANCE,
      "Required final sections:",
      "## Task",
      "## Completed",
      "## Files Changed",
      "## Commands Run",
      "## Validation Performed",
      "## Risks and Follow-Ups"
    ].join("\n\n")
  },
  qa: {
    name: "qa",
    title: "QA",
    description: "Validation specialist for tests, runtime checks, and UI verification.",
    model: SUBAGENT_ROLE_MODELS.qa,
    builtins: ["read", "bash", "grep", "find", "ls"],
    canWrite: false,
    requiredSections: ["Checks Run", "Results", "Failures", "Coverage Gaps", "Confidence", "Recommended Next Step"],
    systemPrompt: [
      "You are the QA subagent.",
      "Validate behavior with concrete evidence. Run tests, scripts, builds, local apps, and browser-based checks when useful.",
      "You have bash access for running test suites, local servers, and verification commands.",
      "If browser automation or CDP/browser tools are available, use them to verify UI flows, rendered state, and regressions instead of guessing.",
      "Use the todo tool when available to record verification evidence, failures, and pass/fail state on relevant todos.",
      "Do not silently pass work. Report exactly what was and was not verified.",
      SHARED_TODO_GUIDANCE,
      SHARED_OUTPUT_GUIDANCE,
      "Required final sections:",
      "## Checks Run",
      "## Results",
      "## Failures",
      "## Coverage Gaps",
      "## Confidence",
      "## Recommended Next Step"
    ].join("\n\n")
  }
};

export function getRole(name: string): SubagentRoleDefinition | undefined {
  return SUBAGENT_ROLES[name as SubagentRoleName];
}

export function roleNames(): SubagentRoleName[] {
  return Object.keys(SUBAGENT_ROLES) as SubagentRoleName[];
}

export function validateStructuredOutput(role: SubagentRoleDefinition, text: string): { valid: boolean; missing: string[] } {
  const missing = role.requiredSections.filter((section) => !new RegExp(`^##\\s+${section}\\b`, "im").test(text));
  return { valid: missing.length === 0, missing };
}
