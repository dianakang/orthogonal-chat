import Anthropic from '@anthropic-ai/sdk';
import { query, queryOne, withTransaction } from '@/lib/db';
import type { Conversation, Message } from '@/lib/db';
import { buildContextWindow } from '@/lib/context-manager';
import {
  ORTHOGONAL_TOOLS,
  executeOrthogonalTool,
  OrthogonalError,
  type OrthogonalToolName,
} from '@/lib/orthogonal';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a helpful AI assistant with access to Orthogonal's unified API platform. Through Orthogonal you can access hundreds of real-world APIs — company enrichment, contact data, web scraping, email verification, people search, and more.

When the user asks for information about companies, people, contacts, or anything you could retrieve through an API, use the Orthogonal tools to fetch real data rather than guessing.

Workflow:
1. Use search_orthogonal to discover relevant APIs for the task.
2. Use get_api_details if you need to understand required parameters.
3. Use run_orthogonal_api to execute the call and return real results.
4. Summarize and present the data clearly.

Be transparent when fetching data. If an API call fails or returns no results, explain it gracefully and suggest alternatives.`;

function encoder() {
  return new TextEncoder();
}

function sseChunk(data: object): Uint8Array {
  return encoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

async function generateConversationTitle(firstMessage: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 20,
    messages: [
      {
        role: 'user',
        content: `Summarize this in 4-6 words as a chat title (no quotes): ${firstMessage}`,
      },
    ],
  });
  const block = response.content[0];
  return block.type === 'text' ? block.text.trim() : 'New Conversation';
}

export async function POST(req: Request) {
  let conversationId: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseChunk(data));

      try {
        const body = await req.json();
        const userMessage: string = body.message?.trim();
        conversationId = body.conversationId ?? null;

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
          const title = await generateConversationTitle(userMessage);
          const rows = await query<Conversation>(
            'INSERT INTO conversations (title) VALUES ($1) RETURNING *',
            [title]
          );
          conversation = rows[0];
          conversationId = conversation.id;
          send({ type: 'conversation_created', conversation });
        }

        // Save user message
        const userTokens = estimateTokens(userMessage);
        await query(
          'INSERT INTO messages (conversation_id, role, content, token_estimate) VALUES ($1, $2, $3, $4)',
          [conversationId, 'user', userMessage, userTokens]
        );

        // Load history and build context window
        const history = await query<Message>(
          'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
          [conversationId]
        );
        const contextMessages = buildContextWindow(history);

        send({ type: 'status', message: 'Thinking…' });

        // Agentic loop: stream → handle tool calls → continue
        let messages: Anthropic.MessageParam[] = contextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const toolCallsForDb: Array<{ name: string; input: unknown; result: unknown }> = [];
        let finalResponseText = '';

        while (true) {
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 8096,
            system: SYSTEM_PROMPT,
            messages,
            tools: ORTHOGONAL_TOOLS,
            stream: true,
          } as Parameters<typeof anthropic.messages.create>[0]);

          let responseText = '';
          const toolUseBlocks: Array<{
            id: string;
            name: string;
            inputJson: string;
          }> = [];
          let currentToolIndex = -1;
          let stopReason = '';

          for await (const event of response as AsyncIterable<Anthropic.MessageStreamEvent>) {
            if (
              event.type === 'content_block_start' &&
              event.content_block.type === 'tool_use'
            ) {
              toolUseBlocks.push({
                id: event.content_block.id,
                name: event.content_block.name,
                inputJson: '',
              });
              currentToolIndex = toolUseBlocks.length - 1;
            }

            if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                responseText += event.delta.text;
                send({ type: 'text', content: event.delta.text });
              } else if (
                event.delta.type === 'input_json_delta' &&
                currentToolIndex >= 0
              ) {
                toolUseBlocks[currentToolIndex].inputJson +=
                  event.delta.partial_json;
              }
            }

            if (event.type === 'message_delta') {
              stopReason = event.delta.stop_reason ?? '';
            }
          }

          if (stopReason === 'tool_use' && toolUseBlocks.length > 0) {
            // Build assistant message with all content blocks
            const assistantContent: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
            if (responseText) {
              assistantContent.push({ type: 'text', text: responseText });
            }

            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const tool of toolUseBlocks) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(tool.inputJson || '{}');
              } catch {
                input = {};
              }

              assistantContent.push({
                type: 'tool_use',
                id: tool.id,
                name: tool.name,
                input,
              });

              send({ type: 'tool_start', name: tool.name, input });

              let toolResult: unknown;
              let toolError: string | null = null;

              try {
                toolResult = await executeOrthogonalTool(
                  tool.name as OrthogonalToolName,
                  input
                );
              } catch (err) {
                if (err instanceof OrthogonalError) {
                  toolError = `${err.message} (code: ${err.code})`;
                } else {
                  toolError = String(err);
                }
                toolResult = { error: toolError };
              }

              send({ type: 'tool_result', name: tool.name, result: toolResult, error: toolError });

              toolCallsForDb.push({ name: tool.name, input, result: toolResult });

              toolResults.push({
                type: 'tool_result',
                tool_use_id: tool.id,
                content: JSON.stringify(toolResult),
              });
            }

            messages = [
              ...messages,
              { role: 'assistant', content: assistantContent },
              { role: 'user', content: toolResults },
            ];

            finalResponseText += responseText;
            send({ type: 'status', message: 'Processing results…' });
          } else {
            finalResponseText += responseText;
            break;
          }
        }

        // Persist final assistant message
        const assistantTokens = estimateTokens(finalResponseText);
        await withTransaction(async (client) => {
          const msgResult = await client.query(
            'INSERT INTO messages (conversation_id, role, content, tool_calls, token_estimate) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [
              conversationId,
              'assistant',
              finalResponseText,
              toolCallsForDb.length > 0 ? JSON.stringify(toolCallsForDb) : null,
              assistantTokens,
            ]
          );
          return msgResult.rows[0].id;
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
