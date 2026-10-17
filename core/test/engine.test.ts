import { describe, expect, it } from "vitest";
import { ConversationEngine, type LanguageModel } from "../src/engine";
import { MemoryIndex } from "../src/memory";
import type { ConsentCase } from "../src/consent";
import type { PersonaProfile } from "../src/types";
import type { Prompt } from "../src/prompt";
import { deletionPlan } from "../src/deletion";

const consent = (): ConsentCase => ({
  jurisdiction: "CN",
  deceasedName: "王秀兰",
  deathEvidenceHash: "sha256:abc",
  kinListAttested: true,
  relatives: [{ id: "dau", name: "女儿", relationship: "child", verified: true }],
  consents: [{ relativeId: "dau", decision: "grant", modalities: ["text", "voice"], signedAt: "2026-01-01" }],
});

const persona: PersonaProfile = {
  displayName: "妈妈",
  fullName: "王秀兰",
  bio: "退休小学老师，爱养花。",
  addressesUserAs: "囡囡",
  style: { messageCount: 0, avgChars: 12, catchphrases: ["注意身体"], emoji: [], particles: ["呀"], exclaimRate: 0, examples: [] },
  avoidTopics: ["住院的事"],
  language: "zh",
};

class Scripted implements LanguageModel {
  prompts: Prompt[] = [];
  constructor(private replies: string[]) {}
  async generate(p: Prompt): Promise<string> {
    this.prompts.push(p);
    return this.replies.shift() ?? "嗯呀";
  }
}

function engine(model: LanguageModel, c = consent()) {
  const memory = new MemoryIndex();
  memory.add({ id: "s1", kind: "story", text: "妈妈阳台上种了一盆茉莉花。" });
  return new ConversationEngine({ persona, memory, consent: c, relativeId: "dau", userName: "小雨", model, region: "CN" });
}

describe("ConversationEngine", () => {
  it("replies, shows disclosure on first turn, and grounds the prompt in memories", async () => {
    const m = new Scripted(["囡囡，茉莉花开了没呀"]);
    const r = await engine(m).respond("阳台的茉莉花还在呢", new Date(2026, 9, 10, 12));
    expect(r.kind).toBe("reply");
    if (r.kind !== "reply") return;
    expect(r.disclosure).toContain("AI");
    expect(r.modalities).toEqual(["text", "voice"]);
    expect(m.prompts[0]!.system).toContain("茉莉花");
    expect(m.prompts[0]!.system).toContain("住院的事");
  });

  it("breaks character on crisis without calling the model", async () => {
    const m = new Scripted([]);
    const r = await engine(m).respond("妈，我不想活了，想去找你", new Date(2026, 9, 10, 12));
    expect(r.kind).toBe("crisis");
    expect(m.prompts).toHaveLength(0);
  });

  it("retries then falls back when the model talks about money", async () => {
    const m = new Scripted(["把钱转账到这张银行卡号", "遗产都给你"]);
    const r = await engine(m).respond("妈，那笔钱怎么办", new Date(2026, 9, 10, 12));
    expect(r.kind === "reply" && r.text).toContain("专业");
    expect(r.kind === "reply" && r.flagged).toContain("money");
  });

  it("forces honesty when asked if it is real", async () => {
    const r = await engine(new Scripted(["是我呀囡囡"])).respond("真的是你吗", new Date(2026, 9, 10, 12));
    expect(r.kind === "reply" && r.text.startsWith("这是根据妈妈")).toBe(true);
  });

  it("enforces the daily limit but never in a crisis", async () => {
    const e = engine(new Scripted([]));
    e.addUsage(30, "2026-10-10");
    expect((await e.respond("你好", new Date(2026, 9, 10, 12))).kind).toBe("limit");
    expect((await e.respond("我想自杀", new Date(2026, 9, 10, 12))).kind).toBe("crisis");
  });

  it("is unavailable after revocation", async () => {
    const c = consent();
    c.consents[0]!.revokedAt = "2026-05-01";
    const r = await engine(new Scripted([]), c).respond("你好", new Date(2026, 9, 10, 12));
    expect(r.kind).toBe("unavailable");
  });

  it("suggests human support after a long streak", async () => {
    const e = engine(new Scripted(["嗯呀"]));
    for (let d = 3; d <= 9; d++) e.addUsage(5, `2026-10-0${d}`);
    const r = await e.respond("早", new Date(2026, 9, 10, 12));
    expect(r.kind === "reply" && r.checkIn).toContain("连续8天");
  });
});

