import fs from "node:fs";
import path from "node:path";

export function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

export function readMessagesFromSessionFile(sessionFile?: string): any[] {
  if (!sessionFile || !fs.existsSync(sessionFile)) return [];
  const raw = fs.readFileSync(sessionFile, "utf8");
  const messages: any[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.type === "message" && entry.message) {
        messages.push(entry.message);
      }
    } catch {
      // ignore malformed lines
    }
  }
  return messages;
}

export function summarizeMessages(messages: any[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = extractText(message.content || []);
    if (text.trim()) return text.trim();
  }
  return "";
}

export function relativeSessionPath(cwd: string, sessionFile?: string) {
  if (!sessionFile) return undefined;
  try {
    return path.relative(cwd, sessionFile) || path.basename(sessionFile);
  } catch {
    return sessionFile;
  }
}
