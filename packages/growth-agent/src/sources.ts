import type { ResearchSource, SourceItem, SourceResult } from "./types.js";

async function timed<T>(source: string, operation: () => Promise<T>): Promise<{ value?: T; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    return { value: await operation(), latencyMs: Date.now() - started };
  } catch (error) {
    return { latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

export class HackerNewsSource implements ResearchSource {
  readonly name = "hackernews";
  constructor(private readonly maxItems: number) {}

  async fetch(_window: { from: Date; to: Date }): Promise<SourceResult> {
    const result = await timed(this.name, async () => {
      const response = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json", { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HN returned ${response.status}`);
      const ids = (await response.json() as number[]).slice(0, this.maxItems);
      const rows = await Promise.all(ids.map(async (id) => {
        const item = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(10_000) });
        if (!item.ok) throw new Error(`HN item ${id} returned ${item.status}`);
        return item.json() as Promise<Record<string, unknown>>;
      }));
      return rows.map((row): SourceItem => ({
        source: this.name,
        externalId: String(row.id),
        url: typeof row.url === "string" ? row.url : `https://news.ycombinator.com/item?id=${row.id}`,
        title: String(row.title ?? "Untitled"),
        observedAt: new Date().toISOString(),
        publishedAt: new Date(Number(row.time) * 1000).toISOString(),
        score: Number(row.score ?? 0),
        metadata: { by: row.by, descendants: row.descendants }
      }));
    });
    return {
      items: result.value ?? [],
      status: {
        source: this.name, ok: !result.error, checkedAt: new Date().toISOString(), latencyMs: result.latencyMs,
        ...(result.error ? { error: result.error } : {})
      }
    };
  }
}

export function configuredSources(config: Record<string, { enabled: boolean; maxItems: number }>): ResearchSource[] {
  const sources: ResearchSource[] = [];
  if (config.hackernews?.enabled) sources.push(new HackerNewsSource(config.hackernews.maxItems));
  return sources;
}
