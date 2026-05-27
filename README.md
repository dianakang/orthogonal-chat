# Orthogonal Chat

An AI chat assistant that surfaces real data through [Orthogonal's](https://orthogonal.com) unified API platform — company enrichment, contact lookup, web scraping, and 100+ more APIs — all through a single conversational interface.

## Stack

- **Next.js 15** (App Router, Server Components, Route Handlers)
- **Claude claude-sonnet-4-6** (Anthropic) — streaming responses with tool use
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
5. **Final response + tool call log** are persisted to Postgres
6. **Conversation auto-titles** itself from the first message (via a fast Haiku call)

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

### Current (MVP)

```
Browser ──SSE──▶ Next.js Route Handler
                    │
                    ├── Postgres (conversations, messages)
                    ├── Anthropic API (Claude claude-sonnet-4-6, streaming)
                    └── Orthogonal API (tool execution)
```

### At Scale

#### Database

**Primary: PostgreSQL** (current)
- Conversations and messages are relational by nature (foreign key, ordered by `created_at`)
- Index on `(conversation_id, created_at)` keeps per-conversation queries O(log n)
- For multi-tenant / high-volume: partition `messages` by `conversation_id` hash or date range

**Cache: Redis**
- Cache recent conversation message lists (TTL ≈ 5 min, invalidated on new message)
- Rate-limit per user/IP to protect Anthropic + Orthogonal API quotas
- Store ephemeral SSE stream state if switching to a queue-based approach

**Search: Postgres full-text or Elasticsearch**
- Add `tsvector` column + GIN index on `messages.content` for conversation search
- Elasticsearch at scale for cross-user semantic search

#### API / Concurrency

**Horizontal Next.js instances** behind a load balancer (Vercel, Railway, or ECS)
- SSE streams are stateless: each request holds its own Anthropic + Orthogonal connections
- No shared in-memory state — safe to run N replicas

**Orthogonal API concurrency**
- Each chat request may fire multiple Orthogonal tool calls sequentially (Claude decides)
- Parallel tool calls possible: batch with `Promise.all` if Claude issues multiple tool uses in one turn
- Rate limit: queue excess requests per user with Redis + BullMQ; respond with a "busy" SSE event

**Anthropic API**
- Streaming means the connection is held open; use a connection pool / retry with exponential backoff
- If Anthropic is slow/down: surface a graceful "AI is temporarily unavailable, try again" error via SSE
- Fallback: queue the request and poll (degrade gracefully rather than timeout)

**Orthogonal API resilience**
- Wrap every `run_orthogonal_api` call in a 30s timeout (`AbortSignal.timeout`)
- On `UPSTREAM_ERROR` or timeout: return the error to Claude so it can explain and suggest alternatives
- On `INSUFFICIENT_CREDITS` or `RATE_LIMITED`: surface directly to the user as a system message

#### Authentication & Multi-user

- Add a `user_id` column to `conversations` + `messages`
- JWT / session cookie (NextAuth or Clerk) to identify users
- Row-level security in Postgres: `WHERE user_id = $currentUser`
- API routes check session before any DB query

#### Observability

- Structured logs (JSON) with `requestId` propagated from Orthogonal responses
- Track `cost` field from Orthogonal `run` responses — aggregate per user per month
- Trace Anthropic tool-call chains with LangSmith or Honeycomb

---

## What I'd Do With More Time

1. **Auth** — NextAuth with GitHub/Google OAuth, per-user conversation isolation
2. **Message search** — full-text search across conversation history
3. **Streaming tool results** — show live Orthogonal response as it arrives rather than waiting for the full JSON
4. **Conversation branching** — fork from any message to explore a different answer path
5. **Orthogonal cost tracking** — show per-message API spend in the UI
6. **Model selection** — let users pick Claude Opus for deeper research vs Haiku for speed
7. **Export** — download conversation as Markdown or JSON
8. **Deploy** — Railway (Postgres + Next.js in one click) or Vercel + Supabase
