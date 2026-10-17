/**
 * Viseme lip-sync for the stylized avatar. Pure TypeScript, no native deps.
 *
 * Pipeline: reply text → rough phonemes (English letter-to-sound rules; CJK
 * characters as consonant+vowel syllables) → visemes with relative weights →
 * a timeline stretched to the real TTS audio duration → per-frame mouth shape
 * blended with dominance-weighted coarticulation (Cohen–Massaro style), with
 * optional modulation by the audio's loudness envelope.
 *
 * The TTS engine (llama.rn) gives no word or phoneme timestamps, so timing is
 * estimated from text and stretched to fit; the loudness envelope corrects
 * for pauses the text can't predict.
 */

/** 12 mouth shapes, a common cartoon set (Preston Blair / Rhubarb-like). */
export type Viseme =
  | "rest" // silence, lips relaxed and closed
  | "MBP" // m b p — lips pressed
  | "FV" // f v — lower lip under top teeth
  | "TH" // th — tongue between teeth
  | "L" // l — tongue up, mouth slightly open
  | "CDG" // t d n s z k g h y r … — teeth close, slightly open
  | "CH" // sh ch j zh — lips pushed forward, teeth close
  | "A" // a ah — wide open
  | "E" // e eh ae — mid open, wide
  | "I" // ee i — spread, small opening
  | "O" // o aw — round, open
  | "U"; // oo w u — round, small

export const VISEMES: readonly Viseme[] = ["rest", "MBP", "FV", "TH", "L", "CDG", "CH", "A", "E", "I", "O", "U"];

/** Mouth geometry in normalised units. */
export interface MouthShape {
  /** Jaw/lip opening, 0 closed … 1 wide open. */
  open: number;
  /** Mouth width relative to neutral (1). */
  width: number;
  /** Lip rounding/protrusion, 0 … 1. */
  round: number;
  /** Visibility of upper teeth, 0 … 1. */
  teeth: number;
}

export const VISEME_SHAPES: Record<Viseme, MouthShape> = {
  rest: { open: 0, width: 1, round: 0, teeth: 0 },
  MBP: { open: 0, width: 0.95, round: 0, teeth: 0 },
  FV: { open: 0.12, width: 1, round: 0, teeth: 1 },
  TH: { open: 0.2, width: 1, round: 0, teeth: 0.6 },
  L: { open: 0.35, width: 1, round: 0.1, teeth: 0.4 },
  CDG: { open: 0.22, width: 1.05, round: 0, teeth: 0.8 },
  CH: { open: 0.25, width: 0.8, round: 0.6, teeth: 0.7 },
  A: { open: 0.9, width: 1.1, round: 0.1, teeth: 0.3 },
  E: { open: 0.55, width: 1.2, round: 0, teeth: 0.5 },
  I: { open: 0.3, width: 1.3, round: 0, teeth: 0.7 },
  O: { open: 0.65, width: 0.75, round: 0.9, teeth: 0 },
  U: { open: 0.3, width: 0.6, round: 1, teeth: 0 },
};

/**
 * How strongly a viseme holds its shape against its neighbours. Lip closures
 * and lip-teeth contacts must be reached or the speech looks wrong; tongue
 * consonants are mostly invisible and give way to surrounding vowels.
 */
export const DOMINANCE: Record<Viseme, number> = {
  rest: 1.5, MBP: 6, FV: 4, TH: 1.2, L: 0.8, CDG: 0.5, CH: 1.5, A: 1, E: 1, I: 1, O: 1.2, U: 1.4,
};

/** Relative duration of a viseme in the text-only timing estimate. */
const WEIGHT: Record<Viseme, number> = {
  rest: 1, MBP: 0.7, FV: 0.8, TH: 0.7, L: 0.6, CDG: 0.55, CH: 0.8, A: 1.2, E: 1, I: 0.9, O: 1.2, U: 1.1,
};

export interface VisemeToken {
  viseme: Viseme;
  /** Relative length; pauses carry larger weights. */
  weight: number;
}

