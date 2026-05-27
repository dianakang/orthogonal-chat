'use client';

import ReactMarkdown from 'react-markdown';

export interface ToolCallDisplay {
  name: string;
  input: unknown;
  result: unknown;
  error?: string | null;
  latencyMs?: number;
  retrying?: boolean;
}

export interface MessageData {
  id?: string;
  role: 'user' | 'assistant';
  // 'notice' renders as a compact inline system banner (context pressure, health)
  kind?: 'notice';
  content: string;
  tool_calls?: ToolCallDisplay[] | null;
  streaming?: boolean;
  statusText?: string;
}

const TOOL_LABELS: Record<string, string> = {
  search_orthogonal: 'Searched Orthogonal',
  list_orthogonal_apis: 'Listed APIs',
  get_api_details: 'Fetched API details',
  run_orthogonal_api: 'Called API',
};

function ToolCallBlock({ tool }: { tool: ToolCallDisplay }) {
  const label = TOOL_LABELS[tool.name] ?? tool.name;
  const isSlow = tool.latencyMs != null && tool.latencyMs > 4000;
  const isRetrying = tool.retrying === true;

  return (
    <div className="my-2 border border-surface-3 rounded-lg overflow-hidden text-xs">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 text-zinc-600 dark:text-zinc-400">
        <svg className="w-3.5 h-3.5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="font-medium flex-1">{label}</span>
        {tool.latencyMs != null && (
          <span className={`text-[10px] ${isSlow ? 'text-amber-500' : 'text-zinc-400'}`}>
            {tool.latencyMs < 1000 ? `${tool.latencyMs}ms` : `${(tool.latencyMs / 1000).toFixed(1)}s`}
            {isSlow && ' ⚠'}
          </span>
        )}
        {isRetrying && (
          <span className="text-zinc-400 font-medium">Retrying…</span>
        )}
        {tool.error && !isRetrying && (
          <span className="text-red-400 font-medium">Error</span>
        )}
      </div>
      <details className="group">
        <summary className="px-3 py-1.5 cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 list-none flex items-center gap-1">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          View result
        </summary>
        <pre className="px-3 py-2 text-zinc-700 dark:text-zinc-300 border-t border-surface-3 max-h-48 overflow-y-auto bg-surface-0 dark:bg-surface-0 font-mono whitespace-pre-wrap break-words">
          {JSON.stringify(tool.result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// Compact inline banner for system notices (context pressure, health events)
function NoticeBanner({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-2 my-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
      <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{content}</span>
    </div>
  );
}

export default function MessageBubble({ message }: { message: MessageData }) {
  const isUser = message.role === 'user';

  // System notice (context pressure, health event) — render as banner, not a chat bubble
  if (message.kind === 'notice') {
    return <NoticeBanner content={message.content} />;
  }

  if (isUser) {
    return (
      <div className="flex justify-end py-2">
        <div className="max-w-[80%] bg-accent text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 py-3">
      <div className="shrink-0 w-8 h-8 rounded-2xl bg-surface-2 border border-surface-3 flex items-center justify-center mt-0.5">
        <svg className="w-4 h-4 text-accent" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        {message.statusText && !message.content && (
          <div className="flex items-center gap-2 text-sm text-zinc-500 py-1">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:300ms]" />
            </div>
            {message.statusText}
          </div>
        )}

        {message.tool_calls?.map((tool, i) => (
          <ToolCallBlock key={i} tool={tool} />
        ))}

        {message.content && (
          <div className="prose-chat text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed">
            <ReactMarkdown>{message.content}</ReactMarkdown>
            {message.streaming && (
              <span className="inline-block w-2 h-4 bg-zinc-400 ml-0.5 animate-pulse align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
