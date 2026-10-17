import type { ChatMessage, StyleProfile } from "./types";

const EMOJI = /\p{Extended_Pictographic}|\[[一-龥A-Za-z]{1,4}\]/gu; // 😊 and WeChat-style [微笑]
const PARTICLES = ["呢", "啊", "呀", "哈", "嘛", "吧", "哦", "噢", "啦", "咯", "哟", "嗯", "喔"];
/** Function words: an English n-gram made only of these says nothing about a person. */
const STOP = new Set(
  "i me my you your we our it its is am are was were be been do did does have has had a an the and or but so to of in on at for with that this there what if just not no yes can will would i'm it's you're don't".split(" "),
);
const CJK = /[一-鿿]/;

function topN(counts: Map<string, number>, n: number, minCount = 2): string[] {
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k);
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

/** Short recurring phrases: CJK n-grams (3–5 chars) and English word bigrams. */
function phraseCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const run of text.match(/[一-鿿]{3,}/g) ?? []) {
    for (let n = 3; n <= 5; n++) {
      for (let i = 0; i + n <= run.length; i++) out.add(run.slice(i, i + n));
    }
  }
  // English: word bigrams and trigrams ("love you", "love you kiddo").
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (gram.every((w) => STOP.has(w))) continue;
      out.add(gram.join(" "));
    }
  }
  return [...out];
}

/** Drop phrases that are substrings of a more specific phrase with a similar count. */
function dedupePhrases(ranked: string[], counts: Map<string, number>): string[] {
  return ranked.filter(
    (p) => !ranked.some((q) => q !== p && q.includes(p) && (counts.get(q) ?? 0) >= 0.8 * (counts.get(p) ?? 0)),
  );
}

/**
 * Build a style profile from the deceased's own messages.
 * `self` is the sender name in the export that belongs to them.
 */
export function buildStyleProfile(messages: ChatMessage[], self: string, maxExamples = 12): StyleProfile {
  const own = messages.filter((m) => m.sender === self);
  const phraseCounts = new Map<string, number>();
  const emojiCounts = new Map<string, number>();
  const particleCounts = new Map<string, number>();
  let chars = 0;
  let exclaims = 0;

  for (const m of own) {
    chars += [...m.text].length;
    if (/[!！]\s*$/.test(m.text)) exclaims++;
    for (const e of m.text.match(EMOJI) ?? []) bump(emojiCounts, e);
    for (const p of phraseCandidates(m.text)) bump(phraseCounts, p);
    for (const clause of m.text.split(/[，。！？,.!?\s]+/)) {
      const last = clause.slice(-1);
      if (PARTICLES.includes(last)) bump(particleCounts, last);
    }
  }

  const minPhrase = Math.max(2, Math.floor(own.length / 200));
  const ranked = topN(phraseCounts, 60, minPhrase);
  const catchphrases = dedupePhrases(ranked, phraseCounts).slice(0, 15);

  // Few-shot examples: the other person's message immediately followed by theirs.
  const examples: { prompt: string; reply: string }[] = [];
  for (let i = 1; i < messages.length && examples.length < maxExamples * 4; i++) {
    const prev = messages[i - 1]!, cur = messages[i]!;
    if (cur.sender !== self || prev.sender === self) continue;
    if (cur.text.length < 4 || cur.text.length > 160 || prev.text.length > 160) continue;
    examples.push({ prompt: prev.text, reply: cur.text });
  }

  return {
    messageCount: own.length,
    avgChars: own.length ? Math.round(chars / own.length) : 0,
    catchphrases,
    emoji: topN(emojiCounts, 8),
    particles: topN(particleCounts, 5),
    exclaimRate: own.length ? exclaims / own.length : 0,
    examples: spreadSample(examples, maxExamples),
  };
}

/** Evenly spaced sample, so examples span years rather than one afternoon. */
function spreadSample<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]!);
}

export function isMostlyChinese(text: string): boolean {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return false;
  return letters.filter((c) => CJK.test(c)).length / letters.length > 0.5;
}