const isVowel = (c: string) => "aeiouy".includes(c);
const PAUSE_LONG = /[.!?。！？…]/;
const PAUSE_SHORT = /[,;:，、；：—–\-()（）"“”]/;
const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

// Multi-letter graphemes first (longest match wins).
const GRAPHEMES: [string, Viseme[]][] = [
  ["tch", ["CH"]], ["igh", ["A", "I"]], ["ough", ["O"]], ["augh", ["O"]],
  ["th", ["TH"]], ["sh", ["CH"]], ["ch", ["CH"]], ["ph", ["FV"]], ["wh", ["U"]], ["ck", ["CDG"]],
  ["ng", ["CDG"]], ["qu", ["CDG", "U"]], ["gh", []], ["kn", ["CDG"]], ["wr", ["CDG"]],
  ["oo", ["U"]], ["ee", ["I"]], ["ea", ["I"]], ["ie", ["I"]], ["ou", ["A", "U"]], ["ow", ["O", "U"]],
  ["oa", ["O"]], ["oi", ["O", "I"]], ["oy", ["O", "I"]], ["ai", ["E", "I"]], ["ay", ["E", "I"]],
  ["au", ["O"]], ["aw", ["O"]], ["ew", ["I", "U"]], ["ue", ["U"]], ["ei", ["E", "I"]], ["ey", ["E", "I"]],
];

const LETTER: Record<string, Viseme> = {
  a: "A", e: "E", i: "I", o: "O", u: "U", y: "I",
  b: "MBP", m: "MBP", p: "MBP", f: "FV", v: "FV", w: "U", l: "L", r: "CH",
  j: "CH", c: "CDG", d: "CDG", g: "CDG", h: "CDG", k: "CDG", n: "CDG", q: "CDG", s: "CDG", t: "CDG", x: "CDG", z: "CDG",
};

/** Rough English letter-to-viseme conversion for one lowercase word. */
export function wordToVisemes(word: string): Viseme[] {
  const w = word.toLowerCase().replace(/[^a-z']/g, "").replace(/'/g, "");
  const out: Viseme[] = [];
  // Silent final "e" (make, love) but not in short words (be, he, the).
  const end = w.length > 3 && w.endsWith("e") && !isVowel(w[w.length - 2]!) ? w.length - 1 : w.length;
  let i = 0;
  while (i < end) {
    const g = GRAPHEMES.find(([k]) => w.startsWith(k, i) && i + k.length <= end);
    if (g) {
      out.push(...g[1]);
      i += g[0].length;
      continue;
    }
    const c = w[i]!;
    const v = LETTER[c];
    // Doubled consonants are one sound (hello, summer).
    if (v && !(i > 0 && w[i - 1] === c && !isVowel(c))) out.push(v);
    i++;
  }
  // Collapse immediate repeats.
  return out.filter((v, k) => k === 0 || v !== out[k - 1]);
}

const CJK_ONSETS: Viseme[] = ["CDG", "MBP", "CH", "CDG", "FV", "L", "CDG", "CH"];
const CJK_VOWELS: Viseme[] = ["A", "E", "I", "O", "U", "A", "O", "E"];

/**
 * A CJK character is one syllable. Without a pronunciation dictionary we can't
 * know its sound, so pick a plausible consonant+vowel pair deterministically
 * from the code point: the rhythm (one open-close per character) is what reads.
 */
export function cjkToVisemes(ch: string): Viseme[] {
  const cp = ch.codePointAt(0) ?? 0;
  return [CJK_ONSETS[cp % CJK_ONSETS.length]!, CJK_VOWELS[(cp >> 3) % CJK_VOWELS.length]!];
}

/** Convert text into viseme tokens with relative weights, including pauses. */
export function textToVisemes(text: string): VisemeToken[] {
  const out: VisemeToken[] = [];
  const push = (viseme: Viseme, weight: number) => {
    const last = out[out.length - 1];
    if (last && last.viseme === viseme && viseme === "rest") last.weight += weight;
    else out.push({ viseme, weight });
  };
  // Words, single CJK characters, digits, or punctuation.
  const parts = text.match(/[A-Za-z']+|[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]|\d+|[^\sA-Za-z\d]|\s+/g) ?? [];
  for (const p of parts) {
    if (/^\s+$/.test(p)) {
      if (out.length) push("rest", 0.25);
    } else if (PAUSE_LONG.test(p)) {
      if (out.length) push("rest", 3);
    } else if (PAUSE_SHORT.test(p)) {
      if (out.length) push("rest", 1.5);
    } else if (CJK.test(p)) {
      for (const v of cjkToVisemes(p)) push(v, WEIGHT[v]);
    } else if (/^\d+$/.test(p)) {
      // Each digit spoken as roughly a two-sound syllable.
      for (let k = 0; k < p.length; k++) {
        push("CDG", WEIGHT.CDG);
        push(k % 2 ? "I" : "E", WEIGHT.E);
      }
    } else if (/^[A-Za-z']+$/.test(p)) {
      for (const v of wordToVisemes(p)) push(v, WEIGHT[v]);
    }
  }
  // Trim trailing rest; the timeline adds its own lead-out.
  while (out.length && out[out.length - 1]!.viseme === "rest") out.pop();
  return out;
}

export interface VisemeKey {
  viseme: Viseme;
  /** Start time in ms from audio start. */
  start: number;
  end: number;
}

export interface TimelineOptions {
  /** Silence before speech starts (TTS lead-in), ms. */
  leadInMs?: number;
  /** Silence after speech ends, ms. */
  leadOutMs?: number;
}

/** Spread viseme tokens across the audio's real duration. */
export function buildTimeline(tokens: VisemeToken[], durationMs: number, opts: TimelineOptions = {}): VisemeKey[] {
  const leadIn = Math.min(opts.leadInMs ?? 60, durationMs / 4);
  const leadOut = Math.min(opts.leadOutMs ?? 120, durationMs / 4);
  const span = Math.max(0, durationMs - leadIn - leadOut);
  const total = tokens.reduce((s, t) => s + t.weight, 0);
  const keys: VisemeKey[] = [];
  if (leadIn > 0) keys.push({ viseme: "rest", start: 0, end: leadIn });
  let t = leadIn;
  for (const tok of tokens) {
    const d = total > 0 ? (tok.weight / total) * span : 0;
    keys.push({ viseme: tok.viseme, start: t, end: t + d });
    t += d;
  }
  keys.push({ viseme: "rest", start: t, end: Math.max(t, durationMs) });
  return keys;
}

/**
 * RMS loudness envelope, normalised so the loud 95th percentile is 1.
 * `frameMs` frames; returns one value per frame.
 */
export function amplitudeEnvelope(samples: ArrayLike<number>, sampleRate: number, frameMs = 20): Float32Array {
  const frame = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const n = Math.ceil(samples.length / frame);
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    const a = f * frame;
    const b = Math.min(samples.length, a + frame);
    for (let i = a; i < b; i++) sum += samples[i]! * samples[i]!;
    env[f] = Math.sqrt(sum / Math.max(1, b - a));
  }
  const sorted = Array.from(env).sort((x, y) => x - y);
  const ref = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (ref > 1e-6) for (let f = 0; f < n; f++) env[f] = Math.min(1, env[f]! / ref);
  return env;
}

export interface LipSyncTrack {
  keys: VisemeKey[];
  durationMs: number;
  envelope?: Float32Array;
  envelopeFrameMs?: number;
}

/** Build a track for a reply: text timing stretched to the audio, plus loudness if available. */
export function lipSyncTrack(
  text: string,
  durationMs: number,
  audio?: { samples: ArrayLike<number>; sampleRate: number },
): LipSyncTrack {
  const frameMs = 20;
  return {
    keys: buildTimeline(textToVisemes(text), durationMs),
    durationMs,
    ...(audio ? { envelope: amplitudeEnvelope(audio.samples, audio.sampleRate, frameMs), envelopeFrameMs: frameMs } : {}),
  };
}

export interface SampleOptions {
  /** Width of each viseme's influence (Gaussian sigma) as a fraction of its duration. */
  spread?: number;
  /** Minimum sigma in ms so very short visemes still blend. */
  minSigmaMs?: number;
  /** How much loudness modulates opening (0 = ignore, 1 = fully). */
  envelopeAmount?: number;
}

const REST = VISEME_SHAPES.rest;

function envelopeAt(track: LipSyncTrack, t: number): number | undefined {
  const e = track.envelope;
  if (!e || !e.length) return undefined;
  const x = t / (track.envelopeFrameMs ?? 20);
  const i = Math.floor(x);
  if (i < 0) return e[0];
  if (i >= e.length - 1) return e[e.length - 1];
  return e[i]! + (e[i + 1]! - e[i]!) * (x - i);
}

/**
 * Mouth shape at time `t` (ms). Each viseme exerts influence that peaks at its
 * centre and falls off as a Gaussian, scaled by its dominance; the shape is
 * the normalised weighted average. This gives smooth transitions and
 * anticipation (lips start rounding before an "oo") while closures still close.
 */
export function sampleMouth(track: LipSyncTrack, t: number, opts: SampleOptions = {}): MouthShape {
  const spread = opts.spread ?? 0.3;
  const minSigma = opts.minSigmaMs ?? 22;
  const keys = track.keys;
  if (!keys.length || t <= 0 || t >= track.durationMs) return { ...REST };

  // Find the active key, then only look at near neighbours.
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid]!.start <= t) lo = mid;
    else hi = mid - 1;
  }
  const acc = { open: 0, width: 0, round: 0, teeth: 0 };
  let wsum = 0;
  for (let k = Math.max(0, lo - 3); k <= Math.min(keys.length - 1, lo + 3); k++) {
    const key = keys[k]!;
    const dur = key.end - key.start;
    if (dur <= 0) continue;
    const c = (key.start + key.end) / 2;
    const sigma = Math.max(minSigma, dur * spread);
    // Inside its own interval a viseme is at full strength; outside it decays.
    const dist = t < key.start ? key.start - t : t > key.end ? t - key.end : 0;
    const centre = Math.abs(t - c) / (dur / 2 + 1e-9);
    // Outside: Gaussian fall-off (anticipation/carry-over). Inside: rises to the
    // viseme's dominance at its centre, continuous (=1) at its edges.
    const w = dist > 0 ? Math.exp(-(dist * dist) / (2 * sigma * sigma)) : 1 + (DOMINANCE[key.viseme] - 1) * Math.max(0, 1 - centre * centre);
    const s = VISEME_SHAPES[key.viseme];
    acc.open += w * s.open;
    acc.width += w * s.width;
    acc.round += w * s.round;
    acc.teeth += w * s.teeth;
    wsum += w;
  }
  if (wsum <= 0) return { ...REST };
  const out: MouthShape = { open: acc.open / wsum, width: acc.width / wsum, round: acc.round / wsum, teeth: acc.teeth / wsum };

  const env = envelopeAt(track, t);
  const amount = opts.envelopeAmount ?? 0.6;
  if (env !== undefined && amount > 0) {
    // Quiet audio closes the mouth even if the text estimate says "open".
    out.open *= 1 - amount + amount * Math.min(1, env * 1.2);
  }
  return out;
}

/**
 * Reduced-motion variant: no blending, just the active viseme snapped to one
 * of three openings, so the mouth moves less and less often.
 */
export function sampleMouthReduced(track: LipSyncTrack, t: number): MouthShape {
  const k = track.keys.find((x) => t >= x.start && t < x.end);
  if (!k) return { ...REST };
  const s = VISEME_SHAPES[k.viseme];
  const open = s.open < 0.15 ? 0 : s.open < 0.5 ? 0.3 : 0.6;
  return { open, width: 1, round: 0, teeth: 0 };
}
