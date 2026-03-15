import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST_PATH = path.join(ROOT, "manifests", "google-workspace.json");

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  return readJson(manifestPath);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlaceholder(value) {
  return typeof value === "string" && /^\{.+\}$/.test(value);
}

function substituteValue(template, values) {
  if (typeof template === "string") {
    const match = /^\{(.+)\}$/.exec(template);
    if (!match) return template;
    const value = values[match[1]];
    return value === undefined ? undefined : value;
  }

  if (Array.isArray(template)) {
    const result = template
      .map((item) => substituteValue(item, values))
      .filter((item) => item !== undefined && item !== null && item !== "");
    return result;
  }

  if (template && typeof template === "object") {
    const result = {};
    for (const [key, value] of Object.entries(template)) {
      const substituted = substituteValue(value, values);
      if (substituted === undefined || substituted === null || substituted === "") continue;
      result[key] = substituted;
    }
    return result;
  }

  return template;
}

function parseJsonOutput(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function getHeader(message, key) {
  const lowerKey = key.toLowerCase();
  const headers = message.headers || message.payload?.headers || {};
  if (Array.isArray(headers)) {
    const match = headers.find((header) => String(header.name || header.key || "").toLowerCase() === lowerKey);
    return match ? String(match.value || "") : "";
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === lowerKey) return String(value || "");
  }
  return "";
}

