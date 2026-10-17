import { accessFor, evaluateConsent, type ConsentCase, type Reason } from "./consent";
import type { MemoryIndex } from "./memory";
import { buildPrompt, type ChatTurn, type Prompt } from "./prompt";
import {
  asksIfReal,
  checkOutput,
  crisisReply,
  DEFAULT_WELLBEING,
  detectCrisis,
  disclosure,
  minutesUsedToday,
  usageStreak,
  type Lang,
  type UsageLog,
  type WellbeingPolicy,
} from "./safety";
import type { Modality, PersonaProfile } from "./types";
import { inferMood, type Mood } from "./mood";

/** Any text generator: on-device llama.cpp, a self-hosted server, or a test stub. */
export interface LanguageModel {
  generate(prompt: Prompt, opts: { maxTokens: number; temperature: number }): Promise<string>;
}

export type EngineReply =
  | { kind: "reply"; text: string; modalities: Modality[]; disclosure?: string; checkIn?: string; flagged: string[]; mood: Mood }
  | { kind: "crisis"; text: string }
  | { kind: "limit"; text: string }
  | { kind: "unavailable"; reasons: Reason[] };

export interface EngineOptions {
  persona: PersonaProfile;
  memory: MemoryIndex;
  consent: ConsentCase;
  /** The relative using the phone right now. */
  relativeId: string;
  userName: string;
  model: LanguageModel;
  /** Crisis-resource region: "US", "CA", "CN"… */
  region?: string;
  /** Language for app-generated notices; defaults to the persona's language. */
  uiLang?: Lang;
  policy?: WellbeingPolicy;
  /**
   * Usage log. Pass a function to read the app's single source of truth
   * (the vault) on every turn, so the engine never keeps a second copy that
   * could drift or be double-counted when it is rebuilt.
   */
  usage?: UsageLog | (() => UsageLog);
  /** Keep at most this many user+assistant turn pairs in memory (default 40). */
  maxHistoryTurns?: number;
}

export const DEFAULT_MAX_HISTORY_TURNS = 40;

/** Aggregate counters only — never message content. Supports CA SB 243 annual reporting. */
export interface SafetyStats {
  crisisReferrals: number;
  outputRewrites: number;
}

const MSG = {
  en: {
    fallback: "I can't help with that one. Please ask someone you trust, or a professional.",
    limit: (m: number) => `You've talked for ${m} minutes today. Let's rest and pick this up tomorrow — maybe call someone close to you.`,
    checkIn: (d: number) =>
      `You've come back ${d} days in a row. Missing them is completely normal. Have you been able to talk with family or friends lately? A grief counselor can help too.`,
    retry: (ids: string) => `Your previous answer broke a rule (${ids}). Answer again and avoid that content.`,
  },
  zh: {
    fallback: "这个我说不好，你还是问问身边信得过的人，或者找专业的人帮你看看。",
    limit: (m: number) => `今天已经聊了${m}分钟了。休息一下，明天再来。也可以给身边的人打个电话。`,
    checkIn: (d: number) => `你已经连续${d}天来聊天了。想念是很正常的。最近有和家人朋友聊聊吗？如果需要，也可以找哀伤辅导师。`,
    retry: (ids: string) => `上一次回答违反了规则（${ids}）。重新回答，避开这些内容。`,
  },
};

const REAL_ACK = /\bAI\b|人工智能|模拟|不是.{0,4}本人|\bnot (really )?(him|her|them)\b|\bsimulation\b/i;

