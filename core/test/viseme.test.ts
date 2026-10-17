import { describe, expect, it } from "vitest";
import {
  amplitudeEnvelope,
  buildTimeline,
  cjkToVisemes,
  lipSyncTrack,
  sampleMouth,
  sampleMouthReduced,
  textToVisemes,
  VISEME_SHAPES,
  VISEMES,
  wordToVisemes,
  type LipSyncTrack,
} from "../src/viseme";

const vis = (t: string) => textToVisemes(t).map((x) => x.viseme);

describe("wordToVisemes", () => {
  it("maps bilabials, labiodentals and vowels", () => {
    expect(wordToVisemes("mom")).toEqual(["MBP", "O", "MBP"]);
    expect(wordToVisemes("five")).toEqual(["FV", "I", "FV"]);
    expect(wordToVisemes("bob")).toEqual(["MBP", "O", "MBP"]);
  });

  it("handles common digraphs", () => {
    expect(wordToVisemes("the")).toEqual(["TH", "E"]);
    expect(wordToVisemes("sheep")).toEqual(["CH", "I", "MBP"]);
    expect(wordToVisemes("phone")).toEqual(["FV", "O", "CDG"]);
    expect(wordToVisemes("moon")).toEqual(["MBP", "U", "CDG"]);
    expect(wordToVisemes("see")).toEqual(["CDG", "I"]);
    expect(wordToVisemes("night")).toEqual(["CDG", "A", "I", "CDG"]);
    expect(wordToVisemes("queen")).toEqual(["CDG", "U", "I", "CDG"]);
  });

  it("drops silent final e and doubled consonants", () => {
    expect(wordToVisemes("make")).toEqual(["MBP", "A", "CDG"]);
    expect(wordToVisemes("hello")).toEqual(["CDG", "E", "L", "O"]);
    expect(wordToVisemes("summer")).toEqual(["CDG", "U", "MBP", "E", "CH"]);
  });

  it("is case- and apostrophe-insensitive and never emits repeats", () => {
    expect(wordToVisemes("I'M")).toEqual(wordToVisemes("im"));
    const v = wordToVisemes("bubble");
    for (let i = 1; i < v.length; i++) expect(v[i]).not.toBe(v[i - 1]);
  });

  it("only emits known visemes", () => {
    for (const w of ["xylophone", "rhythm", "strength", "queue", "through", "laugh", "a", ""]) {
      for (const v of wordToVisemes(w)) expect(VISEMES).toContain(v);
    }
  });
});

describe("textToVisemes", () => {
  it("inserts pauses for punctuation, longer for sentence ends", () => {
    const t = textToVisemes("Hi, mom. Bye");
    const rests = t.filter((x) => x.viseme === "rest");
    expect(rests.length).toBe(2);
    expect(rests[1]!.weight).toBeGreaterThan(rests[0]!.weight);
  });

  it("trims leading and trailing silence", () => {
    const v = vis("  ...hello!  ");
    expect(v[0]).not.toBe("rest");
    expect(v[v.length - 1]).not.toBe("rest");
  });

  it("gives every CJK character an onset and a vowel", () => {
    const v = vis("你好");
    expect(v).toHaveLength(4);
    expect(cjkToVisemes("你")).toEqual(cjkToVisemes("你")); // deterministic
    for (const ch of "我想你了妈妈") {
      const [c, vw] = cjkToVisemes(ch);
      expect(["A", "E", "I", "O", "U"]).toContain(vw);
      expect(["A", "E", "I", "O", "U"]).not.toContain(c);
    }
  });

  it("handles mixed language, digits and emoji without throwing", () => {
    expect(vis("I love you 爱你 ❤️ 2026").length).toBeGreaterThan(8);
    expect(vis("")).toEqual([]);
    expect(vis("🙂🙂")).toEqual([]);
  });
});

describe("buildTimeline", () => {
  const toks = textToVisemes("Hello there, sweetheart.");

  it("covers the whole audio duration contiguously", () => {
    const keys = buildTimeline(toks, 2000);
    expect(keys[0]!.start).toBe(0);
    expect(keys[keys.length - 1]!.end).toBeCloseTo(2000);
    for (let i = 1; i < keys.length; i++) expect(keys[i]!.start).toBeCloseTo(keys[i - 1]!.end);
  });

  it("starts and ends at rest with lead-in/out", () => {
    const keys = buildTimeline(toks, 2000, { leadInMs: 100, leadOutMs: 200 });
    expect(keys[0]).toMatchObject({ viseme: "rest", end: 100 });
    expect(keys[keys.length - 1]).toMatchObject({ viseme: "rest" });
    expect(keys[keys.length - 1]!.end - keys[keys.length - 1]!.start).toBeCloseTo(200);
  });

  it("scales proportionally with duration", () => {
    const a = buildTimeline(toks, 1000, { leadInMs: 0, leadOutMs: 0 });
    const b = buildTimeline(toks, 3000, { leadInMs: 0, leadOutMs: 0 });
    a.forEach((k, i) => expect(b[i]!.end).toBeCloseTo(k.end * 3));
  });

  it("gives vowels more time than tongue consonants", () => {
    const keys = buildTimeline(textToVisemes("ta"), 1000, { leadInMs: 0, leadOutMs: 0 });
    const d = (v: string) => keys.find((k) => k.viseme === v)!;
    expect(d("A").end - d("A").start).toBeGreaterThan(d("CDG").end - d("CDG").start);
  });

  it("handles empty text and tiny durations", () => {
    expect(buildTimeline([], 500).every((k) => k.viseme === "rest")).toBe(true);
    const keys = buildTimeline(toks, 10);
    expect(keys[keys.length - 1]!.end).toBeCloseTo(10);
  });
});

