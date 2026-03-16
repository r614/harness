import { describe, expect, it } from "vitest";
import {
  calendarApplyDraft,
  calendarDraftEvent,
  calendarListUpcoming,
  gmailArchiveThread,
  gmailClassifySlop,
  gmailDraftReply,
  gmailPrepareUnsubscribe,
  gmailReadThread,
  gmailSearch,
  runWorkspaceTask
} from "../../scripts/google-workspace.mjs";
import {
  calendarCreateResult,
  calendarEvents,
  gmailArchiveResult,
  gmailDraftResult,
  gmailSearchResult,
  gmailThreadHuman,
  gmailThreadNewsletter
} from "../helpers/google-workspace-samples";

const runtime = {
  transport: "fixture" as const,
  fixtures: {
    "gmail:searchThreads": gmailSearchResult,
    "gmail:getThread": gmailThreadHuman,
    "gmail:createDraftReply": gmailDraftResult,
    "gmail:archiveThread": gmailArchiveResult,
    "calendar:listEvents": calendarEvents,
    "calendar:createEvent": calendarCreateResult
  }
};

describe("google workspace runtime", () => {
  it("searches threads and fetches missing full thread details", async () => {
    const result = await gmailSearch({ query: "newer_than:7d", maxResults: 5 }, runtime);
    expect(result.action).toBe("gmail.search_threads");
    expect(result.threads).toHaveLength(2);
    expect(result.summaries[0].subject).toBe("Project update");
  });

  it("reads and drafts a reply", async () => {
    const readResult = await gmailReadThread({ threadId: "thread-human" }, runtime);
    expect(readResult.summary.needsReply).toBe(true);

    const draftResult = await gmailDraftReply(
      { threadId: "thread-human", body: "Thanks — I will send the draft by Friday." },
      runtime
    );
    expect(draftResult.draft.subject).toBe("Re: Project update");
    expect(draftResult.draftResult.id).toBe("draft-1");
  });

  it("classifies low-value mail and prepares unsubscribe actions", async () => {
    const classifyResult = await gmailClassifySlop({ thread: gmailThreadNewsletter });
    expect(classifyResult.classification.isLowValue).toBe(true);
    expect(classifyResult.classification.recommendedAction).toBe("archive");

    const unsubscribe = await gmailPrepareUnsubscribe({ thread: gmailThreadNewsletter });
    expect(unsubscribe.unsubscribe.method).toBe("open_url");
    expect(unsubscribe.unsubscribe.url).toContain("example.com/unsub");
  });

  it("requires explicit opt-in for archive execution", async () => {
    const blocked = await gmailArchiveThread({ thread: gmailThreadNewsletter });
    expect(blocked.executed).toBe(false);
    expect(blocked.approvalRequired).toBe(true);

    const archived = await gmailArchiveThread(
      { thread: gmailThreadNewsletter, allowAutomatedArchive: true },
      { transport: "fixture", fixtures: { "gmail:archiveThread": gmailArchiveResult } }
    );
    expect(archived.executed).toBe(true);
    expect(archived.archiveResult.id).toBe("thread-news");
  });

  it("lists events and applies approved drafts", async () => {
    const list = await calendarListUpcoming(
      { timeMin: "2026-03-15T00:00:00Z", timeMax: "2026-03-16T00:00:00Z", maxResults: 10 },
      runtime
    );
    expect(list.count).toBe(1);
    expect(list.events[0].summary).toBe("Planning sync");

    const draft = await calendarDraftEvent({
      summary: "Created event",
      start: "2026-03-16T15:00:00Z",
      end: "2026-03-16T15:30:00Z",
      attendees: ["teammate@example.com"]
    });
    expect(draft.approvalRequired).toBe(true);

    const applied = await calendarApplyDraft(
      { approved: true, eventDraft: draft.eventDraft },
      { transport: "fixture", fixtures: { "calendar:createEvent": calendarCreateResult } }
    );
    expect(applied.executed).toBe(true);
    expect(applied.event.eventId).toBe("event-2");
  });

  it("routes tasks through runWorkspaceTask", async () => {
    const result = await runWorkspaceTask(
      { kind: "calendar.listUpcoming", timeMin: "2026-03-15T00:00:00Z", timeMax: "2026-03-16T00:00:00Z" },
      { transport: "fixture", fixtures: { "calendar:listEvents": calendarEvents } }
    );
    expect(result.action).toBe("calendar.list_upcoming");
  });
});