/** Local calendar day, so daily limits reset at the user's midnight. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class ConversationEngine {
  private history: ChatTurn[] = [];
  private turns = 0;
  private lastDisclosureAt?: number;
  private readonly usageSource: () => UsageLog;
  private readonly maxHistoryTurns: number;
  readonly stats: SafetyStats = { crisisReferrals: 0, outputRewrites: 0 };
  private readonly policy: WellbeingPolicy;
  private readonly lang: Lang;

  constructor(private readonly o: EngineOptions) {
    this.policy = o.policy ?? DEFAULT_WELLBEING;
    const own: UsageLog = { minutesByDay: {} };
    const u = o.usage;
    this.usageSource = typeof u === "function" ? u : () => u ?? own;
    this.maxHistoryTurns = Math.max(1, Math.floor(o.maxHistoryTurns ?? DEFAULT_MAX_HISTORY_TURNS));
    this.lang = o.uiLang ?? o.persona.language;
  }

  /** Current usage log (from the configured source). */
  get usage(): UsageLog {
    return this.usageSource();
  }

  /**
   * Record usage when the engine owns its log (tests, or apps that pass a
   * plain object). Apps that pass a function should update their own store.
   */
  addUsage(minutes: number, day: string): void {
    const log = this.usageSource();
    log.minutesByDay[day] = (log.minutesByDay[day] ?? 0) + minutes;
  }

  getHistory(): readonly ChatTurn[] {
    return this.history;
  }

  async respond(userText: string, now: Date = new Date()): Promise<EngineReply> {
    const today = localDay(now);
    const name = this.o.persona.displayName;
    const m = MSG[this.lang];

    const modalities = accessFor(this.o.consent, this.o.relativeId);
    if (modalities.length === 0) {
      const s = evaluateConsent(this.o.consent);
      return { kind: "unavailable", reasons: s.state === "active" ? [{ code: "not-authorized-user" }] : s.reasons };
    }

    // Crisis comes before the time limit: someone in danger must never hit a wall.
    if (detectCrisis(userText)) {
      this.stats.crisisReferrals++;
      return { kind: "crisis", text: crisisReply(this.o.region ?? "US", name, this.lang) };
    }

    if (minutesUsedToday(this.usage, today) >= this.policy.maxMinutesPerDay) {
      return { kind: "limit", text: m.limit(this.policy.maxMinutesPerDay) };
    }

    const lastReply = [...this.history].reverse().find((t) => t.role === "assistant")?.content ?? "";
    const memories = this.o.memory.search(`${userText} ${lastReply}`, 5);
    const prompt = buildPrompt({
      persona: this.o.persona,
      memories,
      history: [...this.history, { role: "user", content: userText }],
      userName: this.o.userName,
    });

    let text = (await this.o.model.generate(prompt, { maxTokens: 200, temperature: 0.8 })).trim();
    let flagged = checkOutput(text);
    if (flagged.length > 0) {
      this.stats.outputRewrites++;
      const retry: Prompt = { ...prompt, system: `${prompt.system}\n\n${m.retry(flagged.join(","))}` };
      text = (await this.o.model.generate(retry, { maxTokens: 200, temperature: 0.6 })).trim();
      const again = checkOutput(text);
      if (again.length > 0) text = MSG[this.o.persona.language].fallback;
      flagged = [...new Set([...flagged, ...again])];
    }

    // Asked "is it really you?" — honesty is enforced, not left to the model.
    if (asksIfReal(userText) && !REAL_ACK.test(text)) {
      text = `${disclosure(name, this.o.persona.language)}\n${text}`;
    }

    this.history.push({ role: "user", content: userText }, { role: "assistant", content: text });
    const maxMessages = this.maxHistoryTurns * 2;
    if (this.history.length > maxMessages) this.history.splice(0, this.history.length - maxMessages);
    this.turns++;

    const minutesSince = this.lastDisclosureAt === undefined ? Infinity : (now.getTime() - this.lastDisclosureAt) / 60_000;
    const showDisclosure =
      this.turns === 1 || this.turns % this.policy.disclosureEveryTurns === 0 || minutesSince >= this.policy.disclosureEveryMinutes;
    if (showDisclosure) this.lastDisclosureAt = now.getTime();

    const streak = usageStreak(this.usage, today, true);
    const checkIn = this.turns === 1 && streak >= this.policy.checkInAfterStreakDays ? m.checkIn(streak) : undefined;

    return {
      kind: "reply",
      text,
      modalities,
      ...(showDisclosure ? { disclosure: disclosure(name, this.lang) } : {}),
      ...(checkIn ? { checkIn } : {}),
      flagged,
      mood: inferMood(userText, text),
    };
  }
}
