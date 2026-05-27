'use client';

import { useEffect, useState } from 'react';
import type { Conversation } from '@/lib/db';

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  refreshTrigger: number;
}

export default function ConversationSidebar({ activeId, onSelect, onNew, refreshTrigger }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshTrigger]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) onNew();
  }

  return (
    <aside className="flex flex-col w-64 border-r border-surface-3 bg-surface-1 shrink-0">
      <div className="p-4 border-b border-surface-3">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-3 hover:bg-surface-2 text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">Loading…</div>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">No conversations yet</div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`group flex items-center gap-2 px-3 py-2 mx-2 my-0.5 rounded-lg cursor-pointer transition-colors ${
                c.id === activeId
                  ? 'bg-surface-3 text-white'
                  : 'hover:bg-surface-2 text-zinc-400 hover:text-zinc-100'
              }`}
            >
              <svg className="w-4 h-4 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="flex-1 text-sm truncate">{c.title}</span>
              <button
                onClick={(e) => handleDelete(c.id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-400 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-surface-3">
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <span className="text-xs text-zinc-500">Orthogonal connected</span>
        </div>
      </div>
    </aside>
  );
}
