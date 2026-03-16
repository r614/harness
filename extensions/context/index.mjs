import fs from "node:fs/promises";
import path from "node:path";

export function listCapabilities() {
  return ["read_context", "write_memory", "summarize_history"];
}

export async function read(resourceId, config) {
  const filePath = path.join(config.memoryDir, resourceId);
  const content = await fs.readFile(filePath, "utf8");
  return { resourceId, content };
}

export async function prepareAction(input) {
  return {
    type: "memory_write",
    summary: `Write memory entry ${input.resourceId}`,
    sideEffects: ["updates durable memory"],
    reversible: true,
    payload: input
  };
}

export async function executeAction(preparedAction) {
  return {
    status: "not_implemented",
    preparedAction
  };
}

export async function search(query) {
  return {
    query,
    matches: [],
    note: "Runtime search is provided by the host Pi app."
  };
}

export async function listArtifacts() {
  return [];
}
