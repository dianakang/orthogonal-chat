import type { Message } from './db';
import { query } from './db';

const MAX_CONTEXT_TOKENS = 80_000;
const COMPACTION_THRESHOLD = 56_000; // 70 % — trigger summarisation before hitting the wall
const RECENT_KEEP = 8; // always include last N messages verbatim after compaction

export interface ContextStats {
  totalTokens: number;
  pressure: number;       // 0–1 fraction of MAX_CONTEXT_TOKENS
  compacted: boolean;
  messageCount: number;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationSummary {
  id: string;
  summary: string;
  covers_message_count: number;
  token_estimate: number;
  created_at: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Load the most recent summary for a conversation (if any).
export async function loadSummary(conversationId: string): Promise<ConversationSummary | null> {
  const rows = await query<ConversationSummary>(
    `SELECT * FROM conversation_summaries
     WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
  return rows[0] ?? null;
}

// Persist a new summary, replacing older ones for this conversation.
export async function saveSummary(
  conversationId: string,
  summary: string,
  coversMessageCount: number
): Promise<void> {
  await query(
    `INSERT INTO conversation_summaries
       (conversation_id, summary, covers_message_count, token_estimate)
     VALUES ($1, $2, $3, $4)`,
    [conversationId, summary, coversMessageCount, estimateTokens(summary)]
  );
  // Keep only the latest summary per conversation
  await query(
    `DELETE FROM conversation_summaries
     WHERE conversation_id = $1
       AND id NOT IN (
         SELECT id FROM conversation_summaries
         WHERE conversation_id = $1
         ORDER BY created_at DESC LIMIT 1
       )`,
    [conversationId]
  );
}

// Build the context window from messages + optional stored summary.
// Returns the message list ready for the LLM and usage stats.
export function buildContextWindow(
  messages: Message[],
  summary?: ConversationSummary | null
): { messages: ClaudeMessage[]; stats: ContextStats } {
  const window: ClaudeMessage[] = [];
  let totalTokens = 0;
  let compacted = Boolean(summary);

  if (summary) {
    const summaryMsg: ClaudeMessage = {
      role: 'user',
      content:
        `[Earlier conversation compacted — summary covering ${summary.covers_message_count} messages:\n${summary.summary}]`,
    };
    totalTokens += estimateTokens(summaryMsg.content);
    window.push(summaryMsg);
  }

  // Walk newest → oldest; always keep the most recent RECENT_KEEP messages.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content);
    const isRecent = i >= messages.length - RECENT_KEEP;

    if (!isRecent && totalTokens + tokens > COMPACTION_THRESHOLD) {
      if (!compacted) {
        window.unshift({
          role: 'user',
          content:
            '[Earlier conversation history was compacted to stay within the context window.]',
        });
        compacted = true;
      }
      break;
    }

    totalTokens += tokens;
    window.unshift({ role: msg.role, content: msg.content });
  }

  return {
    messages: window,
    stats: {
      totalTokens,
      pressure: totalTokens / MAX_CONTEXT_TOKENS,
      compacted,
      messageCount: messages.length,
    },
  };
}

// Return whether a conversation is large enough to warrant background compaction.
export function needsCompaction(messages: Message[]): boolean {
  const total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  return total > COMPACTION_THRESHOLD;
}

export function estimateConversationTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}