function decodeBase64Url(data = "") {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function extractTextBody(payload = {}) {
  if (payload?.mimeType === "text/plain" && payload?.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  for (const part of toArray(payload.parts)) {
    const text = extractTextBody(part);
    if (text) return text;
  }

  return "";
}

function normalizeMessage(message = {}) {
  const payload = message.payload || {};
  return {
    id: message.id || message.messageId || "",
    threadId: message.threadId || "",
    from: message.from || getHeader(message, "from"),
    to: message.to || getHeader(message, "to"),
    subject: message.subject || getHeader(message, "subject"),
    snippet: message.snippet || message.preview || message.bodySnippet || "",
    textBody: message.textBody || message.body || message.text || extractTextBody(payload),
    internalDate: message.internalDate || message.date || getHeader(message, "date") || "",
    listId: message.listId || getHeader(message, "list-id"),
    listUnsubscribe: message.listUnsubscribe || getHeader(message, "list-unsubscribe"),
    messageIdHeader: getHeader(message, "message-id"),
    references: getHeader(message, "references"),
    labelIds: toArray(message.labelIds)
  };
}

function normalizeThread(raw = {}) {
  const messages = toArray(raw.messages).map(normalizeMessage);
  const latest = messages[messages.length - 1] || normalizeMessage(raw.latestMessage || {});
  const labels = toArray(raw.labels || raw.labelIds || latest.labelIds);
  return {
    threadId: raw.threadId || raw.id || latest.threadId || "",
    subject: raw.subject || latest.subject || "",
    snippet: raw.snippet || latest.snippet || "",
    participants: toArray(raw.participants).length > 0 ? toArray(raw.participants) : [latest.from].filter(Boolean),
    labels,
    messageCount: messages.length || Number(raw.messageCount || 0),
    messages,
    latestMessage: latest,
    unread: Boolean(raw.unread || labels.includes("UNREAD")),
    important: Boolean(raw.important || labels.includes("IMPORTANT")),
    starred: Boolean(raw.starred || labels.includes("STARRED"))
  };
}

function summarizeThread(thread) {
  const latest = thread.latestMessage || {};
  return {
    threadId: thread.threadId,
    subject: thread.subject,
    participants: thread.participants,
    messageCount: thread.messageCount,
    latestFrom: latest.from || "",
    latestSnippet: latest.snippet || thread.snippet,
    needsReply: !thread.labels.includes("SENT") && !thread.labels.includes("DRAFT"),
    unread: thread.unread
  };
}

function classifyLowValueThread(thread) {
  const latest = thread.latestMessage || {};
  const haystack = [thread.subject, thread.snippet, latest.snippet, latest.from, latest.listId].join(" ").toLowerCase();
  const reasons = [];

  if (latest.listUnsubscribe) reasons.push("has-list-unsubscribe");
  if (latest.listId) reasons.push("has-list-id");
  if (/(newsletter|digest|promo|promotion|deal|sale|coupon|unsubscribe)/.test(haystack)) reasons.push("marketing-keywords");
  if (thread.labels.includes("CATEGORY_PROMOTIONS") || thread.labels.includes("CATEGORY_SOCIAL")) reasons.push("bulk-category");

  const explicit = reasons.length > 0 && !thread.important && !thread.starred;
  const isLowValue = explicit;
  const autoArchivable = explicit && !thread.unread;

  return {
    threadId: thread.threadId,
    subject: thread.subject,
    isLowValue,
    explicit,
    autoArchivable,
    reasons,
    recommendedAction: isLowValue ? (autoArchivable ? "archive" : "review") : "keep"
  };
}

function extractUnsubscribeUrl(listUnsubscribe = "") {
  const match = /<([^>]+)>/.exec(listUnsubscribe);
  return match ? match[1] : "";
}

function buildReplyDraft(thread, input) {
  const latest = thread.latestMessage || {};
  const body = String(input.body || input.summary || "").trim();
  const subject = thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`;
  const lines = [
    `To: ${latest.from || ""}`,
    `Subject: ${subject}`,
    latest.messageIdHeader ? `In-Reply-To: ${latest.messageIdHeader}` : "",
    latest.references || latest.messageIdHeader ? `References: ${latest.references || latest.messageIdHeader}` : "",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body
  ].filter(Boolean);

  const rawMessage = Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return {
    threadId: thread.threadId,
    subject,
    draftBody: body,
    rawMessage,
    approvalRequiredToSend: true
  };
}

function normalizeEvent(raw = {}) {
  return {
    eventId: raw.eventId || raw.id || "",
    summary: raw.summary || raw.title || "",
    start: raw.start?.dateTime || raw.start?.date || raw.start || raw.startTime || raw.startDateTime || "",
    end: raw.end?.dateTime || raw.end?.date || raw.end || raw.endTime || raw.endDateTime || "",
    location: raw.location || "",
    attendees: toArray(raw.attendees).map((attendee) => attendee.email || attendee),
    description: raw.description || ""
  };
}

function summarizeEvents(raw) {
  const events = Array.isArray(raw) ? raw : toArray(raw?.events || raw?.items);
  const normalized = events.map(normalizeEvent);
  return {
    count: normalized.length,
    events: normalized
  };
}

function buildAttendeeObjects(attendees) {
  return toArray(attendees).map((email) => ({ email }));
}

async function runConfiguredCommand(operation, values = {}, runtime = {}) {
  const manifest = runtime.manifest || (await readManifest(runtime.manifestPath));
  if (runtime.transport === "fixture") {
    const fixture = runtime.fixtures?.[operation];
    if (fixture === undefined) throw new Error(`Missing fixture for operation ${operation}`);
    return fixture;
  }

  const [scope, action] = operation.split(":");
  const entry = manifest?.[scope]?.[action];
  if (!entry) throw new Error(`No gws manifest entry for ${operation}`);

  const binary = runtime.binary || process.env.GWS_BIN || manifest.binary || "gws";
  const argv = [...entry.argv];
  const params = substituteValue(entry.params || {}, values);
  const json = substituteValue(entry.json || {}, values);

  if (Object.keys(params).length > 0) {
    argv.push("--params", JSON.stringify(params));
  }
  if (Object.keys(json).length > 0) {
    argv.push("--json", JSON.stringify(json));
  }
  argv.push("--format", "json");

  try {
    const { stdout } = await execFileAsync(binary, argv, { cwd: runtime.cwd || ROOT, maxBuffer: 1024 * 1024 * 10 });
    return parseJsonOutput(stdout);
  } catch (error) {
    const message = error?.code === "ENOENT" ? `gws binary not found: ${binary}` : error.stderr || error.message;
    throw new Error(`gws ${operation} failed: ${message}`);
  }
}

export async function gmailSearch(input, runtime = {}) {
  const raw = await runConfiguredCommand(
    "gmail:searchThreads",
    {
      query: input.query || "",
      maxResults: input.maxResults || 10
    },
    runtime
  );

  const listedThreads = toArray(raw?.threads || raw?.items || raw);
  const threads = [];
  for (const item of listedThreads) {
    if (item.messages) {
      threads.push(normalizeThread(item));
      continue;
    }

    const full = await runConfiguredCommand("gmail:getThread", { threadId: item.id || item.threadId }, runtime);
    threads.push(normalizeThread(full));
  }

  return {
    action: "gmail.search_threads",
    query: input.query || "",
    threads,
    summaries: threads.map(summarizeThread)
  };
}

export async function gmailReadThread(input, runtime = {}) {
  const raw = await runConfiguredCommand("gmail:getThread", { threadId: input.threadId }, runtime);
  const thread = normalizeThread(raw);
  return {
    action: "gmail.read_thread",
    thread,
    summary: summarizeThread(thread)
  };
}

export async function gmailDraftReply(input, runtime = {}) {
  const threadResult = input.thread ? { thread: normalizeThread(input.thread) } : await gmailReadThread({ threadId: input.threadId }, runtime);
  const draft = buildReplyDraft(threadResult.thread, input);
  const raw = await runConfiguredCommand(
    "gmail:createDraftReply",
    {
      threadId: threadResult.thread.threadId,
      rawMessage: draft.rawMessage
    },
    runtime
  );
  return {
    action: "gmail.draft_reply",
    draft,
    draftResult: raw,
    approvalRequiredToSend: true
  };
}

export async function gmailClassifySlop(input, runtime = {}) {
  const threadResult = input.thread ? { thread: normalizeThread(input.thread) } : await gmailReadThread({ threadId: input.threadId }, runtime);
  const classification = classifyLowValueThread(threadResult.thread);
  return {
    action: "gmail.classify_slop",
    thread: threadResult.thread,
    classification
  };
}

export async function gmailArchiveThread(input, runtime = {}) {
  const classified = input.classification
    ? { classification: input.classification, thread: normalizeThread(input.thread || {}) }
    : await gmailClassifySlop({ threadId: input.threadId, thread: input.thread }, runtime);

  const classification = classified.classification;
  const threadId = input.threadId || classified.thread.threadId || classification.threadId;
  const canAutoArchive = classification.explicit && classification.autoArchivable && input.allowAutomatedArchive === true;

  if (!canAutoArchive) {
    return {
      action: "gmail.archive_thread",
      executed: false,
      approvalRequired: classification.isLowValue,
      threadId,
      classification,
      nextStep: classification.isLowValue
        ? "Obtain explicit approval or mark allowAutomatedArchive for bounded auto-archive."
        : "Do not archive because the message is not explicit low-value mail."
    };
  }

  const raw = await runConfiguredCommand("gmail:archiveThread", { threadId }, runtime);
  return {
    action: "gmail.archive_thread",
    executed: true,
    approvalRequired: false,
    threadId,
    classification,
    archiveResult: raw
  };
}

export async function gmailPrepareUnsubscribe(input, runtime = {}) {
  const threadResult = input.thread ? { thread: normalizeThread(input.thread) } : await gmailReadThread({ threadId: input.threadId }, runtime);
  const classification = classifyLowValueThread(threadResult.thread);
  const unsubscribeUrl = extractUnsubscribeUrl(threadResult.thread.latestMessage?.listUnsubscribe || "");
  return {
    action: "gmail.prepare_unsubscribe",
    threadId: threadResult.thread.threadId,
    classification,
    approvalRequired: true,
    unsubscribe: {
      method: unsubscribeUrl ? "open_url" : "manual_review",
      url: unsubscribeUrl,
      sourceHeader: threadResult.thread.latestMessage?.listUnsubscribe || ""
    }
  };
}

export async function calendarListUpcoming(input, runtime = {}) {
  const raw = await runConfiguredCommand(
    "calendar:listEvents",
    {
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      maxResults: input.maxResults || 10
    },
    runtime
  );
  const summary = summarizeEvents(raw);
  return {
    action: "calendar.list_upcoming",
    ...summary
  };
}

export async function calendarDraftEvent(input) {
  return {
    action: input.eventId ? "calendar.update_event_draft" : "calendar.create_event_draft",
    approvalRequired: true,
    eventDraft: {
      eventId: input.eventId || "",
      summary: input.summary || "",
      start: input.start || "",
      end: input.end || "",
      location: input.location || "",
      attendees: toArray(input.attendees),
      description: input.description || ""
    }
  };
}

export async function calendarApplyDraft(input, runtime = {}) {
  const draft = input.eventDraft || input;
  if (input.approved !== true) {
    return {
      action: draft.eventId ? "calendar.update_event" : "calendar.create_event",
      executed: false,
      approvalRequired: true,
      nextStep: "Obtain explicit approval before creating or updating the event.",
      eventDraft: draft
    };
  }

  const values = {
    eventId: draft.eventId,
    summary: draft.summary,
    start: draft.start,
    end: draft.end,
    location: draft.location,
    description: draft.description || "",
    attendeesObjects: buildAttendeeObjects(draft.attendees)
  };

  const raw = draft.eventId
    ? await runConfiguredCommand("calendar:updateEvent", values, runtime)
    : await runConfiguredCommand("calendar:createEvent", values, runtime);

  return {
    action: draft.eventId ? "calendar.update_event" : "calendar.create_event",
    executed: true,
    approvalRequired: false,
    event: normalizeEvent(raw),
    raw
  };
}

export async function runWorkspaceTask(input, runtime = {}) {
  const kind = input.kind;
  if (kind === "gmail.search") return gmailSearch(input, runtime);
  if (kind === "gmail.read") return gmailReadThread(input, runtime);
  if (kind === "gmail.draftReply") return gmailDraftReply(input, runtime);
  if (kind === "gmail.classifySlop") return gmailClassifySlop(input, runtime);
  if (kind === "gmail.archive") return gmailArchiveThread(input, runtime);
  if (kind === "gmail.prepareUnsubscribe") return gmailPrepareUnsubscribe(input, runtime);
  if (kind === "calendar.listUpcoming") return calendarListUpcoming(input, runtime);
  if (kind === "calendar.draftEvent") return calendarDraftEvent(input, runtime);
  if (kind === "calendar.applyDraft") return calendarApplyDraft(input, runtime);
  throw new Error(`Unsupported workspace task kind: ${kind}`);
}
