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


function buildSystemPrompt(companyMemory: string): string {
  const now = new Date();
  const currentDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `You are an AI assistant connected to Orthogonal — a unified API platform with 55+ real-world APIs (company enrichment, contacts, web scraping, search, email verification, people lookup, social media, financial data, news, and more).

Today is ${currentDate}.

## How to decide whether to use a tool

Ask yourself: "Could an API realistically return this exact data right now?"
- If yes or possibly → call search_orthogonal to find the right API, then use it.
- If clearly no (pure reasoning, math, writing, opinions) → answer directly from your knowledge.

When uncertain, search first. The search result will tell you whether a suitable API exists.

## Tool workflow

1. **search_orthogonal** — find candidate APIs for the user's request.
2. **Pick ONE** — choose the single endpoint whose description most precisely matches what was asked. Do not pre-fetch details for multiple candidates at once.
3. **get_api_details(api, path)** — fetch the full schema. MANDATORY before every run_orthogonal_api call.
4. **run_orthogonal_api** — use only clearly documented fields. Start with the minimum required parameters; never invent nested filter DSL formats unless get_api_details shows an exact example.
5. **On failure** — the error result contains a \`hint\` field that tells you exactly what to do next (fix and retry, move to next API, or stop). Follow the hint strictly.
6. **Verify** — confirm results match the user's request in content and data type. Discard mismatches.
7. **Present** — if results are good, summarize clearly. If all attempts failed, tell the user what you tried, why it failed, and suggest a more specific query or a different approach. Never just list API errors.

## Execution rules

- Substitute every path template variable ({id}, [slug], :param) with a real value in the path string. Never leave placeholders.
- On a 404: the api slug or path is wrong — re-run search_orthogonal to find the correct one.
- For date-sensitive requests: derive explicit date parameters from today (${currentDate}); discard results outside the requested range.
- If you need a domain but only have a company name, look up the domain first.
- **Never guess parameter names, filter_type values, or operator strings** — copy them verbatim from get_api_details. If a field is not listed in the docs, it does not exist.
- If Orthogonal has no suitable API, say so and answer from your own knowledge where possible.

## GET vs POST parameters

Check \`endpointDetails.endpoint.method\` before calling run_orthogonal_api:
- **POST** (bodyParams has entries): put all non-path params in \`body\`, omit \`query\`.
- **GET** (bodyParams is empty, queryParams has entries): put all params in \`query\`, pass \`body: {}\`.

Never send params in \`body\` for a GET endpoint — it will fail with HTTP 400.

## Filter / operator accuracy

- Copy operator strings exactly as documented. E.g. Crustdata fuzzy-match is \`"(.)"\` — never abbreviate to \`"."\`.
- Use only filter_type values explicitly listed in the endpoint docs. Do not invent field names (e.g. \`position_title\`) if they are not in the list.
- For numeric range filters, prefer the documented numeric field (e.g. \`employee_metrics.latest_count\` with \`>=\`/\`<=\`) over bucket-style fields like \`employee_count_range\` which accept only predefined string values.${companyMemory ? `\n\n${companyMemory}\nApply company memory only when directly relevant to the user's current request.` : ''}`;
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

        // ── Save user message, then fetch history + summary in parallel ──────
        // INSERT must complete before SELECT so the current message is visible
        // to the history query (parallel execution causes a race where SELECT
        // can run before the INSERT commits, making the LLM miss the new message).
        await query(
          'INSERT INTO messages (conversation_id, user_id, role, content, token_estimate) VALUES ($1, $2, $3, $4, $5)',
          [conversationId, userId, 'user', userMessage, estimateTokens(userMessage)]
        );

        const [history, summary] = await Promise.all([
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

        // Track how many times each (api, path) has been attempted so we can
        // tell the model when to stop retrying and move on.
        const apiAttemptCounts = new Map<string, number>();
        const exhaustedApis = new Set<string>();

        // ── Agentic loop ──────────────────────────────────────────────────────
        const MAX_ITERATIONS = 10;
        let iterations = 0;

        while (iterations < MAX_ITERATIONS) {
          iterations++;
          let response: Awaited<ReturnType<typeof chatCompletion>>;

          try {
            response = await chatCompletion(messages, ORTHOGONAL_TOOLS, 'gpt-4o-mini', 'auto');
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
                    // Track attempts per (api, path) so we know when to stop.
                    const apiKey = `${input.api}:${input.path}`;
                    const attempt = (apiAttemptCounts.get(apiKey) ?? 0) + 1;
                    apiAttemptCounts.set(apiKey, attempt);
                    if (attempt >= 2) exhaustedApis.add(apiKey);

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

                    // Build a stop signal when this (api, path) has been tried twice,
                    // or when multiple different APIs have been exhausted.
                    const stopSignal = attempt >= 2
                      ? exhaustedApis.size >= 2
                        ? ` STOP USING TOOLS: You have now exhausted ${exhaustedApis.size} different API endpoints. Do not call run_orthogonal_api again. Give the user your best answer: explain what you tried, why it failed, and suggest a more specific or different query they could try.`
                        : ` This is attempt ${attempt} on "${input.api}${input.path}" — do NOT retry this endpoint again. Try the next best API from your search results instead.`
                      : ` This is attempt ${attempt} of 2. Read endpointDetails carefully, use only clearly documented fields, and retry once with the corrected body.`;

                    toolResult = {
                      error: toolError,
                      status: err.status,
                      code: err.code,
                      validationErrors: validationErrors ?? null,
                      youSent: { api: input.api, path: input.path, body: input.body },
                      hint: hasUnsubstitutedPath
                        ? `PATH ERROR: The path "${input.path}" still contains unsubstituted template variables. Replace every {variable}, [variable], or :variable with a real value in the path string, then retry run_orthogonal_api.${stopSignal}`
                        : `VALIDATION FAILED (HTTP ${err.status}): The fields in youSent.body did not satisfy the API requirements. Check validationErrors for specific errors, or use only the required fields shown in endpointDetails.${stopSignal}`,
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
