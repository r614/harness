export const gmailSearchResult = {
  threads: [
    { id: "thread-human" },
    { id: "thread-news" }
  ]
};

export const gmailThreadHuman = {
  id: "thread-human",
  messages: [
    {
      id: "msg-1",
      threadId: "thread-human",
      labelIds: ["INBOX", "UNREAD"],
      payload: {
        headers: [
          { name: "From", value: "Alice <alice@example.com>" },
          { name: "To", value: "me@example.com" },
          { name: "Subject", value: "Project update" },
          { name: "Message-Id", value: "<msg-1@example.com>" }
        ]
      },
      snippet: "Can you review the draft?"
    }
  ]
};

export const gmailThreadNewsletter = {
  id: "thread-news",
  messages: [
    {
      id: "msg-2",
      threadId: "thread-news",
      labelIds: ["CATEGORY_PROMOTIONS"],
      payload: {
        headers: [
          { name: "From", value: "Deals <deals@example.com>" },
          { name: "Subject", value: "Weekly newsletter" },
          { name: "List-Id", value: "newsletter.example.com" },
          { name: "List-Unsubscribe", value: "<https://example.com/unsub>" }
        ]
      },
      snippet: "Sale ends soon"
    }
  ]
};

export const gmailDraftResult = { id: "draft-1", message: { id: "draft-msg-1" } };
export const gmailArchiveResult = { id: "thread-news", removedLabelIds: ["INBOX"] };

export const calendarEvents = {
  events: [
    {
      id: "event-1",
      summary: "Planning sync",
      start: { dateTime: "2026-03-15T15:00:00Z" },
      end: { dateTime: "2026-03-15T15:30:00Z" },
      attendees: [{ email: "teammate@example.com" }]
    }
  ]
};

export const calendarCreateResult = {
  id: "event-2",
  summary: "Created event",
  start: { dateTime: "2026-03-16T15:00:00Z" },
  end: { dateTime: "2026-03-16T15:30:00Z" },
  attendees: [{ email: "teammate@example.com" }]
};
