import { query, queryOne, withTransaction } from '@/lib/db';
import type { Conversation, Message } from '@/lib/db';
import { buildContextWindow } from '@/lib/context-manager';
import {
  ORTHOGONAL_TOOLS,
  chatCompletion,
  executeOrthogonalTool,
  generateTitle,
  OrthogonalError,
  type ChatMessage,
  type OrthogonalToolName,
} from '@/lib/orthogonal';

const SYSTEM_PROMPT = `You are a helpful AI assistant with access to Orthogonal's unified API platform. Through Orthogonal you can access 55+ real-world APIs — company enrichment, contact data, web scraping, search, email verification, people lookup, social media data, financial data, and much more.

When the user asks for information about companies, people, contacts, or anything retrievable through an API, use the Orthogonal tools to fetch real data rather than guessing.

Workflow:
1. Use search_orthogonal to discover the right API for the task.
2. Use get_api_details if you need to understand required parameters.
3. Use run_orthogonal_api to execute the call and return real results.
4. Summarize and present the data clearly.

Be transparent when fetching data. If an API call fails or returns no results, explain gracefully and suggest alternatives.`;

function sseChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export async function POST(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseChunk(data));

      try {
        const body = await req.json();
        const userMessage: string = body.message?.trim();
        let conversationId: string | null = body.conversationId ?? null;

        if (!userMessage) {
          send({ type: 'error', message: 'Message is required' });
          controller.close();
          return;
        }

        // Create or load conversation
        let conversation: Conversation | null = null;
        if (conversationId) {
          conversation = await queryOne<Conversation>(
            'SELECT * FROM conversations WHERE id = $1',
            [conversationId]
          );
        }

        if (!conversation) {
          const title = await generateTitle(userMessage);
          const rows = await query<Conversation>(
            'INSERT INTO conversations (title) VALUES ($1) RETURNING *',
            [title]
          );
          conversation = rows[0];
          conversationId = conversation.id;
          send({ type: 'conversation_created', conversation });
        }

        // Save user message
        await query(
          'INSERT INTO messages (conversation_id, role, content, token_estimate) VALUES ($1, $2, $3, $4)',
          [conversationId, 'user', userMessage, estimateTokens(userMessage)]
        );

        // Build context window from history
        const history = await query<Message>(
          'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
          [conversationId]
        );
        const contextMessages = buildContextWindow(history);

        send({ type: 'status', message: 'Thinking…' });

        // Build the messages array for the LLM
        let messages: ChatMessage[] = [
          { role: 'system', content: SYSTEM_PROMPT },
          ...contextMessages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        ];

        const toolCallsForDb: Array<{ name: string; input: unknown; result: unknown }> = [];
        let finalResponseText = '';

        // Agentic loop
        while (true) {
          const response = await chatCompletion(messages, ORTHOGONAL_TOOLS);
          const choice = response.choices[0];
          const message = choice.message;

          if (choice.finish_reason === 'tool_calls' && message.tool_calls?.length) {
            // Add assistant message with tool calls
            messages = [
              ...messages,
              {
                role: 'assistant',
                content: message.content,
                tool_calls: message.tool_calls,
              },
            ];

            // Execute each tool call
            const toolResultMessages: ChatMessage[] = [];

            for (const toolCall of message.tool_calls) {
              const name = toolCall.function.name as OrthogonalToolName;
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(toolCall.function.arguments || '{}');
              } catch {
                input = {};
              }

              send({ type: 'tool_start', name, input });

              let toolResult: unknown;
              let toolError: string | null = null;

              try {
                toolResult = await executeOrthogonalTool(name, input);
              } catch (err) {
                if (err instanceof OrthogonalError) {
                  toolError = `${err.message} (code: ${err.code})`;
                } else {
                  toolError = String(err);
                }
                toolResult = { error: toolError };
              }

              send({ type: 'tool_result', name, result: toolResult, error: toolError });
              toolCallsForDb.push({ name, input, result: toolResult });

              toolResultMessages.push({
                role: 'tool',
                content: JSON.stringify(toolResult),
                tool_call_id: toolCall.id,
              });
            }

            messages = [...messages, ...toolResultMessages];
            send({ type: 'status', message: 'Processing results…' });
          } else {
            finalResponseText = message.content ?? '';
            // Stream text word by word for live feel
            const words = finalResponseText.split(/(\s+)/);
            for (const chunk of words) {
              send({ type: 'text', content: chunk });
            }
            break;
          }
        }

        // Persist assistant message
        await withTransaction(async (client) => {
          await client.query(
            'INSERT INTO messages (conversation_id, role, content, tool_calls, token_estimate) VALUES ($1, $2, $3, $4, $5)',
            [
              conversationId,
              'assistant',
              finalResponseText,
              toolCallsForDb.length > 0 ? JSON.stringify(toolCallsForDb) : null,
              estimateTokens(finalResponseText),
            ]
          );
        });

        send({ type: 'done', conversationId });
        controller.close();
      } catch (err) {
        console.error('[chat]', err);
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        try {
          controller.enqueue(sseChunk({ type: 'error', message }));
        } catch {
          // stream may already be closing
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
