'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConversationSidebar from './ConversationSidebar';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
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
      <ConversationSidebar
        activeId={conversationId}
        onSelect={loadConversation}
        onNew={startNewConversation}
        refreshTrigger={sidebarRefresh}
      />

      <main className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-surface-3 bg-surface-1 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-accent flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-sm font-semibold text-zinc-100">Orthogonal Chat</h1>
          </div>
          <span className="text-xs text-zinc-500">Powered by Claude + Orthogonal APIs</span>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-zinc-100 mb-2">What would you like to know?</h2>
              <p className="text-sm text-zinc-500 max-w-sm">
                Ask about companies, find contacts, search the web, or explore any of the 100+ APIs available through Orthogonal.
              </p>
              <div className="grid grid-cols-2 gap-3 mt-6 max-w-md w-full">
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
                    className="text-left px-4 py-3 rounded-xl bg-surface-2 border border-surface-3 hover:border-accent text-xs text-zinc-400 hover:text-zinc-100 transition-all"
                  >
                    {suggestion}
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

        <ChatInput onSend={handleSend} disabled={streaming} />
      </main>
    </div>
  );
}