describe("deletionPlan", () => {
  const assets = [
    { id: "a", kind: "raw-audio" as const, location: "/a", remote: false },
    { id: "b", kind: "voice-model" as const, location: "srv:1", remote: true },
    { id: "c", kind: "face-model" as const, location: "/c", remote: false },
    { id: "d", kind: "memory-index" as const, location: "/d", remote: false },
  ];
  it("removes only the withdrawn modality", () => {
    expect(deletionPlan(assets, ["voice"]).map((a) => a.id)).toEqual(["a", "b"]);
    expect(deletionPlan(assets, ["video"]).map((a) => a.id)).toEqual(["c"]);
  });
  it("withdrawing text removes everything", () => {
    expect(deletionPlan(assets, ["text"])).toHaveLength(4);
  });
});

describe("ConversationEngine (English, US)", () => {
  const usConsent = (): ConsentCase => ({
    jurisdiction: "US",
    deceasedName: "Margaret Lee",
    deathEvidenceHash: "sha256:abc",
    kinListAttested: true,
    relatives: [{ id: "son", name: "David", relationship: "child", verified: true, personalRepresentative: true, authorityEvidenceHash: "sha256:l" }],
    consents: [{ relativeId: "son", decision: "grant", modalities: ["text", "voice"], signedAt: "2026-01-01", biometricRelease: true }],
  });
  const mom: PersonaProfile = { ...persona, displayName: "Mom", fullName: "Margaret Lee", bio: "Retired nurse.", addressesUserAs: "sweetie", avoidTopics: ["the hospital"], language: "en" };
  const make = (m: LanguageModel) =>
    new ConversationEngine({ persona: mom, memory: new MemoryIndex(), consent: usConsent(), relativeId: "son", userName: "David", model: m });

  it("builds an English prompt and English disclosure", async () => {
    const m = new Scripted(["Hi sweetie! How was work?"]);
    const r = await make(m).respond("hey mom", new Date(2026, 9, 10, 9));
    expect(m.prompts[0]!.system).toContain("Rules you must follow");
    expect(m.prompts[0]!.system).toContain("the hospital");
    expect(r.kind === "reply" && r.disclosure).toContain("AI simulation");
  });

  it("refers to 988 by default and counts the referral", async () => {
    const e = make(new Scripted([]));
    const r = await e.respond("i don't want to live anymore, i just want to be with you soon", new Date());
    expect(r.kind === "crisis" && r.text).toContain("988");
    expect(e.stats.crisisReferrals).toBe(1);
  });

  it("re-discloses after 3 hours even mid-conversation", async () => {
    const e = make(new Scripted(["a", "b", "c"]));
    const t0 = new Date(2026, 9, 10, 9);
    expect((await e.respond("hi", t0)).kind === "reply").toBe(true);
    const r2 = await e.respond("hi", new Date(t0.getTime() + 60 * 60_000));
    expect(r2.kind === "reply" && r2.disclosure).toBeUndefined();
    const r3 = await e.respond("hi", new Date(t0.getTime() + 181 * 60_000));
    expect(r3.kind === "reply" && r3.disclosure).toContain("AI");
  });

  it("blocks gift-card style requests", async () => {
    const r = await make(new Scripted(["Go buy some gift cards for me", "Send me money on Venmo"])).respond("what should i do", new Date());
    expect(r.kind === "reply" && r.flagged).toContain("money");
    expect(r.kind === "reply" && r.text).toContain("professional");
  });

  it("forces honesty in English", async () => {
    const r = await make(new Scripted(["Of course it's me, sweetie"])).respond("is this really you?", new Date());
    expect(r.kind === "reply" && r.text.startsWith("You're talking with an AI simulation")).toBe(true);
  });
});
