const BASE_URL = 'https://api.orthogonal.com/v1';

function headers() {
  return {
    Authorization: `Bearer ${process.env.ORTHOGONAL_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function orthogonalFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers as Record<string, string> ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });

  const body = await res.json();

  if (!res.ok || !body.success) {
    throw new OrthogonalError(
      body.error ?? `HTTP ${res.status}`,
      body.code ?? 'UNKNOWN',
      res.status
    );
  }

  return body as T;
}

export class OrthogonalError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
    this.name = 'OrthogonalError';
  }
}

// ─── Catalog types ──────────────────────────────────────────────────────────

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

// ─── OpenAI-compatible LLM types ───────────────────────────────────────────

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
  function: {
    name: string;
    arguments: string;
  };
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
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Core Orthogonal API functions ──────────────────────────────────────────

export async function listEndpoints(
  limit = 100,
  offset = 0
): Promise<ListEndpointsResponse> {
  return orthogonalFetch<ListEndpointsResponse>(
    `/list-endpoints?limit=${limit}&offset=${offset}`
  );
}

export async function searchApis(query: string): Promise<SearchResponse> {
  return orthogonalFetch<SearchResponse>('/search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}

export async function runApi(
  api: string,
  path: string,
  body: Record<string, unknown>
): Promise<RunResponse> {
  return orthogonalFetch<RunResponse>('/run', {
    method: 'POST',
    body: JSON.stringify({ api, path, body }),
  });
}

export async function getDetails(
  api: string,
  path: string
): Promise<DetailsResponse> {
  return orthogonalFetch<DetailsResponse>('/details', {
    method: 'POST',
    body: JSON.stringify({ api, path }),
  });
}

// ─── LLM via Orthogonal (OpenAI) ─────────────────────────────────────────────

export async function chatCompletion(
  messages: ChatMessage[],
  tools?: OpenAITool[],
  model = 'gpt-4o-mini'
): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 8096,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
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

// ─── Tool execution ──────────────────────────────────────────────────────────

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
    case 'search_orthogonal':
      return searchApis(input.query as string);
    case 'list_orthogonal_apis':
      return listEndpoints((input.limit as number) ?? 30);
    case 'run_orthogonal_api':
      return runApi(
        input.api as string,
        input.path as string,
        (input.body as Record<string, unknown>) ?? {}
      );
    case 'get_api_details':
      return getDetails(input.api as string, input.path as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── OpenAI-format tool definitions ─────────────────────────────────────────

export const ORTHOGONAL_TOOLS: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'search_orthogonal',
      description:
        "Search Orthogonal's API catalog using natural language to find relevant APIs. Always search first if you don't know the slug.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'What you want to do, e.g. "enrich a company by domain", "find contacts", "scrape a web page"',
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
      description: 'Get detailed parameter info for a specific API endpoint.',
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
        'Execute an API call through Orthogonal and get real data back.',
      parameters: {
        type: 'object',
        properties: {
          api: { type: 'string', description: 'API slug' },
          path: { type: 'string', description: 'Endpoint path' },
          body: { type: 'object', description: 'Request body / query parameters' },
        },
        required: ['api', 'path', 'body'],
      },
    },
  },
];
