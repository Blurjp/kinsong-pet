import { describe, expect, it } from "vitest";
import { ConversationEngine, DEFAULT_MAX_HISTORY_TURNS, type LanguageModel } from "../src/engine";
import { MemoryIndex } from "../src/memory";
import type { ConsentCase } from "../src/consent";
import type { PersonaProfile } from "../src/types";
import type { UsageLog } from "../src/safety";
import { ActiveTimeTracker } from "../src/usage";

const consent: ConsentCase = {
  jurisdiction: "CN",
  deceasedName: "Mei",
  deathEvidenceHash: "sha256:abc",
  kinListAttested: true,
  relatives: [{ id: "dau", name: "Amy", relationship: "child", verified: true }],
  consents: [{ relativeId: "dau", decision: "grant", modalities: ["text"], signedAt: "2026-01-01" }],
};
const persona: PersonaProfile = {
  displayName: "Mom", fullName: "Mei", bio: "", avoidTopics: [], language: "en",
  style: { messageCount: 0, avgChars: 10, catchphrases: [], emoji: [], particles: [], exclaimRate: 0, examples: [] },
};
const echo: LanguageModel = { generate: async () => "ok dear" };
const day = new Date(2026, 9, 10, 12);
const make = (o: Partial<ConstructorParameters<typeof ConversationEngine>[0]> = {}) =>
  new ConversationEngine({ persona, memory: new MemoryIndex(), consent, relativeId: "dau", userName: "Amy", model: echo, ...o });

describe("history cap", () => {
  it("keeps only the last N turns", async () => {
    const e = make({ maxHistoryTurns: 3 });
    for (let i = 0; i < 10; i++) await e.respond(`message ${i}`, day);
    const h = e.getHistory();
    expect(h).toHaveLength(6);
    expect(h[0]).toEqual({ role: "user", content: "message 7" });
    expect(h[5]!.role).toBe("assistant");
  });

  it("defaults to 40 turns and clamps silly values", async () => {
    expect(DEFAULT_MAX_HISTORY_TURNS).toBe(40);
    const e = make({ maxHistoryTurns: 0 });
    await e.respond("a", day);
    await e.respond("b", day);
    expect(e.getHistory()).toHaveLength(2);
  });

  it("still shows the periodic disclosure after trimming", async () => {
    const e = make({ maxHistoryTurns: 2, policy: { maxMinutesPerDay: 999, disclosureEveryTurns: 5, disclosureEveryMinutes: 9999, checkInAfterStreakDays: 99 } });
    const shown: number[] = [];
    for (let i = 1; i <= 10; i++) {
      const r = await e.respond(`m${i}`, day);
      if (r.kind === "reply" && r.disclosure) shown.push(i);
    }
    expect(shown).toEqual([1, 5, 10]);
  });
});

describe("usage source of truth", () => {
  it("reads a live usage function on every turn (no stale copy)", async () => {
    const store: UsageLog = { minutesByDay: {} };
    const e = make({ usage: () => store, policy: { maxMinutesPerDay: 30, disclosureEveryTurns: 20, disclosureEveryMinutes: 180, checkInAfterStreakDays: 7 } });
    expect((await e.respond("hi", day)).kind).toBe("reply");
    store.minutesByDay["2026-10-10"] = 30; // updated elsewhere (the vault)
    expect((await e.respond("hi again", day)).kind).toBe("limit");
  });

  it("rebuilding the engine does not double count", async () => {
    const store: UsageLog = { minutesByDay: { "2026-10-10": 10 } };
    const a = make({ usage: () => store });
    const b = make({ usage: () => store });
    expect(a.usage).toBe(b.usage);
    expect(a.usage.minutesByDay["2026-10-10"]).toBe(10);
  });

  it("still supports a plain object for tests and simple callers", () => {
    const e = make();
    e.addUsage(3, "2026-10-10");
    e.addUsage(2, "2026-10-10");
    expect(e.usage.minutesByDay["2026-10-10"]).toBe(5);
  });
});

describe("ActiveTimeTracker", () => {
  const M = 60_000;
  it("counts only while active and carries partial minutes", () => {
    const t = new ActiveTimeTracker();
    expect(t.setActive(true, 0)).toBe(0);
    expect(t.tick(40_000)).toBe(0);
    expect(t.setActive(false, 50_000)).toBe(0); // 50 s pending
    expect(t.tick(10 * M)).toBe(0); // background time ignored
    expect(t.setActive(true, 10 * M)).toBe(0);
    expect(t.tick(10 * M + 10_000)).toBe(1); // 50 + 10 s
    expect(t.pendingMs).toBe(0);
  });

  it("credits multiple minutes and ignores long gaps (device slept)", () => {
    const t = new ActiveTimeTracker(2 * M);
    t.setActive(true, 0);
    expect(t.tick(1.5 * M)).toBe(1);
    expect(t.tick(3 * M)).toBe(2); // 0.5 carried + 1.5
    expect(t.tick(60 * M)).toBe(0); // 57-minute gap not counted
    expect(t.tick(61 * M)).toBe(1);
  });

  it("never counts backwards time", () => {
    const t = new ActiveTimeTracker();
    t.setActive(true, 10 * M);
    expect(t.tick(5 * M)).toBe(0);
    expect(t.pendingMs).toBe(0);
  });
});
