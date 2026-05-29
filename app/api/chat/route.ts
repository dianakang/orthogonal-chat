import { query, queryOne, withTransaction } from '@/lib/db';
import type { Conversation, Message } from '@/lib/db';
import {
  buildContextWindow,
  loadSummary,
  saveSummary,
  needsCompaction,
} from '@/lib/context-manager';
import {
  ORTHOGONAL_TOOLS,
  chatCompletion,
  executeOrthogonalTool,
  generateTitle,
  OrthogonalError,
  type ChatMessage,
  type OrthogonalToolName,
} from '@/lib/orthogonal';
import { apiHealth } from '@/lib/api-health';
import {
  extractCompanyFacts,
  saveCompanyFacts,
  getRecentCompanyMemory,
  formatCompanyMemory,
  filterFactsForMessage,
} from '@/lib/company-memory';
import { auth } from '@clerk/nextjs/server';

// ─── System prompt ────────────────────────────────────────────────────────────

function isConversationalOnly(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length >= 40) return false;
  return /^(hi|hello|hey|thanks|thank you|ok|okay|yo|sup|good morning|good afternoon|good evening)[\s!.?,]*$/i.test(
    trimmed
  );
}

function buildSystemPrompt(companyMemory: string): string {
  const now = new Date();
  const currentDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const currentMonth = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

  return `You are a helpful AI assistant with access to Orthogonal's unified API platform. Through Orthogonal you can access 55+ real-world APIs — company enrichment, contact data, web scraping, search, email verification, people lookup, social media data, financial data, and much more.

## Current Date
Today is ${currentDate}. "This month" = ${currentMonth}. "This year" = ${now.getFullYear()}.
Always use the real current date when building queries. Never use dates from training data.

When the user asks for information about companies, people, contacts, or anything retrievable through an API, use the Orthogonal tools to fetch real data rather than guessing.

## First response — critical:
- NEVER open with generic questions. The user stated their goal — act on it immediately with a tool call.
- For multi-step requests (find startups → get VP of Sales → verify email → draft outreach), execute every step in sequence using tools.
- Only ask a clarifying question if a required parameter is truly impossible to infer.

## Strict Workflow — follow this exactly every time:
1. Call search_orthogonal to find relevant APIs.
2. Call get_api_details for the specific (api, path) you want to use. This is MANDATORY — never skip it.
3. Call run_orthogonal_api using only the parameters described in the details response.
4. VERIFY results match the user's criteria (especially dates) before presenting them. Discard results that don't match.
5. Summarize and present only verified, relevant results.

## Date filtering — critical:
- When the user asks for recent data ("this month", "this week", "recently"), you MUST pass date range parameters to the API. Use the current date values above to compute the exact start_date and end_date (or equivalent parameter names from get_api_details).
- For "this month" use start_date = first day of ${currentMonth}, end_date = today (${currentDate}).
- After receiving results, check each item's date field. If a result's date is outside the requested range, DISCARD it — do not present stale results to the user.
- If the API does not support date filtering, say so explicitly and try a news/search API instead (e.g. search for "[company] funding ${currentMonth}").

## Rules:
- NEVER call run_orthogonal_api without first calling get_api_details for that exact (api, path).
- PATH PARAMETERS: Substitute all template variables (e.g. {domain}, [id], :slug) with real values directly in the path string before calling run_orthogonal_api.
- BODY vs QUERY: Path variables go in the path string; everything else goes in body.
- If run_orthogonal_api returns an error with a "hint" field: read validationErrors, youSent, and endpointDetails — fix all issues in one correction and retry.
- If the same (api, path) fails twice, stop and search for a different API.
- Do not guess parameter names or shapes. Only use what get_api_details documents.
- DOMAIN LOOKUPS: If you need a domain but only have a company name, search for it first before calling enrichment APIs.
- Be transparent: if no data matching the user's criteria is found, say so clearly.${companyMemory ? `\n\n${companyMemory}\nUse company memory only when the user's current message relates to those companies.` : ''}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sseChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

        // ── Surface health degradation before we even start ──────────────────
        const health = apiHealth.status('orthogonal');
        if (!health.healthy && health.errorRate > 0) {
          send({
            type: 'health',
            healthy: false,
            avgMs: health.avgMs,
            errorRate: health.errorRate,
            message: health.avgMs > 5000
              ? 'Orthogonal API is responding slowly — answers may take longer than usual.'
              : 'Orthogonal API is experiencing elevated errors — some data lookups may fail.',
          });
        }

        // ── Load or create conversation ───────────────────────────────────────
        let conversation: Conversation | null = null;
        if (conversationId) {
          conversation = await queryOne<Conversation>(
            'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
            [conversationId, userId]
          );
        }

        let isNew = false;
        if (!conversation) {
          isNew = true;
          // Create conversation immediately with a placeholder title so the
          // UI can display it right away; generate the real title async.
          const rows = await query<Conversation>(
            'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING *',
            [userId, 'New Conversation']
          );
          conversation = rows[0];
          conversationId = conversation.id;
          send({ type: 'conversation_created', conversation });

          // Fire-and-forget: generate title then update DB + notify client.
          // This removes a blocking LLM round-trip from the critical path.
          generateTitle(userMessage)
            .then((title) =>
              query('UPDATE conversations SET title = $1 WHERE id = $2', [title, conversationId]).then(() => {
                send({ type: 'title_updated', conversationId, title });
              })
            )
            .catch(() => {/* non-fatal — placeholder title is fine */});
        }

        // ── Parallel: save user message + fetch history + load summary ────────
        const [, history, summary] = await Promise.all([
          query(
            'INSERT INTO messages (conversation_id, user_id, role, content, token_estimate) VALUES ($1, $2, $3, $4, $5)',
            [conversationId, userId, 'user', userMessage, estimateTokens(userMessage)]
          ),
          query<Message>(
            `SELECT m.* FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE m.conversation_id = $1 AND c.user_id = $2
             ORDER BY m.created_at ASC`,
            [conversationId, userId]
          ),
          loadSummary(conversationId!),
        ]);

        // ── Inject company memory into system prompt ──────────────────────────
        const companyFacts = filterFactsForMessage(
          await getRecentCompanyMemory(userId),
          userMessage
        );
        const systemPrompt = buildSystemPrompt(formatCompanyMemory(companyFacts));

        // ── Build context window ──────────────────────────────────────────────
        const { messages: contextMessages, stats } = buildContextWindow(history, summary);

        // Emit context pressure warning so the UI can show a notice
        if (stats.pressure > 0.7) {
          send({
            type: 'context_pressure',
            pressure: Math.round(stats.pressure * 100),
            compacted: stats.compacted,
            message:
              stats.pressure > 0.9
                ? 'Context window is nearly full — older history may be omitted.'
                : 'Context window is getting large — history will be compacted soon.',
          });
        }

        send({ type: 'status', message: 'Thinking…' });

        // ── Build LLM message list ────────────────────────────────────────────
        let messages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...contextMessages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        ];

        const toolCallsForDb: Array<{ name: string; input: unknown; result: unknown; error?: string | null; latencyMs?: number }> = [];
        let finalResponseText = '';

        // ── Agentic loop ──────────────────────────────────────────────────────
        const MAX_ITERATIONS = 10;
        let iterations = 0;

        while (iterations < MAX_ITERATIONS) {
          iterations++;
          let response: Awaited<ReturnType<typeof chatCompletion>>;

          try {
            const forceTools = iterations === 1 && !isConversationalOnly(userMessage);
            response = await chatCompletion(messages, ORTHOGONAL_TOOLS, 'gpt-4o-mini', forceTools ? 'required' : 'auto');
          } catch (err) {
            if (
              err instanceof OrthogonalError &&
              (err.status === 429 || err.message.includes('429'))
            ) {
              send({ type: 'error', message: 'Rate limit reached — please wait a moment and try again.' });
              controller.close();
              return;
            }
            // Emit current health after a failure
            const h = apiHealth.status('orthogonal');
            if (!h.healthy) {
              send({
                type: 'health',
                healthy: false,
                avgMs: h.avgMs,
                errorRate: h.errorRate,
                message: 'Orthogonal API call failed — retrying or falling back.',
              });
            }
            throw err;
          }

          const choice = response.choices[0];
          const message = choice.message;

          if (choice.finish_reason === 'tool_calls' && message.tool_calls?.length) {
            messages = [
              ...messages,
              { role: 'assistant', content: message.content, tool_calls: message.tool_calls },
            ];

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
              // When a run_orthogonal_api call gets a 400 we can auto-attach
              // the endpoint schema to the error result so the LLM can
              // self-correct in the very next iteration without a separate
              // get_api_details call. This eliminates the extra round-trip
              // visible as "Fetched API details 0ms" in the screenshot.
              let isRecoverable400 = false;

              const toolStart = Date.now();
              try {
                toolResult = await executeOrthogonalTool(name, input);
              } catch (err) {
                if (err instanceof OrthogonalError) {
                  toolError = `${err.message} (status: ${err.status}, code: ${err.code})`;
                  if ((err.status === 400 || err.status === 422) && name === 'run_orthogonal_api') {
                    isRecoverable400 = true;
                    // Fetch (or read from cache — 0ms if already loaded) the
                    // endpoint schema and embed it so the LLM fixes params directly.
                    let endpointDetails: unknown = null;
                    try {
                      endpointDetails = await executeOrthogonalTool('get_api_details', {
                        api: input.api,
                        path: input.path,
                      });
                    } catch { /* non-fatal */ }
                    // Check if the path still has unsubstituted template variables
                    const hasUnsubstitutedPath = /[{[:]/.test(input.path as string);
                    // Lift validation errors to top level so the LLM doesn't need
                    // to navigate nested payload.data.errors to understand what failed.
                    let validationErrors: unknown = undefined;
                    try {
                      const payloadData = ((err.payload as Record<string, unknown>)?.data) as Record<string, unknown>;
                      if (payloadData?.errors) validationErrors = payloadData.errors;
                    } catch { /* non-fatal */ }
                    toolResult = {
                      error: toolError,
                      status: err.status,
                      code: err.code,
                      validationErrors: validationErrors ?? null,
                      youSent: { api: input.api, path: input.path, body: input.body },
                      hint: hasUnsubstitutedPath
                        ? `PATH ERROR: The path "${input.path}" still contains unsubstituted template variables. Replace every {variable}, [variable], or :variable with a real value in the path string, then retry run_orthogonal_api.`
                        : `VALIDATION FAILED (HTTP ${err.status}): The fields in youSent.body did not satisfy the API requirements. Check validationErrors above for the specific field errors. Use endpointDetails below to see required/optional fields, correct youSent.body, and retry run_orthogonal_api.`,
                      endpointDetails,
                    };
                  } else if (err.status === 404 && (name === 'run_orthogonal_api' || name === 'get_api_details')) {
                    // 404 means wrong API slug or path — tell the LLM to re-search
                    isRecoverable400 = true;
                    let payloadHint = '';
                    try {
                      payloadHint = ((err.payload as Record<string, unknown>)?.hint as string) ?? '';
                    } catch { /* non-fatal */ }
                    toolResult = {
                      error: toolError,
                      status: 404,
                      code: err.code,
                      payload: err.payload ?? null,
                      hint: `NOT FOUND (404): The api "${input.api}" or path "${input.path}" does not exist on Orthogonal. ${payloadHint ? payloadHint + '. ' : ''}Call search_orthogonal with a relevant description to discover the correct API slug and endpoint path, then call get_api_details and retry run_orthogonal_api.`,
                    };
                  } else {
                    toolResult = { error: toolError, status: err.status, code: err.code, payload: err.payload ?? null };
                  }
                } else {
                  toolError = String(err);
                  toolResult = { error: toolError };
                }
              }
              const toolMs = Date.now() - toolStart;

              // For recoverable errors, suppress the red "Error" badge in the UI.
              send({
                type: 'tool_result',
                name,
                result: toolResult,
                error: isRecoverable400 ? null : toolError,
                latencyMs: toolMs,
                retrying: isRecoverable400,
              });
              // Persist error and latencyMs so they render correctly when the
              // conversation is loaded from the database later.
              toolCallsForDb.push({
                name,
                input,
                result: toolResult,
                error: isRecoverable400 ? null : (toolError ?? null),
                latencyMs: toolMs,
              });

              // Surface degraded state after a slow or failed tool call
              if (toolMs > 5000 || toolError) {
                const h = apiHealth.status('orthogonal');
                if (!h.healthy) {
                  send({
                    type: 'health',
                    healthy: false,
                    avgMs: h.avgMs,
                    errorRate: h.errorRate,
                    message: toolError
                      ? 'An API call failed. Trying alternatives if available.'
                      : `API responded slowly (${(toolMs / 1000).toFixed(1)}s). System is degraded.`,
                  });
                }
              } else if (!toolError) {
                // Recovery: if API was degraded but call just succeeded, announce recovery
                const h = apiHealth.status('orthogonal');
                if (h.healthy && h.avgMs < 3000) {
                  send({ type: 'health', healthy: true, avgMs: h.avgMs, message: 'API recovered.' });
                }
              }

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
            // Stream word-by-word for immediate visual feedback
            const words = finalResponseText.split(/(\s+)/);
            for (const chunk of words) {
              send({ type: 'text', content: chunk });
            }
            break;
          }
        }

        if (!finalResponseText && iterations >= MAX_ITERATIONS) {
          finalResponseText =
            "I wasn't able to complete the request — too many tool calls were needed. Please try a more specific question.";
          send({ type: 'text', content: finalResponseText });
        }

        // ── Persist assistant message ─────────────────────────────────────────
        await withTransaction(async (client) => {
          await client.query(
            'INSERT INTO messages (conversation_id, user_id, role, content, tool_calls, token_estimate) VALUES ($1, $2, $3, $4, $5, $6)',
            [
              conversationId,
              userId,
              'assistant',
              finalResponseText,
              toolCallsForDb.length > 0 ? JSON.stringify(toolCallsForDb) : null,
              estimateTokens(finalResponseText),
            ]
          );
        });

        send({ type: 'done', conversationId });
        controller.close();

        // ── Post-response background work (non-blocking) ──────────────────────

        // 1. Extract and persist company facts from this turn's tool calls
        const newFacts = extractCompanyFacts(toolCallsForDb);
        if (newFacts.length) {
          saveCompanyFacts(userId, newFacts).catch(console.error);
        }

        // 2. Trigger context compaction if this conversation is getting large.
        //    We re-fetch the full history (including the message just saved) and
        //    summarise the oldest half using a lightweight LLM call.
        if (!isNew && conversationId) {
          const fullHistory = await query<Message>(
            `SELECT m.* FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE m.conversation_id = $1 AND c.user_id = $2
             ORDER BY m.created_at ASC`,
            [conversationId, userId]
          ).catch(() => [] as Message[]);

          if (needsCompaction(fullHistory) && fullHistory.length > 10) {
            const half = Math.floor(fullHistory.length / 2);
            const toSummarise = fullHistory.slice(0, half);
            const summaryPrompt = `Summarise the following conversation turns into a single concise paragraph that preserves key facts, decisions, and any data retrieved. Be brief and factual.\n\n${toSummarise.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`).join('\n')}`;

            chatCompletion([{ role: 'user', content: summaryPrompt }], undefined, 'gpt-4o-mini')
              .then((res) => {
                const summaryText = res.choices[0]?.message?.content?.trim();
                if (summaryText && conversationId) {
                  return saveSummary(conversationId, summaryText, toSummarise.length);
                }
              })
              .catch(console.error);
          }
        }
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
