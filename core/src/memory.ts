import type { ChatMessage, MemoryItem } from "./types";

/**
 * On-device memory retrieval with BM25. No embedding model needed, works for
 * Chinese (character bigrams) and English (lower-cased words) in the same index.
 * Swap in a vector index later behind the same `search` signature if needed.
 */

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const run of text.toLowerCase().match(/[一-鿿]+|[a-z0-9']+/g) ?? []) {
    if (/[一-鿿]/.test(run)) {
      if (run.length === 1) tokens.push(run);
      for (let i = 0; i + 1 < run.length; i++) tokens.push(run.slice(i, i + 2));
    } else if (run.length > 1) {
      tokens.push(run);
    }
  }
  return tokens;
}

interface Doc {
  item: MemoryItem;
  tf: Map<string, number>;
  len: number;
}

export class MemoryIndex {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private totalLen = 0;

  constructor(private readonly k1 = 1.4, private readonly b = 0.75) {}

  add(item: MemoryItem): void {
    const toks = tokenize(item.text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs.push({ item, tf, len: toks.length });
    this.totalLen += toks.length;
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, limit = 5): MemoryItem[] {
    const q = [...new Set(tokenize(query))];
    if (q.length === 0 || this.docs.length === 0) return [];
    const n = this.docs.length;
    const avg = this.totalLen / n;
    const scored: { item: MemoryItem; score: number }[] = [];
    for (const d of this.docs) {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / avg));
      }
      if (score > 0) scored.push({ item: d.item, score });
    }
    // Stories and facts the family wrote are more reliable than raw chat; nudge them up.
    for (const s of scored) if (s.item.kind !== "chat") s.score *= 1.25;
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item);
  }
}

/**
 * Turn chat history into retrievable windows of a few consecutive messages,
 * so a hit carries its context ("…你爸那天也在").
 */
export function chatToMemories(messages: ChatMessage[], windowSize = 6, idPrefix = "chat"): MemoryItem[] {
  const out: MemoryItem[] = [];
  for (let i = 0; i < messages.length; i += Math.max(1, Math.floor(windowSize / 2))) {
    const win = messages.slice(i, i + windowSize);
    if (win.length === 0) break;
    const date = win[0]!.time.slice(0, 10);
    out.push({
      id: `${idPrefix}-${i}`,
      kind: "chat",
      text: (date ? `[${date}] ` : "") + win.map((m) => `${m.sender}: ${m.text}`).join("\n"),
    });
    if (i + windowSize >= messages.length) break;
  }
  return out;
}