describe("sampleMouth", () => {
  const track = (text: string, ms = 1200, env?: Float32Array): LipSyncTrack => ({
    keys: buildTimeline(textToVisemes(text), ms, { leadInMs: 0, leadOutMs: 0 }),
    durationMs: ms,
    ...(env ? { envelope: env, envelopeFrameMs: 20 } : {}),
  });
  const centre = (tr: LipSyncTrack, v: string, nth = 0) => {
    const k = tr.keys.filter((x) => x.viseme === v)[nth]!;
    return (k.start + k.end) / 2;
  };

  it("is closed outside the audio", () => {
    const tr = track("ah");
    expect(sampleMouth(tr, -5).open).toBe(0);
    expect(sampleMouth(tr, 5000).open).toBe(0);
  });

  it("opens wide on A and closes for MBP inside 'mama'", () => {
    const tr = track("mama", 800);
    expect(sampleMouth(tr, centre(tr, "A")).open).toBeGreaterThan(0.6);
    expect(sampleMouth(tr, centre(tr, "MBP", 1)).open).toBeLessThan(0.2);
  });

  it("rounds for U and spreads for I", () => {
    const tr = track("oo ee", 800);
    const u = sampleMouth(tr, centre(tr, "U"));
    const i = sampleMouth(tr, centre(tr, "I"));
    expect(u.round).toBeGreaterThan(0.6);
    expect(u.width).toBeLessThan(0.9);
    expect(i.width).toBeGreaterThan(1.1);
  });

  it("transitions smoothly (no big jumps between 10 ms frames)", () => {
    const tr = track("Hello mom, I miss you so much.", 2400);
    let prev = sampleMouth(tr, 0);
    let maxJump = 0;
    for (let t = 10; t < 2400; t += 10) {
      const s = sampleMouth(tr, t);
      maxJump = Math.max(maxJump, Math.abs(s.open - prev.open), Math.abs(s.width - prev.width));
      prev = s;
    }
    expect(maxJump).toBeLessThan(0.35);
  });

  it("anticipates the next viseme (coarticulation)", () => {
    const tr = track("too", 600);
    const k = tr.keys.find((x) => x.viseme === "CDG")!;
    // Late in the "t", lips are already rounding toward "oo".
    expect(sampleMouth(tr, k.end - 1).round).toBeGreaterThan(sampleMouth(tr, k.start + 1).round);
  });

  it("stays within physical ranges", () => {
    const tr = track("The quick brown fox jumps over the lazy dog! 你好吗？", 4000);
    for (let t = 0; t < 4000; t += 7) {
      const s = sampleMouth(tr, t);
      expect(s.open).toBeGreaterThanOrEqual(0);
      expect(s.open).toBeLessThanOrEqual(1);
      expect(s.width).toBeGreaterThanOrEqual(0.5);
      expect(s.width).toBeLessThanOrEqual(1.35);
      expect(Number.isFinite(s.round + s.teeth)).toBe(true);
    }
  });

  it("closes the mouth where the audio is silent", () => {
    const env = new Float32Array(60).fill(1);
    env.fill(0, 20, 40); // silence 400–800 ms
    const tr = track("aaaa", 1200, env);
    const loud = sampleMouth(tr, 200).open;
    const quiet = sampleMouth(tr, 600).open;
    expect(quiet).toBeLessThan(loud * 0.5);
    expect(sampleMouth(tr, 600, { envelopeAmount: 0 }).open).toBeCloseTo(sampleMouth({ ...tr, envelope: undefined }, 600).open);
  });
});

describe("sampleMouthReduced", () => {
  it("snaps to a few openings with no rounding", () => {
    const tr = lipSyncTrack("mama mia", 1000);
    const seen = new Set<number>();
    for (let t = 0; t < 1000; t += 5) {
      const s = sampleMouthReduced(tr, t);
      seen.add(s.open);
      expect(s.round).toBe(0);
    }
    expect([...seen].every((o) => [0, 0.3, 0.6].includes(o))).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("amplitudeEnvelope / lipSyncTrack", () => {
  it("normalises loudness and detects silence", () => {
    const sr = 1000;
    const s = new Float32Array(1000);
    for (let i = 0; i < 500; i++) s[i] = 0.3 * Math.sin(i);
    const env = amplitudeEnvelope(s, sr, 20);
    expect(env.length).toBe(50);
    expect(Math.max(...env)).toBeLessThanOrEqual(1);
    expect(env[5]!).toBeGreaterThan(0.5);
    expect(env[40]!).toBe(0);
  });

  it("handles all-silent audio", () => {
    const env = amplitudeEnvelope(new Float32Array(100), 1000);
    expect([...env].every((x) => x === 0)).toBe(true);
  });

  it("builds a track with the audio's duration and envelope", () => {
    const tr = lipSyncTrack("hi", 500, { samples: new Float32Array(8000).fill(0.1), sampleRate: 16000 });
    expect(tr.durationMs).toBe(500);
    expect(tr.envelope?.length).toBe(25);
    expect(lipSyncTrack("hi", 500).envelope).toBeUndefined();
  });

  it("every viseme has a shape", () => {
    for (const v of VISEMES) expect(VISEME_SHAPES[v]).toBeDefined();
  });
});
