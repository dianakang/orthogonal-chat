# Orthogonal Chat

An AI chat assistant that surfaces real data through [Orthogonal's](https://orthogonal.com) unified API platform — company enrichment, contact lookup, web scraping, and 100+ more APIs — all through a single conversational interface.

## Stack

- **Next.js 15** (App Router, Server Components, Route Handlers)
- **GPT-4o-mini** via Orthogonal's OpenAI-compatible proxy — streaming responses with tool use
- **PostgreSQL** — conversation and message persistence (raw SQL via `pg`)
- **Tailwind CSS** — dark-mode UI

---

## Getting Started

### 1. Prerequisites

- Node 18+
- PostgreSQL running locally (`createdb orthogonal_chat`)

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in your keys:

```
ANTHROPIC_API_KEY=sk-ant-...
ORTHOGONAL_API_KEY=orth_live_...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orthogonal_chat
```

### 3. Database

```bash
npm run db:init
```

### 4. Run

```bash
npm install
npm run dev
# → http://localhost:3000
```

---

## How It Works

1. **User sends a message** → `POST /api/chat` (SSE stream)
2. **Context window built** from Postgres history, trimmed to ≤80K tokens oldest-first
3. **Claude streams a response** with access to 4 Orthogonal tools:
   - `search_orthogonal` — natural-language API discovery
   - `list_orthogonal_apis` — browse the full catalog
   - `get_api_details` — inspect endpoint parameters
   - `run_orthogonal_api` — execute any API call with real data
4. **Tool calls are transparent** — the UI shows "Searched Orthogonal", "Called API", with expandable result panels
5. **Final response + tool call log** are persisted to Postgres (assistant message + JSONB `tool_calls` array in a single transaction)
6. **Conversation auto-titles** itself from the first message (a lightweight `gpt-4o-mini` call before the main stream begins)

---

## Context Window Management

Each message stores a `token_estimate` (chars ÷ 4). When building the context for a new request:

- Walk from newest → oldest, accumulating estimated tokens
- Always include at least the last 8 messages regardless of size
- Stop adding older messages when total exceeds **80 000 tokens**
- Inject a truncation notice at the cut point so Claude knows history was omitted

This keeps responses fast and costs predictable without needing a separate summarization step.

---

## System Design

### Architecture (current)

Orthogonal is the single external gateway for **both** the LLM and all data API calls. There is no separate Anthropic connection — `gpt-4o-mini` is accessed through Orthogonal's OpenAI-compatible proxy, and every tool execution also goes through Orthogonal's `/run` endpoint.

```
Browser ──SSE──▶ Next.js Route Handler (/api/chat)
                    │
                    ├── PostgreSQL
                    │     ├── conversations (UUID, title, timestamps)
                    │     └── messages (UUID, role, content, tool_calls JSONB, token_estimate)
                    │
                    └── Orthogonal API (single key, single base URL)
                          ├── /run  openai → gpt-4o-mini  (LLM completions + title generation)
                          ├── /search                      (natural-language API discovery)
                          ├── /list-endpoints              (full catalog browse)
                          ├── /details                     (endpoint parameter inspection)
                          └── /run  <api-slug>             (55+ real-world data APIs)
```

### Database

**PostgreSQL** — the only datastore. Two tables, six objects:

| Object | Purpose |
|---|---|
| `conversations` | One row per thread; `title`, `created_at`, `updated_at` |
| `messages` | Append-only log; `role`, `content`, `tool_calls` (JSONB), `token_estimate` |
| `messages_conversation_id_idx` | Filters messages by conversation — used on every load |
| `messages_created_at_idx` | Global time-ordering (used for future search) |
| `conversations_updated_at_idx DESC` | Sort sidebar by most-recent activity |
| `update_conversation_timestamp` trigger | Auto-bumps `conversations.updated_at` on message insert — no application-layer UPDATE needed |

UUIDs are generated in-database via `pgcrypto` (`gen_random_uuid()`). Tool call payloads are stored as JSONB so they are queryable without schema changes as new tools are added.

The connection pool is configured at **20 max connections**, 30 s idle timeout, 5 s connection timeout — sized for a single Node process. Each request acquires a client, runs its queries, and releases immediately; the assistant message is written inside a `BEGIN / COMMIT` transaction to ensure the tool_calls array and message content land atomically.

### Request lifecycle

```
POST /api/chat
  │
  ├─ 1. Upsert conversation (INSERT if new, SELECT if existing)
  ├─ 2. INSERT user message
  ├─ 3. Load history → buildContextWindow (trim to ≤80K tokens)
  │
  └─ Agentic loop (max 6 iterations):
       ├─ chatCompletion → Orthogonal /run openai
       ├─ if finish_reason == "tool_calls":
       │    ├─ executeOrthogonalTool for each call (sequential)
       │    ├─ SSE: tool_start + tool_result events
       │    └─ append tool results, continue loop
       └─ if finish_reason == "stop":
            ├─ stream text word-by-word over SSE
            ├─ INSERT assistant message + JSONB tool log (transaction)
            └─ SSE: done
```

The 6-iteration cap prevents runaway tool chains from exhausting the Orthogonal quota. If the cap is hit, the user gets a graceful fallback message rather than a silent hang.

### Scaling

The current build runs on a single Next.js process with a direct Postgres connection — fine for a demo but not production. Here's the design path for each layer when load grows:

#### Database

- **Indexes already in place** cover the two hot paths: per-conversation message load and sidebar sort. No schema change needed to handle 10× traffic.
- **Partition `messages` by `conversation_id` hash** once row count exceeds ~50M — keeps each partition's index small.
- **Redis cache layer** for repeated message-list reads (TTL ≈ 5 min, invalidated on new message insert). Saves a round-trip on every SSE stream open.
- **Full-text search**: add a `tsvector` generated column + GIN index on `messages.content` for conversation search within Postgres. Migrate to Elasticsearch only at cross-user or semantic-search scale.

#### API / Concurrency

**Horizontal Next.js replicas** behind a load balancer (Vercel Edge, Railway, ECS) — each SSE stream is fully stateless, holding its own Orthogonal HTTP connection. No shared in-process state, safe to run N replicas.

**Orthogonal API**
- Tool calls within a single turn are sequential today (Claude issues them one at a time). If Claude ever returns multiple `tool_calls` in one turn, batch with `Promise.all` for parallelism.
- Every `orthogonalFetch` already sets `AbortSignal.timeout(60_000)`. On timeout or `UPSTREAM_ERROR`, the error is fed back to the model so it can explain and suggest alternatives rather than crashing.
- At high volume: queue requests per user with Redis + BullMQ; return a `busy` SSE event when the queue is full rather than blocking the HTTP response.

**LLM (gpt-4o-mini via Orthogonal)**
- Non-streaming today (full JSON response before word-by-word SSE emission). Switch to `stream: true` on the Orthogonal `/run` call to reduce time-to-first-token for long responses.
- Retry with exponential backoff on 429s (rate-limit handler already in place in `route.ts`).

#### Authentication & multi-tenancy

- Add `user_id UUID` to `conversations` (and propagate to `messages` via FK or denormalized column).
- Use NextAuth or Clerk for session cookies — no Postgres schema change beyond the FK.
- Enable Postgres row-level security: `POLICY ON conversations USING (user_id = current_setting('app.user_id')::uuid)` so a misconfigured query can never leak another user's data.

#### Observability

- Propagate Orthogonal's `requestId` (returned on every `/run` response) through structured JSON logs for end-to-end tracing.
- Accumulate the `cost` field from each `run_orthogonal_api` response into a per-conversation total; expose it in the UI and aggregate per-user per-month for billing visibility.
- Instrument the agentic loop iteration count and tool call latency with OpenTelemetry — high iteration counts or slow tools are the primary cost and latency drivers.

---

## What I'd Do With More Time

1. **Auth** — NextAuth with GitHub/Google OAuth; add `user_id` FK to `conversations`, enable Postgres row-level security so queries can never leak across users
2. **True LLM streaming** — pass `stream: true` through Orthogonal's `/run` endpoint to reduce time-to-first-token; today the full JSON completes before any text is emitted
3. **Redis cache + rate-limit queue** — cache per-conversation message lists (TTL 5 min, invalidate on insert); use BullMQ to queue excess Orthogonal requests per user rather than hard-failing
4. **Message search** — add a `tsvector` generated column + GIN index on `messages.content` for full-text search within Postgres
5. **Observability** — propagate Orthogonal's `requestId` through structured JSON logs; instrument agentic loop iteration count and per-tool latency with OpenTelemetry
6. **Streaming tool results** — show live Orthogonal response as it arrives rather than waiting for the full JSON
7. **Conversation branching** — fork from any message to explore a different answer path
8. **Orthogonal cost tracking** — show per-message API spend in the UI (the `cost` field is already returned on every `/run` response)
9. **Model selection** — let users swap the LLM (e.g. GPT-4o for harder tasks, a faster/cheaper model for simple lookups)
10. **Export** — download conversation as Markdown or JSON
11. **Deploy** — Railway (Postgres + Next.js in one click) or Vercel + Supabase
