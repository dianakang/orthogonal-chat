import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  AlignmentType,
} from 'docx';
import { writeFileSync } from 'fs';

// ─── Style helpers ────────────────────────────────────────────────────────────

const H1 = (text) =>
  new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 520, after: 200 },
  });

const H2 = (text) =>
  new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 160 },
  });

const P = (text) =>
  new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 180 },
  });

const script = (text) =>
  new Paragraph({
    children: [new TextRun({ text, size: 22, italics: true })],
    spacing: { after: 180 },
    indent: { left: 560 },
  });

const action = (text) =>
  new Paragraph({
    children: [new TextRun({ text: `→  ${text}`, size: 20, bold: true, color: '1a5276' })],
    spacing: { after: 120 },
    indent: { left: 560 },
  });

const callout = (label, text) =>
  new Paragraph({
    children: [
      new TextRun({ text: `${label}  `, size: 20, bold: true, color: 'ffffff' }),
      new TextRun({ text, size: 20, color: 'ffffff' }),
    ],
    spacing: { after: 200, before: 120 },
    indent: { left: 440, right: 440 },
    shading: { type: ShadingType.SOLID, color: '1a3c6e', fill: '1a3c6e' },
    border: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '2e86c1' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '2e86c1' },
      left: { style: BorderStyle.THICK, size: 16, color: '2e86c1' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '2e86c1' },
    },
  });

const tip = (text) =>
  new Paragraph({
    children: [new TextRun({ text: `💡  ${text}`, size: 20, italics: true, color: '1a6644' })],
    spacing: { after: 160 },
    indent: { left: 440 },
    border: { left: { style: BorderStyle.THICK, size: 12, color: '27ae60', space: 8 } },
  });

const bullet = (text) =>
  new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    bullet: { level: 0 },
    spacing: { after: 120 },
    indent: { left: 560 },
  });

const divider = () =>
  new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'cccccc', space: 1 } },
    spacing: { before: 280, after: 280 },
  });

const spacer = () => new Paragraph({ text: '', spacing: { after: 160 } });

const timingBadge = (time) =>
  new Paragraph({
    children: [new TextRun({ text: `  ${time}  `, size: 18, bold: true, color: 'ffffff' })],
    alignment: AlignmentType.LEFT,
    spacing: { after: 120 },
    shading: { type: ShadingType.SOLID, color: '7d3c98', fill: '7d3c98' },
  });

const hCell = (text) =>
  new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20, color: 'ffffff' })], alignment: AlignmentType.LEFT })],
    shading: { type: ShadingType.SOLID, color: '1a3c6e', fill: '1a3c6e' },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });

const dCell = (text, shade = 'ffffff') =>
  new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, size: 20 })] })],
    shading: { type: ShadingType.SOLID, color: shade, fill: shade },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });

const table = (headers, rows) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map(hCell), tableHeader: true }),
      ...rows.map((row, i) =>
        new TableRow({ children: row.map((c) => dCell(c, i % 2 === 0 ? 'ffffff' : 'eef2f9')) })
      ),
    ],
  });

// ─── Document ─────────────────────────────────────────────────────────────────

