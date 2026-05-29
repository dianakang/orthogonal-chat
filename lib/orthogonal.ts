import { toolCache } from './tool-cache';
import { apiHealth } from './api-health';

const BASE_URL = 'https://api.orthogonal.com/v1';

// TTLs for read-only tool results
const SEARCH_TTL = 5 * 60 * 1000;   // 5 min  — queries are fast-changing
const DETAILS_TTL = 30 * 60 * 1000; // 30 min — endpoint schemas rarely change

function headers() {
  return {
    Authorization: `Bearer ${process.env.ORTHOGONAL_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function orthogonalFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    // Exponential back-off before retries (skip on first attempt)
    if (attempt > 0) await sleep(400 * 2 ** attempt); // 800 ms, 1 600 ms

    const start = Date.now();
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...headers(),
          ...((options.headers as Record<string, string>) ?? {}),
        },
        signal: AbortSignal.timeout(60_000),
      });

      let body: Record<string, unknown>;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        body = { success: false, error: `HTTP ${res.status}`, code: 'NON_JSON_RESPONSE' };
      }

      if (!res.ok || !body.success) {
        const err = new OrthogonalError(
          (body.error as string | undefined) ??
            (body.message as string | undefined) ??
            `HTTP ${res.status}`,
          (body.code as string | undefined) ?? 'UNKNOWN',
          res.status,
          body
        );

        // 4xx = client error — don't retry, it won't help
        if (res.status >= 400 && res.status < 500) {
          apiHealth.record('orthogonal', Date.now() - start, err.message);
          throw err;
        }

        // 5xx — record and retry
        apiHealth.record('orthogonal', Date.now() - start, err.message);
        if (attempt === 2) throw err;
        continue;
      }

      apiHealth.record('orthogonal', Date.now() - start);
      return body as T;
    } catch (err) {
      const latency = Date.now() - start;
      if (err instanceof OrthogonalError) {
        // Already recorded above; rethrow if not retryable
        if (err.status >= 400 && err.status < 500) throw err;
        if (attempt === 2) throw err;
        continue;
      }
      // Network / timeout errors
      apiHealth.record('orthogonal', latency, String(err));
      if (attempt === 2) throw err;
    }
  }

  // Should be unreachable
  throw new OrthogonalError('Max retries exceeded', 'MAX_RETRIES', 503);
}

// ─── Error class ────────────────────────────────────────────────────────────

export class OrthogonalError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public payload?: unknown
  ) {
    super(message);
    this.name = 'OrthogonalError';
  }
}

// ─── Catalog types ───────────────────────────────────────────────────────────

export interface ListEndpointsResponse {
  success: boolean;
  apis: ApiEntry[];
  count: number;
  totalEndpoints: number;
  pagination: { limit: number; offset: number; hasMore: boolean };
}

export interface ApiEntry {
  name: string;
  slug: string;
  description: string;
  baseUrl: string;
  verified: boolean;
  endpoints: EndpointEntry[];
}

export interface EndpointEntry {
  path: string;
  method: string;
  description: string;
  isPayable?: boolean;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResult[];
}

export interface SearchResult {
  api: string;
  slug: string;
  path: string;
  method: string;
  description: string;
  relevanceScore: number;
}

export interface RunResponse {
  success: boolean;
  data: unknown;
  cost: number;
  requestId: string;
}

export interface DetailsResponse {
  success: boolean;
  parameters: unknown;
  description: string;
}

// ─── OpenAI-compatible LLM types ─────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ─── Core Orthogonal API functions ───────────────────────────────────────────

export function listEndpoints(limit = 100, offset = 0): Promise<ListEndpointsResponse> {
  return orthogonalFetch<ListEndpointsResponse>(`/list-endpoints?limit=${limit}&offset=${offset}`);
}

export function searchApis(query: string): Promise<SearchResponse> {
  if (!query?.trim()) throw new Error('Search query must be a non-empty string');
  return orthogonalFetch<SearchResponse>('/search', {
    method: 'POST',
    body: JSON.stringify({ prompt: query }),
  });
}

export function runApi(api: string, path: string, body: Record<string, unknown>): Promise<RunResponse> {
  return orthogonalFetch<RunResponse>('/run', {
    method: 'POST',
    body: JSON.stringify({ api, path, body }),
  });
}

export function getDetails(api: string, path: string): Promise<DetailsResponse> {
  return orthogonalFetch<DetailsResponse>('/details', {
    method: 'POST',
    body: JSON.stringify({ api, path }),
  });
}

// ─── LLM via Orthogonal ──────────────────────────────────────────────────────

export async function chatCompletion(
  messages: ChatMessage[],
  tools?: OpenAITool[],
  model = 'gpt-4o-mini',
  toolChoice: 'auto' | 'required' = 'auto'
): Promise<ChatResponse> {
  const body: Record<string, unknown> = { model, messages, max_tokens: 8096 };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }
  const result = await runApi('openai', '/chat/completions', body);
  return result.data as ChatResponse;
}

export async function generateTitle(firstMessage: string): Promise<string> {
  const result = await chatCompletion([
    {
      role: 'user',
      content: `Summarize this in 4-6 words as a chat title (no quotes, no punctuation): ${firstMessage}`,
    },
  ]);
  return result.choices[0]?.message?.content?.trim() ?? 'New Conversation';
}

// ─── Tool execution with caching ─────────────────────────────────────────────

export type OrthogonalToolName =
  | 'search_orthogonal'
  | 'run_orthogonal_api'
  | 'list_orthogonal_apis'
  | 'get_api_details';

export async function executeOrthogonalTool(
  name: OrthogonalToolName,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'search_orthogonal': {
      const q = (input.query as string).toLowerCase().trim();
      return toolCache.getOrFetch(`search:${q}`, SEARCH_TTL, () => searchApis(input.query as string));
    }

    case 'get_api_details': {
      const key = `details:${input.api}:${input.path}`;
      return toolCache.getOrFetch(key, DETAILS_TTL, () =>
        getDetails(input.api as string, input.path as string)
      );
    }

    case 'list_orthogonal_apis':
      return listEndpoints((input.limit as number) ?? 30);

    case 'run_orthogonal_api':
      return runApi(
        input.api as string,
        input.path as string,
        (input.body as Record<string, unknown>) ?? {}
      );

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Tool definitions ────────────────────────────────────────────────────────

export const ORTHOGONAL_TOOLS: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'search_orthogonal',
      description:
        "Search Orthogonal's API catalog using natural language to find relevant APIs. Call this immediately when the user asks for data, research, contacts, or any actionable task — do not ask clarifying questions first.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What you want to do, e.g. "enrich a company by domain", "find contacts", "scrape a web page"',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_orthogonal_apis',
      description: 'List all available APIs on the Orthogonal platform.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max APIs to return (default 30)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_api_details',
      description:
        'Get detailed parameter info for a specific API endpoint. Call this for every (api, path) BEFORE calling run_orthogonal_api.',
      parameters: {
        type: 'object',
        properties: {
          api: { type: 'string', description: 'API slug (e.g. "apollo", "tavily")' },
          path: { type: 'string', description: 'Endpoint path' },
        },
        required: ['api', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_orthogonal_api',
      description:
        'Execute an API call through Orthogonal. MUST call get_api_details first. CRITICAL: substitute all path template variables (e.g. {domain}, [id], :slug) with real values directly in the path string — never leave placeholders. Pass only non-path params in body.',
      parameters: {
        type: 'object',
        properties: {
          api: { type: 'string', description: 'API slug' },
          path: {
            type: 'string',
            description:
              'Endpoint path with ALL template variables replaced by real values. E.g. "/v3/companies/stripe.com/news" not "/v3/companies/{domain}/news".',
          },
          body: {
            type: 'object',
            description: 'Non-path parameters (query params or body fields) as documented by get_api_details. Do not include path variables here.',
          },
        },
        required: ['api', 'path', 'body'],
      },
    },
  },
];
