import { query } from './db';

export interface CompanyFact {
  slug: string;
  data: Record<string, unknown>;
}

// Pull company facts out of raw tool-call results.
// Looks for common field names returned by company enrichment, funding, and
// people-lookup APIs so the memory is populated without extra LLM calls.
export function extractCompanyFacts(
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>
): CompanyFact[] {
  const facts = new Map<string, Record<string, unknown>>();

  for (const tool of toolCalls) {
    if (tool.name !== 'run_orthogonal_api') continue;
    const result = tool.result as Record<string, unknown> | null;
    if (!result || result.error) continue;

    const raw = result.data ?? result;
    const items: unknown[] = Array.isArray(raw) ? raw : [raw];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;

      // Flatten one level of nesting (e.g. { attributes: { domain: '...' } })
      const attrs =
        obj.attributes && typeof obj.attributes === 'object'
          ? { ...obj, ...(obj.attributes as Record<string, unknown>) }
          : obj;

      const domain =
        (attrs.domain as string | undefined) ??
        (attrs.company_domain as string | undefined) ??
        (attrs.website as string | undefined);
      const name =
        (attrs.name as string | undefined) ??
        (attrs.company_name as string | undefined);

      const slug =
        domain?.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '') ??
        (name ? name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : null);

      if (!slug || slug.length > 100) continue;

      const existing = facts.get(slug) ?? {};
      const patch: Record<string, unknown> = {};
      if (domain) patch.domain = domain;
      if (name) patch.name = name;
      for (const key of ['industry', 'description', 'employee_count', 'total_raised', 'location', 'founded_year']) {
        if (attrs[key] != null) patch[key] = attrs[key];
      }

      facts.set(slug, { ...existing, ...patch });
    }
  }

  return Array.from(facts.entries())
    .filter(([, d]) => Object.keys(d).length > 0)
    .map(([slug, data]) => ({ slug, data }));
}

export async function saveCompanyFacts(userId: string, facts: CompanyFact[]): Promise<void> {
  if (!facts.length) return;
  // Upsert individually — small batch, avoids dynamic param building
  await Promise.all(
    facts.map((f) =>
      query(
        `INSERT INTO company_memory (user_id, slug, data, last_seen_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, slug) DO UPDATE
           SET data = company_memory.data || EXCLUDED.data,
               last_seen_at = NOW()`,
        [userId, f.slug, JSON.stringify(f.data)]
      )
    )
  );
}

export async function getRecentCompanyMemory(
  userId: string,
  limit = 15
): Promise<CompanyFact[]> {
  const rows = await query<{ slug: string; data: Record<string, unknown> }>(
    `SELECT slug, data FROM company_memory
     WHERE user_id = $1
     ORDER BY last_seen_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => ({ slug: r.slug, data: r.data }));
}

// Format company memory for injection into the system prompt.
export function formatCompanyMemory(facts: CompanyFact[]): string {
  if (!facts.length) return '';
  const lines = facts.map(({ slug, data }) => {
    const parts: string[] = [`**${(data.name as string | undefined) ?? slug}**`];
    if (data.domain) parts.push(`domain: ${data.domain}`);
    if (data.industry) parts.push(`industry: ${data.industry}`);
    if (data.employee_count) parts.push(`employees: ${data.employee_count}`);
    if (data.total_raised) parts.push(`raised: ${data.total_raised}`);
    if (data.description) parts.push((data.description as string).slice(0, 120));
    return `- ${parts.join(' | ')}`;
  });
  return `## Company Memory (from previous sessions)\n${lines.join('\n')}`;
}
