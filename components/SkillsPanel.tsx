'use client';

import { useEffect, useState } from 'react';
import type { ApiEntry } from '@/lib/orthogonal';

const CATEGORY_MAP: Record<string, string[]> = {
  'AI & LLM': ['openai', 'perplexity', 'zai', 'baseten', 'parallel', 'nano-banana', 'nano-banana-2', 'exa', 'valyu'],
  'Search & Web': ['andi', 'tavily', 'serper', 'searchapi', 'seltz', 'linkup', 'jina-s', 'context-dev', 'serper-scrape'],
  'Company Data': ['apollo', 'tomba', 'hunter', 'contactout', 'peopledatalabs', 'coresignal', 'fiber', 'company-enrich', 'ocean-io', 'crustdata', 'predictleads', 'aviato', 'brand-dev', 'nyne', 'openfunnel'],
  'People & Contacts': ['sixtyfour', 'captaindata', 'edges', 'happenstance', 'fundable'],
  'Web Scraping': ['olostep', 'notte', 'riveter', 'scrapegraphai'],
  'Social Media': ['scrapecreators', 'influencers-club'],
  'Communication': ['textbelt', 'didit', 'agentmail', 'elevenlabs', 'tavus'],
  'Finance & Markets': ['dome'],
  'Other': ['precip', 'voygr', 'tako', 'openmart', 'logo'],
};

function getCategory(slug: string): string {
  for (const [cat, slugs] of Object.entries(CATEGORY_MAP)) {
    if (slugs.includes(slug)) return cat;
  }
  return 'Other';
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'bg-emerald-900/50 text-emerald-400 border-emerald-800',
    POST: 'bg-blue-900/50 text-blue-400 border-blue-800',
    PUT: 'bg-amber-900/50 text-amber-400 border-amber-800',
    PATCH: 'bg-purple-900/50 text-purple-400 border-purple-800',
    DELETE: 'bg-red-900/50 text-red-400 border-red-800',
  };
  return (
    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${colors[method] ?? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'}`}>
      {method}
    </span>
  );
}

function ApiCard({ api }: { api: ApiEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-surface-3 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-surface-2 text-left transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{api.name}</span>
            {api.verified && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-900/40 text-indigo-400 border border-indigo-800/50">
                verified
              </span>
            )}
            <span className="text-[10px] text-zinc-500 ml-auto shrink-0">
              {api.endpoints.length} endpoint{api.endpoints.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{api.description}</p>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-surface-3 divide-y divide-surface-3">
          {api.endpoints.map((ep, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 bg-surface-0">
              <MethodBadge method={ep.method} />
              <div className="flex-1 min-w-0">
                <code className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">{ep.path}</code>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-500 mt-0.5 line-clamp-2">{ep.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export default function SkillsPanel({ onClose }: Props) {
  const [apis, setApis] = useState<ApiEntry[]>([]);
  const [totalEndpoints, setTotalEndpoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/skills')
      .then((r) => r.json())
      .then((d) => {
        setApis(d.apis ?? []);
        setTotalEndpoints(d.totalEndpoints ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const categories = Object.keys(CATEGORY_MAP);

  const filtered = apis.filter((api) => {
    const matchesSearch =
      !search ||
      api.name.toLowerCase().includes(search.toLowerCase()) ||
      api.description.toLowerCase().includes(search.toLowerCase()) ||
      api.slug.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      !activeCategory || getCategory(api.slug) === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex flex-col w-96 border-l border-surface-3 bg-surface-1 shrink-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-3 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Available Skills</h2>
          {!loading && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {apis.length} APIs · {totalEndpoints} endpoints
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-3 text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-surface-3 shrink-0">
        <div className="flex items-center gap-2 bg-surface-2 border border-surface-3 rounded-lg px-3 py-1.5">
          <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search APIs…"
            className="flex-1 bg-transparent text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 outline-none"
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="flex gap-1.5 px-3 py-2 overflow-x-auto shrink-0 border-b border-surface-3">
        <button
          onClick={() => setActiveCategory(null)}
          className={`shrink-0 text-[10px] px-2 py-1 rounded-full border transition-colors ${
            !activeCategory
              ? 'bg-accent border-accent text-white'
              : 'border-surface-3 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`shrink-0 text-[10px] px-2 py-1 rounded-full border transition-colors ${
              activeCategory === cat
                ? 'bg-accent border-accent text-white'
                : 'border-surface-3 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* API list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full bg-zinc-600 animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-zinc-500 text-xs py-8">No APIs match your search</div>
        ) : (
          filtered.map((api) => <ApiCard key={api.slug} api={api} />)
        )}
      </div>
    </div>
  );
}
