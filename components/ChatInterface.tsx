'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConversationSidebar from './ConversationSidebar';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import SkillsPanel from './SkillsPanel';
import ThemeToggle from './ThemeToggle';
import type { MessageData, ToolCallDisplay } from './MessageBubble';
import type { Message } from '@/lib/db';

function dbMessageToDisplay(msg: Message): MessageData {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    tool_calls: msg.tool_calls as ToolCallDisplay[] | null,
  };
}

export default function ChatInterface() {
  const [showSkills, setShowSkills] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function loadConversation(id: string) {
    setConversationId(id);
    setMessages([]);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      const data = await res.json();
      setMessages((data.messages ?? []).map(dbMessageToDisplay));
    } catch (err) {
      console.error('Failed to load messages', err);
    }
  }

  function startNewConversation() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
  }

  async function handleSend(userMessage: string) {
    if (streaming) return;

    const userMsg: MessageData = { role: 'user', content: userMessage };
    const assistantMsg: MessageData = {
      role: 'assistant',
      content: '',
      tool_calls: [],
      streaming: true,
      statusText: 'Thinking…',
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, conversationId }),
        signal: abortRef.current.signal,
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          handleSseEvent(event);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            streaming: false,
            statusText: undefined,
            content: last.content || 'Something went wrong. Please try again.',
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
      setSidebarRefresh((n) => n + 1);
      // Clear streaming flag on last assistant message
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, streaming: false, statusText: undefined };
        }
        return updated;
      });
    }
  }

  function handleSseEvent(event: Record<string, unknown>) {
    switch (event.type) {
      case 'conversation_created': {
        const conv = event.conversation as { id: string };
        setConversationId(conv.id);
        setSidebarRefresh((n) => n + 1);
        break;
      }

      case 'status':
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, statusText: event.message as string };
          }
          return updated;
        });
        break;

      case 'text':
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + (event.content as string),
              statusText: undefined,
            };
          }
          return updated;
        });
        break;

      case 'tool_start':
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            const pending: ToolCallDisplay = {
              name: event.name as string,
              input: event.input,
              result: null,
            };
            updated[updated.length - 1] = {
              ...last,
              tool_calls: [...(last.tool_calls ?? []), pending],
              statusText: 'Fetching data…',
            };
          }
          return updated;
        });
        break;

      case 'tool_result':
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            const toolCalls = [...(last.tool_calls ?? [])];
            const idx = toolCalls.findLastIndex((t) => t.name === event.name && t.result === null);
            if (idx >= 0) {
              toolCalls[idx] = {
                ...toolCalls[idx],
                result: event.result,
                error: (event.error as string | null) ?? null,
              };
            }
            updated[updated.length - 1] = { ...last, tool_calls: toolCalls, statusText: 'Processing results…' };
          }
          return updated;
        });
        break;

      case 'done':
        break;

      case 'error':
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              streaming: false,
              statusText: undefined,
              content: last.content || `Error: ${event.message}`,
            };
          }
          return updated;
        });
        break;
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      {!sidebarCollapsed && (
        <ConversationSidebar
          activeId={conversationId}
          onSelect={loadConversation}
          onNew={startNewConversation}
          refreshTrigger={sidebarRefresh}
          onCollapse={() => setSidebarCollapsed(true)}
        />
      )}

      <main className="relative flex flex-col flex-1 min-w-0">
        {/* Top bar (Julius-like minimal controls) */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-surface-3 bg-surface-1/70 backdrop-blur shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="inline-flex items-center justify-center h-9 w-9 rounded-xl border border-surface-3 bg-surface-1 hover:bg-surface-2 transition-colors"
                aria-label="Open sidebar"
              >
                <svg className="w-4 h-4 text-zinc-600 dark:text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}

            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-accent flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">Orthogonal Chat</div>
                <div className="text-[11px] text-zinc-500 truncate hidden sm:block">Search & call real APIs with one key</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => setShowSkills((v) => !v)}
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-medium border transition-colors ${
                showSkills
                  ? 'bg-accent text-white border-transparent'
                  : 'bg-surface-1 border-surface-3 text-zinc-600 dark:text-zinc-300 hover:bg-surface-2'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Skills
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6">
            {isEmpty ? (
              <div className="pt-10 sm:pt-16">
                <div className="max-w-2xl">
                  <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    What can I help you build or find?
                  </h2>
                  <p className="mt-3 text-sm sm:text-base text-zinc-600 dark:text-zinc-400">
                    Ask in natural language. I’ll search Orthogonal’s catalog, fetch endpoint details, and call real APIs when needed.
                  </p>
                </div>

                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    'Find contacts at OpenAI',
                    'Enrich company: stripe.com',
                    'What APIs are available?',
                    'Scrape https://example.com',
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => handleSend(suggestion)}
                      disabled={streaming}
                      className="text-left p-4 rounded-2xl bg-surface-1 border border-surface-3 hover:bg-surface-2 transition-colors"
                    >
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{suggestion}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        Click to send
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {messages.map((msg, i) => (
                  <MessageBubble key={msg.id ?? i} message={msg} />
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>

        <ChatInput onSend={handleSend} disabled={streaming} />
      </main>

      {showSkills && <SkillsPanel onClose={() => setShowSkills(false)} />}
    </div>
  );
}
