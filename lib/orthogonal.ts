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
    signal: AbortSignal.timeout(30_000),
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

export async function listEndpoints(
  limit = 50,
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

export const ORTHOGONAL_TOOLS = [
  {
    name: 'search_orthogonal',
    description:
      'Search Orthogonal\'s API catalog using natural language to find relevant APIs for a task. Returns matching APIs with their slugs and endpoints. Always search before running an API if you don\'t already know the slug.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language description of what you want to do or find (e.g. "enrich a company by domain", "find contacts at a company", "scrape a web page")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_orthogonal_apis',
    description:
      'List all available APIs on the Orthogonal platform. Use this to browse what\'s available when you don\'t have a specific task in mind.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of APIs to return (default: 30, max: 100)',
        },
      },
    },
  },
  {
    name: 'get_api_details',
    description:
      'Get detailed parameter information for a specific API endpoint. Use this after finding an API via search to understand exactly what parameters to pass.',
    input_schema: {
      type: 'object' as const,
      properties: {
        api: { type: 'string', description: 'The API slug (e.g. "apollo", "clearbit", "olostep")' },
        path: { type: 'string', description: 'The endpoint path (e.g. "/api/v1/mixed_people/api_search")' },
      },
      required: ['api', 'path'],
    },
  },
  {
    name: 'run_orthogonal_api',
    description:
      'Execute an API call through Orthogonal. Use the slug from search results as the `api` parameter. Returns real data from the provider.',
    input_schema: {
      type: 'object' as const,
      properties: {
        api: { type: 'string', description: 'The API slug (e.g. "apollo", "clearbit", "olostep")' },
        path: { type: 'string', description: 'The endpoint path to call' },
        body: {
          type: 'object',
          description: 'The request body parameters for the API call',
        },
      },
      required: ['api', 'path', 'body'],
    },
  },
];
