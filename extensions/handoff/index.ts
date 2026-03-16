/**
 * Handoff extension - create a focused prompt for a fresh session.
 *
 * Usage:
 * - /handoff <goal>
 * - /handoff            (uses the current editor draft as the goal/context when possible)
 *
 * The command summarizes the current branch conversation, incorporates any current
 * editor draft/spec, lets the user edit the generated handoff, then opens a new
 * session with the handoff prefilled in the editor for manual send.
 */

import { complete, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

const SYSTEM_PROMPT = `You are preparing a handoff prompt for a new coding-agent session.

Create a self-contained prompt another agent can act on immediately.

Requirements:
- Preserve the user's actual goal.
- Summarize only context relevant to that goal.
- Include concrete file paths, commands, errors, and decisions when available.
- Include constraints, preferences, and open questions if they matter.
- Be concise, but do not omit details needed to continue the work.
- Do not add preamble like "Here's the handoff".

Output format:
## Goal
- Clear statement of the task to continue

## Relevant Context
- Key facts, discoveries, and current state

## Important Decisions
- Prior decisions or chosen approaches
- Use "- (none)" if none

## Files / Artifacts
- Relevant files, commands, branches, errors, or outputs
- Use "- (none)" if none

## Constraints / Preferences
- Explicit user preferences, repo rules, or constraints
- Use "- (none)" if none

## Open Questions / Risks
- Remaining unknowns, blockers, or risks
- Use "- (none)" if none

## Task for the Next Agent
- Specific instructions for what to do next

## Suggested First Steps
1. First concrete step
2. Second concrete step
3. Third concrete step (if helpful)`;

function getTextFromMessageContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return Boolean(
				part
					&& typeof part === "object"
					&& "type" in part
					&& "text" in part
					&& (part as { type?: unknown }).type === "text"
					&& typeof (part as { text?: unknown }).text === "string",
			);
		})
		.map((part) => part.text)
		.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Generate a handoff draft and open a fresh session with it prefilled",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("handoff requires interactive mode", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const editorDraft = ctx.ui.getEditorText().trim();
			let goal = args.trim();

			if (!goal && editorDraft) {
				goal = editorDraft;
			}

			if (!goal) {
				const input = await ctx.ui.input("Handoff goal", "What should the next session focus on?");
				if (input === undefined) {
					ctx.ui.notify("Cancelled", "info");
					return;
				}
				goal = input.trim();
			}

			if (!goal) {
				ctx.ui.notify("Provide a handoff goal or draft first", "error");
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			const messages = branch
				.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
				.map((entry) => entry.message);

			if (messages.length === 0 && !editorDraft) {
				ctx.ui.notify("No conversation or draft available to hand off", "error");
				return;
			}

			const llmMessages = convertToLlm(messages);
			const conversationText = messages.length > 0 ? serializeConversation(llmMessages) : "(none)";
			const currentSessionFile = ctx.sessionManager.getSessionFile();

			const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, `Generating handoff using ${ctx.model!.id}...`);
				loader.onAbort = () => done(null);

				const doGenerate = async () => {
					const apiKey = await ctx.modelRegistry.getApiKey(ctx.model!);
					const userMessage: UserMessage = {
						role: "user",
						content: [
							{
								type: "text",
								text: `## Goal\n\n${goal}\n\n## Current Editor Draft / Spec\n\n${editorDraft || "(none)"}\n\n## Conversation History\n\n${conversationText}`,
							},
						],
						timestamp: Date.now(),
					};

					const response = await complete(
						ctx.model!,
						{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
						{ apiKey, signal: loader.signal },
					);

					if (response.stopReason === "aborted") {
						return null;
					}

					const text = getTextFromMessageContent(response.content).trim();
					return text || null;
				};

				doGenerate()
					.then(done)
					.catch((error) => {
						console.error("Handoff generation failed:", error);
						done(null);
					});

				return loader;
			});

			if (result === null) {
				ctx.ui.notify("Handoff generation cancelled", "info");
				return;
			}

			const editedPrompt = await ctx.ui.editor("Edit handoff prompt", result);
			if (editedPrompt === undefined) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			const newSessionResult = await ctx.newSession({
				parentSession: currentSessionFile,
			});

			if (newSessionResult.cancelled) {
				ctx.ui.notify("New session cancelled", "info");
				return;
			}

			ctx.ui.setEditorText(editedPrompt);
			ctx.ui.notify("Handoff ready in new session. Edit and submit when ready.", "info");
		},
	});
}
