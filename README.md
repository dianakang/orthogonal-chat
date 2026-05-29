# Orthogonal Chat

An AI chat assistant that surfaces real data through [Orthogonal's](https://orthogonal.com) unified API platform — company enrichment, contact lookup, web scraping, and 55+ more APIs — all through a single conversational interface.

## Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (App Router, Server Components, Route Handlers) |
| **LLM** | GPT-4o-mini via Orthogonal's OpenAI-compatible proxy |
| **Database** | PostgreSQL — conversations, messages, company memory, context summaries (raw SQL via `pg`) |
| **Auth** | Clerk — multi-user, all data scoped by `user_id` |
| **Styling** | Tailwind CSS, dark-mode support |
| **Streaming** | Server-Sent Events (SSE) for real-time token + tool-call updates |

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

This runs `lib/schema.sql`, which creates all tables, indexes, and triggers. Re-running is safe (`CREATE TABLE IF NOT EXISTS`).

Two additional tables must be created once (run in psql):

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

## System Architecture

Orthogonal is the **single external gateway** for both the LLM and all data API calls. There is no separate OpenAI connection — `gpt-4o-mini` is accessed through Orthogonal's proxy, and every tool execution goes through Orthogonal's `/run` endpoint.

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
2. **Current date** is injected into the system prompt so the LLM correctly interprets relative time ("this month", "recently")
3. **Company memory** from past sessions is injected into the system prompt
4. **Context window** is built from Postgres history + any stored summary, trimmed to ≤ 80K tokens
5. **GPT-4o-mini** runs an agentic loop (max 10 iterations) with 4 Orthogonal tools:
   - `search_orthogonal` — natural-language API discovery (cached 5 min)
   - `list_orthogonal_apis` — browse the full catalog
   - `get_api_details` — inspect endpoint parameters (cached 30 min)
   - `run_orthogonal_api` — execute any API call with real data
6. **Tool calls are transparent** — the UI shows each step with expandable result panels and per-call latency
7. **Health events stream live** — if Orthogonal is slow or erroring, the header chip and status text update in real time
8. **Final response + tool log** (including error and latency per call) are persisted atomically to Postgres
9. **Post-response background work** runs without blocking the user:
   - Company facts extracted from tool results → upserted to `company_memory`
   - If the conversation is large, older messages are summarised by the LLM and stored in `conversation_summaries`
10. **Conversation title** is generated asynchronously — the new conversation appears immediately; the title updates once generated

---

## System Design

### Request Lifecycle

```
POST /api/chat
  │
  ├─ 1. Auth check (Clerk userId) — 401 if missing
  ├─ 2. Emit health SSE event if Orthogonal is already degraded
  ├─ 3. Upsert conversation (INSERT with placeholder title → generate real title async)
  ├─ 4. Promise.all: INSERT user message + SELECT history + loadSummary()
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
       │    │    │    → if path has unsubstituted {variables}, hint says so explicitly
       │    │    ├─ on 404: embed hint directing LLM to call search_orthogonal
       │    │    │    to find the correct API slug / endpoint path
       │    │    ├─ SSE: tool_start + tool_result (latencyMs, retrying flag)
       │    │    └─ emit health SSE if slow (> 5 s) or errored
       │    └─ append results, continue loop
       └─ if finish_reason == "stop":
            ├─ stream text word-by-word over SSE
            ├─ INSERT assistant message + JSONB tool log with error + latencyMs (transaction)
            ├─ SSE: done
            └─ Background (non-blocking):
                 ├─ extract + upsert company facts → company_memory
                 └─ if needsCompaction: LLM summarises oldest half → conversation_summaries
```

### Database Schema

Four tables, all data scoped by `user_id`:

| Table | Purpose | Key columns |
|---|---|---|
| `conversations` | One row per thread | `UUID`, `user_id`, `title`, `updated_at` (auto-bumped by trigger) |
| `messages` | Append-only message log | `user_id`, `role`, `content`, `tool_calls` (JSONB with `error` + `latencyMs`), `token_estimate` |
| `company_memory` | Cross-session company facts | `(user_id, slug)` PK, `data` JSONB merged on upsert |
| `conversation_summaries` | LLM-generated compaction summaries | `conversation_id` FK, `summary` text, `covers_message_count` |

Key indexes: per-conversation message load, sidebar sort by recency (`conversations.user_id, updated_at DESC`), company memory by `last_seen_at`. UUIDs via `pgcrypto`. A trigger auto-bumps `conversations.updated_at` on each new message.

### Speed Optimisations

| Technique | Where | Benefit |
|---|---|---|
| Async title generation | `app/api/chat/route.ts` | Removes a blocking LLM call from the critical path; TTFT drops ~500 ms |
| Parallel DB ops | `app/api/chat/route.ts` | `Promise.all` for message insert + history fetch + summary load |
| In-process tool cache | `lib/tool-cache.ts` | `search_orthogonal` (5 min TTL) and `get_api_details` (30 min TTL) skip network on cache hit |
| Thundering-herd dedup | `lib/tool-cache.ts` | Concurrent cache misses for the same key share one in-flight fetch via `Map<string, Promise>` |
| Retry with backoff | `lib/orthogonal.ts` | 5xx / network errors retry up to 3× (800 ms, 1.6 s); 4xx fail fast |

### Context Window Management

Token budget: **80,000 tokens** (estimated at `chars ÷ 4`).

**Per-request (build phase):**
- Newest → oldest; always keep the last 8 messages verbatim
- Stop at 70% of budget (56K tokens) — emit `context_pressure` SSE if threshold exceeded
- Inject stored summary at the front of the window when available

**Background summarisation (post-response):**
- After each response, if total tokens exceed the 70% threshold, the oldest half of messages is summarised by the LLM
- Summary stored in `conversation_summaries`; prior summaries for that conversation are deleted
- Future requests load the summary instead of the raw messages

**Client visibility:**
- `context_pressure` SSE event → inline `NoticeBanner` in the chat
- Banner text distinguishes "getting large" (70–90%) from "nearly full" (> 90%)

### Date Awareness

The system prompt is built fresh on every request and includes:

- **Today's date** — e.g. "Today is Thursday, May 29, 2026"
- **Current month mapping** — "this month" is explicitly resolved to e.g. "May 2026"

This prevents the LLM from falling back on training-data dates when interpreting relative time references. When a user asks for "this month's" funding rounds, the LLM:
1. Passes the correct `start_date` / `end_date` parameters to the API
2. Verifies each result's date field after the call — results outside the requested range are discarded before being presented

### Company Memory

After each assistant response, tool results are scanned for company identifiers (domain, name, industry, employee count, funding, etc.). Extracted facts are upserted into `company_memory` with a JSONB merge so data accumulates across sessions.

At the start of each request, the 15 most recently seen companies for that user are injected into the system prompt under a `## Company Memory` heading — giving the model context about previously researched companies without spending tokens on full conversation history.

### System Health Visibility

`lib/api-health.ts` maintains a rolling 20-sample window of latency and error rate for the Orthogonal API. Degraded = `errorRate ≥ 40%` or `avgMs ≥ 8 s`.

Health SSE events fire at three points:

1. **Pre-request** — if already degraded when the message arrives
2. **Post-tool-call** — after a slow (> 5 s) or failed call
3. **Recovery** — once error rate drops and latency normalises

The `HealthChip` in the chat header reflects current state:
- **Hidden** — healthy, no recent events
- **Amber "Degraded / Slow (Xs)"** — degraded state
- **Green "API recovered"** — auto-dismisses after 8 seconds

Tool call blocks show per-call latency; calls over 4 s get an amber ⚠ marker. A `GET /api/health` endpoint returns machine-readable status (service health, avg latency, error rate, cache size).

### Tool Call Error Recovery

The agentic loop handles 4xx errors from `run_orthogonal_api` without surfacing them as failures to the user. Each error class has its own recovery strategy:

| Status | Cause | Recovery |
|---|---|---|
| **400 / 422** | Wrong or missing body parameters | Auto-fetch endpoint schema; surface `validationErrors` and `youSent` at top level so the LLM can see exactly which field failed and what it sent; embed hint + schema; LLM corrects and retries |
| **404** | Wrong API slug or endpoint path | Embed hint directing LLM to call `search_orthogonal` to discover the correct slug/path, then retry |

In all recoverable cases:
- The UI shows a grey **"Retrying…"** badge instead of a red "Error" — self-correction is invisible to the user
- The `error` and `latencyMs` fields are persisted in the JSONB tool log so they render correctly when the conversation is reloaded from the database
- If the same `(api, path)` fails twice in a row, the LLM is instructed to abandon it and search for a different endpoint

The system prompt and tool descriptions reinforce correct path substitution at every turn:
> "PATH PARAMETERS: If the path contains template variables like {company_id}, [domain], or :slug, you MUST substitute actual values directly into the path string before calling run_orthogonal_api."

### Concurrency & Multi-User Safety

- All DB queries are scoped by `user_id` at the query level; each route independently authenticates via Clerk before touching the DB
- The `pg` pool (max 20 connections) is shared across concurrent requests; each request acquires, queries, and releases immediately
- `ToolCache` is safe for concurrent access because Node.js is single-threaded; no locks needed
- Thundering-herd guard means N simultaneous users making the same search share one network call
- Tool calls within a single turn execute serially to avoid rate-limit amplification

### UI Components

| Component | Purpose |
|---|---|
| `ChatInterface` | Root chat shell — sidebar toggle, health chip, SSE event routing |
| `ConversationSidebar` | Thread list with error state + retry button; auto-collapses on mobile |
| `MessageBubble` | Renders user/assistant bubbles, tool call blocks (expandable with error/latency restored from DB), and system notice banners |
| `SkillsPanel` | Slide-out panel of suggested prompts grouped by API category |
| `ThemeProvider` / `ThemeToggle` | Dark/light mode with system preference detection |

### Scaling Path

| Layer | Now | Next step |
|---|---|---|
| Next.js | Single process | Horizontal replicas — SSE streams are stateless |
| Postgres | Direct pool (max 20) | PgBouncer or connection-string pooling on Railway/Supabase |
| Tool cache | In-process | Redis with same TTLs for shared cache across replicas |
| Orthogonal rate limits | Retry w/ backoff | BullMQ queue per user; `busy` SSE event when queued |
| Auth | Clerk, query-level user scoping | Add Postgres row-level security as defence-in-depth |
| Observability | `console.error` | Propagate Orthogonal `requestId` through structured JSON logs; OpenTelemetry on agentic loop iterations and tool latency |

---

## What I'd Do With More Time

1. **True LLM streaming** — pass `stream: true` through Orthogonal's proxy to reduce time-to-first-token; currently the full JSON completes before text is emitted
2. **Redis cache + rate-limit queue** — shared tool cache across replicas; BullMQ to queue excess Orthogonal requests rather than hard-failing
3. **Postgres row-level security** — defence-in-depth so a misconfigured query can never leak another user's data
4. **Message search** — `tsvector` generated column + GIN index on `messages.content` for full-text search
5. **Observability** — structured JSON logs with Orthogonal `requestId`; OpenTelemetry on agentic loop and tool latency
6. **Orthogonal cost tracking** — accumulate the `cost` field returned on every `/run` response; show per-conversation spend in the UI
7. **Model selection** — let users swap the LLM (GPT-4o for harder tasks, a cheaper model for simple lookups)
8. **Conversation branching** — fork from any message to explore a different answer path
9. **Export** — download conversation as Markdown or JSON
10. **Deploy** — Railway (Postgres + Next.js in one click) or Vercel + Supabase
