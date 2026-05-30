# Orthogonal Chat

An AI chat assistant that surfaces live data through [Orthogonal's](https://orthogonal.com) unified API platform — company enrichment, contact lookup, web scraping, and 55+ more APIs — all through a single conversational interface.

## Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (App Router, Server Components, Route Handlers) |
| **LLM** | GPT-4o-mini via Orthogonal's OpenAI-compatible proxy |
| **Database** | PostgreSQL — conversations, messages, company memory, context summaries (raw SQL via `pg`) |
| **Auth** | Clerk — multi-user, all data scoped by `user_id` |
| **Styling** | Tailwind CSS, dark-mode support |
| **Streaming** | Server-Sent Events (SSE) for real-time token and tool-call updates |

---

## Getting Started

### 1. Prerequisites

- Node 18+
- PostgreSQL running locally

```bash
createdb orthogonal_chat
```

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in your keys:

```env
ORTHOGONAL_API_KEY=orth_live_...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orthogonal_chat
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/chat
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/chat
```

### 3. Database

```bash
npm run db:init
```

This runs `lib/schema.sql` (idempotent — safe to re-run). Then run these two statements once in psql:

```sql
CREATE TABLE IF NOT EXISTS company_memory (
  user_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, slug)
);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  covers_message_count INTEGER NOT NULL DEFAULT 0,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4. Run

```bash
npm install
npm run dev
# → http://localhost:3000
```

---

## Architecture

Orthogonal is the **single external gateway** for both the LLM and all data API calls. There is no direct OpenAI connection — `gpt-4o-mini` goes through Orthogonal's proxy, and every tool execution goes through Orthogonal's `/run` endpoint.

```mermaid
flowchart TD
    Browser(["Browser"])

    subgraph Auth["Clerk Authentication"]
        MW["clerkMiddleware\nroute auth guard"]
        ClerkUI["Hosted sign-in / sign-up"]
    end

    subgraph App["Next.js 15  —  App Router"]
        direction TB

        subgraph Routes["Route Handlers"]
            ChatRoute["POST /api/chat\nSSE stream"]
            ConvRoutes["/api/conversations/**\nCRUD"]
            HealthRoute["GET /api/health"]
        end

        subgraph Singletons["In-Process Singletons"]
            TC["ToolCache\nsearch: 5 min TTL\ndetails: 30 min TTL\nin-flight dedup"]
            AH["ApiHealthTracker\n20-sample rolling window\nerrorRate · avgMs"]
        end

        subgraph Loop["Agentic Loop  max 10 iterations"]
            LLM["chatCompletion\ngpt-4o-mini"]
            Tools["Tool Execution\nretry + backoff"]
        end

        subgraph BG["Post-Response  non-blocking"]
            CMem["Company Memory\nextract + upsert"]
            Compact["Context Compaction\nLLM summarise oldest ½"]
        end
    end

    subgraph PG["PostgreSQL"]
        T1[("conversations")]
        T2[("messages")]
        T3[("company_memory")]
        T4[("conversation_summaries")]
    end

    subgraph Orth["Orthogonal API  —  single key"]
        O1["/run openai → gpt-4o-mini"]
        O2["/search  natural-language discovery"]
        O3["/details  endpoint schema"]
        O4["/run ‹api-slug›  55+ data APIs"]
        O5["/list-endpoints"]
    end

    Browser -- "page requests" --> MW
    MW -- "unauthenticated" --> ClerkUI
    MW -- "authenticated" --> Routes
    ChatRoute -- "SSE events\ntext · tool_* · health\ncontext_pressure · done" --> Browser

    ChatRoute <--> TC & AH
    ChatRoute <--> T1 & T2 & T3 & T4
    ChatRoute --> Loop
    Loop --> BG

    LLM --> O1
    Tools <--> TC
    TC --> O2 & O3
    Tools --> O4 & O5

    BG --> T3 & T4
    Compact --> O1
```

---

## How It Works

1. **User sends a message** → `POST /api/chat` opens an SSE stream
2. **API health** is checked upfront; a health event is pushed to the client if Orthogonal is already degraded
3. **Conversation creation**: a placeholder title is inserted immediately; the real title is generated async by the LLM (saves ~500 ms off TTFT)
4. **Company memory** from prior sessions is injected into the system prompt for any companies mentioned in the current message
5. **Context window** is built newest-to-oldest from Postgres history + any stored summary, trimmed to ≤ 80K tokens
6. **GPT-4o-mini** runs an agentic loop (max 10 iterations). First iteration uses `tool_choice: 'required'` so the model must call a tool before responding. The four tools:
   - `search_orthogonal` — natural-language API discovery (cached 5 min)
   - `get_api_details` — inspect endpoint parameters (cached 30 min)
   - `run_orthogonal_api` — execute any API call (GET params in `query`, POST body in `body`)
   - `list_orthogonal_apis` — browse the full catalog
7. **Tool calls are transparent** — the UI shows each step with expandable result panels and per-call latency
8. **Error recovery** — 400s auto-fetch the endpoint schema and embed it for self-correction; 404s instruct the model to re-search; the UI shows "Retrying…" rather than an error
9. **Health events stream live** — header chip and status text update in real time
10. **Persist** — assistant message and JSONB tool log are written to Postgres in a transaction
11. **Post-response background work** (non-blocking): extract and upsert company facts, then summarise the oldest messages if the context threshold is exceeded

---

## System Design

### Request Lifecycle

```
POST /api/chat
  │
  ├─ 1. Auth check (Clerk userId) — 401 if missing
  ├─ 2. Emit health SSE event if Orthogonal is already degraded
  ├─ 3. Upsert conversation (placeholder title → generate real title async)
  ├─ 4. INSERT user message → then Promise.all: SELECT history + loadSummary()
  ├─ 5. Inject current date + company memory into system prompt
  ├─ 6. buildContextWindow() — trim to ≤ 80K tokens; inject stored summary if present
  ├─ 7. Emit context_pressure SSE event if > 70% full
  │
  └─ Agentic loop (max 10 iterations):
       ├─ chatCompletion → Orthogonal /run openai (retry w/ backoff on 5xx)
       ├─ if finish_reason == "tool_calls":
       │    ├─ for each tool:
       │    │    ├─ check in-process cache (search / details)
       │    │    ├─ execute via Orthogonal (retry on 5xx; fail-fast on 4xx)
       │    │    ├─ on 400/422: auto-fetch endpoint schema; lift validationErrors +
       │    │    │    youSent to top level; embed hint → LLM self-corrects in next iter
       │    │    ├─ on 404: embed hint directing LLM to call search_orthogonal
       │    │    ├─ SSE: tool_start + tool_result (latencyMs, retrying flag)
       │    │    └─ emit health SSE if slow (> 5 s) or errored
       │    └─ append results, continue loop
       └─ if finish_reason == "stop":
            ├─ stream text word-by-word over SSE
            ├─ INSERT assistant message + JSONB tool log (transaction)
            ├─ SSE: done
            └─ Background (non-blocking):
                 ├─ extract + upsert company facts → company_memory
                 └─ if needsCompaction: LLM summarises oldest half → conversation_summaries
```

### Database Schema

Four tables, all data scoped by `user_id`:

| Table | Purpose | Key detail |
|---|---|---|
| `conversations` | One row per thread | `updated_at` auto-bumped by trigger on every new message |
| `messages` | Append-only message log | `tool_calls` JSONB column stores full log including `error` + `latencyMs` per call |
| `company_memory` | Cross-session company facts | `(user_id, slug)` PK; `data` JSONB merged on upsert — facts accumulate |
| `conversation_summaries` | LLM-generated compaction summaries | Linked to conversation; prior summaries deleted when a new one is written |

### Performance Decisions

| Technique | Where | Effect |
|---|---|---|
| Async title generation | `route.ts` | Removes a blocking LLM call from the critical path (~500 ms TTFT savings) |
| Parallel DB ops | `route.ts` | `Promise.all` for history fetch + summary load |
| In-process tool cache | `lib/tool-cache.ts` | `search_orthogonal` (5 min) and `get_api_details` (30 min) skip network on cache hit |
| Thundering-herd dedup | `lib/tool-cache.ts` | Concurrent misses for the same key share one in-flight fetch |
| Retry with backoff | `lib/orthogonal.ts` | 5xx / network errors retry up to 3× (800 ms, 1.6 s); 4xx fail fast |

### Context Window Management

Token budget: **80,000 tokens** (estimated at `chars ÷ 4`).

**Per-request:** Newest → oldest; always keep the last 8 messages verbatim; stop at 70% of budget; inject stored summary at the front.

**Background summarisation:** If total tokens exceed 56K, the LLM summarises the oldest half of messages. Summary stored in `conversation_summaries`; future requests load it instead of raw messages. A `context_pressure` SSE event triggers an inline notice in the UI.

### Company Memory

After each response, tool results are scanned for company identifiers and upserted into `company_memory` with a JSONB merge. At request start, up to 15 recently seen companies are loaded and filtered by whether the current message mentions them — only relevant companies are injected into the system prompt.

### API Health Visibility

`lib/api-health.ts` maintains a rolling 20-sample window. Degraded = error rate ≥ 40% or avg latency ≥ 8 s. Health SSE events fire before the request (if already degraded), after a slow or failed tool call, and on recovery. The `HealthChip` in the header reflects current state. `GET /api/health` returns machine-readable status.

### Tool-Call Error Recovery

| Status | Cause | Recovery strategy |
|---|---|---|
| **400 / 422** | Wrong or missing params | Auto-fetch endpoint schema; embed `validationErrors`, `youSent`, and `hint`; LLM corrects on next iteration |
| **404** | Wrong API slug or path | Embed hint directing LLM to `search_orthogonal`, then retry |

400 errors on the same `(api, path)` are tracked; after 2 attempts the model is instructed to abandon that endpoint. The UI shows "Retrying…" (grey) instead of "Error" (red) during recovery.

### GET vs POST Parameters

`run_orthogonal_api` accepts two distinct parameter fields:
- **`body`** — POST body params (for endpoints where `bodyParams` is populated)
- **`query`** — URL query params (for GET endpoints where `queryParams` is populated and `bodyParams` is empty)

The system prompt and tool description both reinforce this distinction so the model sends params to the correct location.

### Scaling Path

| Layer | Now | Next step |
|---|---|---|
| Next.js | Single process | Horizontal replicas — SSE streams are stateless |
| Postgres | Direct pool (max 20) | PgBouncer or connection-string pooling |
| Tool cache | In-process | Redis with same TTLs for shared cache across replicas |
| Orthogonal rate limits | Retry w/ backoff | BullMQ queue per user |
| Auth | Clerk + query-level scoping | Add Postgres row-level security as defence-in-depth |
| Observability | `console.error` | Structured JSON logs; OpenTelemetry on agentic loop iterations and tool latency |

---

## What I'd Do With More Time

1. **True LLM streaming** — pass `stream: true` through Orthogonal's proxy to reduce TTFT; currently the full completion arrives before text is emitted
2. **Redis cache** — shared tool cache across replicas; BullMQ to queue excess requests
3. **Postgres row-level security** — defence-in-depth so a misconfigured query can never leak another user's data
4. **Observability** — structured JSON logs with Orthogonal `requestId`; OpenTelemetry on agentic loop and tool latency
5. **Orthogonal cost tracking** — accumulate the `cost` field from every `/run` response; show per-conversation spend in the UI
6. **Message search** — `tsvector` generated column + GIN index on `messages.content` for full-text search
7. **Model selection** — let users swap the LLM (GPT-4o for harder tasks, a cheaper model for simple lookups)
8. **Deploy** — Railway (Postgres + Next.js in one click) or Vercel + Supabase
