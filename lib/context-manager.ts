import type { Message } from './db';

const MAX_CONTEXT_TOKENS = 80_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildContextWindow(messages: Message[]): ClaudeMessage[] {
  const window: ClaudeMessage[] = [];
  let totalTokens = 0;

  // Walk newest → oldest, prepend until we'd exceed the limit
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content);

    // Always include at least the 4 most recent exchanges
    const isRecent = i >= messages.length - 8;

    if (!isRecent && totalTokens + tokens > MAX_CONTEXT_TOKENS) {
      // Inject a truncation notice so Claude knows history was cut
      window.unshift({
        role: 'user',
        content:
          '[Earlier conversation history was truncated to fit the context window. The conversation above represents the most recent exchanges.]',
      });
      break;
    }

    totalTokens += tokens;
    window.unshift({ role: msg.role, content: msg.content });
  }

  return window;
}

export function estimateConversationTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}