const children = [

  // ── Cover ──────────────────────────────────────────────────────────────────
  new Paragraph({
    children: [new TextRun({ text: 'Orthogonal Chat', bold: true, size: 60, color: '1a3c6e' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 600, after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Walkthrough & Demo Script', size: 30, color: '2c5282' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Diana Kang  ·  May 2026  ·  ~20 minutes', size: 22, color: '888888' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
  }),
  divider(),

  P('Italic lines are what you say. Arrow lines are what to show on screen. Callout boxes mark key points to land.'),
  spacer(),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — PRODUCT AND PROBLEM
  // ══════════════════════════════════════════════════════════════════════════
  H1('Section 1 — The Product and Problem We\'re Solving  (2 min)'),
  timingBadge('START HERE'),
  spacer(),

  script('"Let me start with the problem. Language models are great at reasoning — but they\'re terrible at facts. Ask GPT about Stripe\'s headcount right now, or who just raised a Series B last week, and it\'ll either guess or tell you it doesn\'t know. The training data is stale the moment it\'s frozen."'),
  spacer(),
  script('"Orthogonal Chat solves this by connecting the LLM to live APIs. Instead of guessing, it goes and fetches the actual data — company enrichment, contact lookup, funding rounds, web scraping, 55-plus APIs — all through a single conversational interface."'),
  spacer(),
  script('"The interesting engineering challenge isn\'t \'build a chat app.\' It\'s: how do you give an LLM access to 55 heterogeneous APIs it\'s never seen before, have it figure out on its own which one to call, construct the right parameters, and do all of that reliably — without blowing up on every edge case? That\'s what I want to show you."'),
  spacer(),
  action('Show the landing page at localhost:3000'),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — SYSTEM ARCHITECTURE
  // ══════════════════════════════════════════════════════════════════════════
  H1('Section 2 — System Architecture  (2 min)'),
  spacer(),

  action('Show architecture diagram in the README — or sketch: Browser → Clerk → Next.js → Orthogonal → Postgres'),
  spacer(),
  script('"The most important design decision: Orthogonal is the single external gateway for everything. Not just the data APIs — the LLM call also goes through Orthogonal\'s OpenAI-compatible proxy. One API key, one authorization boundary, one audit trail."'),
  spacer(),
  script('"The stack is Next.js 15 App Router — one codebase for frontend and backend, no separate API server. Postgres for persistence with raw SQL, no ORM. Clerk for auth. Server-Sent Events for real-time streaming."'),
  spacer(),

  table(
    ['Layer', 'Technology', 'Why'],
    [
      ['Frontend + Backend', 'Next.js 15 App Router', 'One codebase; route handlers replace a separate API server'],
      ['LLM', 'GPT-4o-mini via Orthogonal proxy', 'Single API key for both LLM and data APIs'],
      ['Database', 'PostgreSQL + pg', 'Raw SQL — no ORM overhead; four tables'],
      ['Auth', 'Clerk', 'Hosted sign-in, userId on every request, zero infrastructure'],
      ['Streaming', 'Server-Sent Events', 'Native browser API; no WebSocket complexity for one-way flow'],
    ]
  ),
  spacer(),
  callout('KEY POINT', 'All data is scoped by user_id at the query level. Every route handler calls auth() before touching the database.'),
  spacer(),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — LIVE DEMO
  // ══════════════════════════════════════════════════════════════════════════
  H1('Section 3 — Live Demo  (4 min)'),
  timingBadge('DEMO TIME'),
  spacer(),

  H2('Demo 1: Real-Time API Lookup'),
  spacer(),

  action('Sign in if needed. Show the chat layout — sidebar, header chip, Skills button.'),
  action('Type and send: "Tell me about Stripe — company size, industry, and latest funding."'),
  spacer(),
  script('"Watch the tool call blocks appear as it works. First: search_orthogonal — a natural-language search against Orthogonal\'s API catalog. Then: get_api_details to inspect the exact parameter schema before calling anything. Then: run_orthogonal_api to execute the actual call."'),
  spacer(),
  script('"Each block shows the input, the output, and the latency. You can expand them. That\'s live data — not training knowledge."'),
  spacer(),
  action('Expand one tool call block to show raw input and output'),
  spacer(),
  callout('KEY POINT', 'The model didn\'t guess. It looked it up. Live data from the Orthogonal API.'),
  spacer(),

  H2('Demo 2: Cross-Session Memory'),
  spacer(),

  action('Start a new conversation. Type: "What industry is Stripe in?"'),
  spacer(),
  script('"It answered without making any API calls. The company facts from the previous session were automatically injected into the system prompt. The model already knows what you found before — no re-fetching."'),
  spacer(),
  tip('company_memory table: after every response, tool results are scanned for company identifiers and upserted with a JSONB merge. Facts accumulate across sessions.'),
  spacer(),

  H2('Demo 3: Skills Panel'),
  spacer(),

  action('Click the Skills button in the header'),
  spacer(),
  script('"Suggested prompts grouped by API category — company enrichment, people lookup, web scraping, financial data, and more. Training wheels for new users: here\'s what you can ask. Click a prompt and it populates the input ready to send."'),
  spacer(),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — AGENTIC EXECUTION MODEL
  // ══════════════════════════════════════════════════════════════════════════
  H1('Section 4 — Agentic Execution Model  (4 min)'),
  spacer(),

  action('Open app/api/chat/route.ts'),
  spacer(),
  script('"The route opens a ReadableStream immediately and returns it with Content-Type: text/event-stream. Everything that follows is non-blocking."'),
  spacer(),
  script('"New conversations: we insert with a placeholder title immediately, then fire an async title-generation LLM call off the critical path. The UI gets the conversation row right away; the real title arrives via a title_updated SSE event a second later. That saved about 500 milliseconds off time-to-first-token."'),
  spacer(),
  script('"After inserting the user message, we load message history and any context summary in parallel via Promise.all."'),
  spacer(),
  script('"Then the loop — max 10 iterations. On the first iteration, tool_choice is set to \'required\' — the model must use a tool before responding with text. This forces the search → schema check → run workflow and prevents the model from skipping the lookup and guessing."'),
  spacer(),
  callout('KEY DETAIL', 'tool_choice: "required" on iteration 1 means the model cannot hallucinate an answer. It must call a tool first.'),
  spacer(),
  script('"Error recovery: when run_orthogonal_api gets a 400, the server immediately fetches the endpoint schema — usually already cached at zero cost — and embeds it in the error result handed back to the LLM. There\'s also a check for unsubstituted template variables in the path. The hint is explicit. The model self-corrects on the very next iteration. The UI shows grey \'Retrying…\' instead of red error. The user never sees the mistake."'),
  spacer(),

  table(
    ['Tool', 'What It Does', 'Cache TTL'],
    [
      ['search_orthogonal', 'Natural-language search to find the right API', '5 minutes'],
      ['get_api_details', 'Fetch exact parameter schema for an endpoint', '30 minutes'],
      ['run_orthogonal_api', 'Execute the API call and return live data', 'No cache'],
      ['list_orthogonal_apis', 'Browse the full Orthogonal catalog', 'No cache'],
    ]
  ),
  spacer(),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — DATA AND MEMORY ARCHITECTURE
  // ══════════════════════════════════════════════════════════════════════════
  H1('Section 5 — Data and Memory Architecture  (3 min)'),
  spacer(),

  script('"Four tables. Let me walk through what\'s interesting about each one."'),
  spacer(),

  table(
    ['Table', 'Purpose', 'Detail Worth Noting'],
    [
      ['conversations', 'One row per thread', 'updated_at auto-bumped by Postgres trigger on every new message — sidebar sort for free'],
      ['messages', 'Append-only log', 'tool_calls JSONB stores full log per turn: input, result, error, latencyMs — conversation replay is exact'],
      ['company_memory', 'Cross-session company facts', '(user_id, slug) composite PK; JSONB data merges on upsert — facts accumulate, never overwrite'],
      ['conversation_summaries', 'Compressed old messages', 'LLM summarises oldest half when tokens exceed 70% of budget; prior summaries deleted when a new one is written'],
    ]
  ),
  spacer(),
  script('"Context window management: token budget is 80,000. We go newest-to-oldest, always keep the last 8 messages verbatim, stop at 70% of budget. When a conversation gets large, a background job — completely off the critical path, non-blocking — has the LLM summarise the oldest half into one paragraph. Future requests load that summary instead of raw messages. Long conversations stay useful without hitting a hard wall."'),
  spacer(),
  script('"Company memory: after every response, tool results are scanned for company identifiers and upserted. At request start, the 15 most recently seen companies are loaded, filtered against the current message, and injected into the system prompt. Relevant context without re-fetching."'),
  spacer(),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 6 — RELIABILITY AND SCALABILITY
  // ══════════════════════════════════════════════════════════════════════════
  H1('Section 6 — Reliability and Scalability Decisions  (2 min)'),
  spacer(),

  action('Open lib/tool-cache.ts briefly'),
  spacer(),
  script('"Tool cache: search results at 5-minute TTL, endpoint schemas at 30 minutes. The thundering herd guard: if multiple users hit the same search on a cold cache simultaneously, the first fires the fetch and registers it in an inFlight Map. Everyone else awaits the same Promise. One network call, N responses."'),
  spacer(),
  script('"Retry with backoff: the Orthogonal fetch wrapper retries 5xx and network errors up to 3 times — 800ms, 1.6s. 4xx fail fast since they\'re client errors that won\'t resolve on retry."'),
  spacer(),
  script('"API health tracking: rolling 20-sample window of latency and error rate. Degraded means error rate ≥ 40% or average latency ≥ 8 seconds. Health events stream to the client before the request if already degraded, after a slow or failed tool call, and once on recovery. The header chip gives users real-time visibility."'),
  spacer(),

  table(
    ['Layer', 'Current', 'Next step to scale'],
    [
      ['Tool cache', 'In-process, per-server', 'Redis with same TTLs — shared across replicas'],
      ['Next.js', 'Single process', 'Horizontal replicas — SSE streams are stateless'],
      ['Postgres', 'Direct pool (max 20)', 'PgBouncer or connection-string pooling'],
      ['Rate limits', 'Retry w/ backoff', 'BullMQ queue per user'],
      ['Auth scoping', 'user_id in WHERE clause', 'Postgres row-level security as defence-in-depth'],
    ]
  ),
  spacer(),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 7 — TRADEOFFS AND FUTURE IMPROVEMENTS
  // ══════════════════════════════════════════════════════════════════════════
  H1('Section 7 — Tradeoffs and Future Improvements  (2 min)'),
  spacer(),

  bullet('Fake streaming: the model waits for its full completion before text flows — I split the finished response word-by-word. Enabling stream: true through Orthogonal\'s proxy would cut TTFT significantly. First thing I\'d fix.'),
  bullet('In-process tool cache doesn\'t survive restarts or scale across replicas. Move to Redis with same TTLs.'),
  bullet('No Postgres row-level security — I scope every query by user_id in WHERE, but RLS would make a misconfigured query physically impossible to leak data across users.'),
  bullet('Observability is console.error right now. Structured JSON logs with Orthogonal requestId + OpenTelemetry spans on the agentic loop and tool latency would make production debugging tractable.'),
  bullet('Orthogonal returns a cost field on every /run response. Accumulating that per conversation and surfacing it in the UI would be genuinely useful.'),
  bullet('Full-text message search: a tsvector generated column with a GIN index on messages.content.'),
  spacer(),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 8 — WHAT I LEARNT
  // ══════════════════════════════════════════════════════════════════════════
  H1('Section 8 — What I Learnt From This Project  (1 min)'),
  timingBadge('FINAL'),
  spacer(),

  script('"A few things this project taught me or reinforced."'),
  spacer(),
  bullet('Prompt engineering is code. The system prompt is as load-bearing as any function. Adding the "GET vs POST parameter" and "operator accuracy" rules to the system prompt fixed real production 400 failures — not by changing application logic, but by being more precise about what the model is allowed to do.'),
  bullet('Background work is underrated. Async title generation, background context compaction, non-blocking company memory extraction — invisible to the user, but collectively make the app feel fast and stateful without any cost on the critical path.'),
  bullet('Transparent tool calls change how people interact with AI. When you can see each step — the search, the schema check, the actual API call, the latency — users understand what happened and trust the answer more. It\'s a fundamentally different experience from a black box.'),
  bullet('One external gateway. Using Orthogonal as the single entry point for both the LLM and all data APIs was the right call. One key, one audit trail, and the architecture diagram actually makes sense.'),
  spacer(),
  script('"I\'m happy to dig into any part of this — the SSE implementation, the context manager, the error recovery, the schema design, whatever\'s most interesting."'),
  spacer(),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // TIMING GUIDE
  // ══════════════════════════════════════════════════════════════════════════
  H1('Timing Guide'),
  spacer(),

  table(
    ['#', 'Section', 'Time'],
    [
      ['1', 'The product and problem we\'re solving', '2 min'],
      ['2', 'System architecture', '2 min'],
      ['3', 'Live demo', '4 min'],
      ['4', 'Agentic execution model', '4 min'],
      ['5', 'Data and memory architecture', '3 min'],
      ['6', 'Reliability and scalability decisions', '2 min'],
      ['7', 'Tradeoffs and future improvements', '2 min'],
      ['8', 'What I learnt from this project', '1 min'],
      ['Total', '', '~20 min'],
    ]
  ),
  spacer(),
  divider(),

  // ══════════════════════════════════════════════════════════════════════════
  // KEY FILES
  // ══════════════════════════════════════════════════════════════════════════
  H1('Key Files to Have Open'),
  spacer(),

  table(
    ['File', 'Used In'],
    [
      ['app/api/chat/route.ts', 'Section 4 — agentic loop, error recovery, SSE stream'],
      ['lib/tool-cache.ts', 'Section 6 — caching, thundering herd guard'],
      ['lib/orthogonal.ts', 'Section 4, 6 — tool definitions, retry logic'],
      ['lib/context-manager.ts', 'Section 5 — token budget, compaction'],
      ['lib/company-memory.ts', 'Section 5 — cross-session memory'],
      ['lib/api-health.ts', 'Section 6 — health tracking'],
      ['components/ChatInterface.tsx', 'Section 3 — SSE event routing'],
    ]
  ),
  spacer(),

  divider(),
  new Paragraph({
    children: [new TextRun({ text: 'Orthogonal Chat  ·  Diana Kang  ·  May 2026', size: 18, color: 'aaaaaa' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 160 },
  }),
];

// ─── Build & write ────────────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        run: { size: 38, bold: true, color: '1a3c6e', font: 'Calibri' },
        paragraph: { spacing: { before: 520, after: 200 } },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        run: { size: 26, bold: true, color: '2c5282', font: 'Calibri' },
        paragraph: { spacing: { before: 320, after: 160 } },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } },
      },
      children,
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync('Orthogonal_Chat_Walkthrough_Script.docx', buffer);
console.log('✓  Orthogonal_Chat_Walkthrough_Script.docx written');
