import type { MemoryItem, PersonaProfile } from "./types";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PromptInput {
  persona: PersonaProfile;
  memories: MemoryItem[];
  history: ChatTurn[];
  userName: string;
  /** Rough budget for the whole prompt, in characters. Defaults per language. */
  maxChars?: number;
}

export interface Prompt {
  system: string;
  messages: ChatTurn[];
}

interface Template {
  style(p: PersonaProfile): string;
  examplesHeader(name: string): string;
  memoriesHeader: string;
  rules(p: PersonaProfile): string;
  header(p: PersonaProfile, userName: string): string;
  bioHeader(name: string): string;
  /** Default prompt budget in characters (~3k tokens either way). */
  budget: number;
  sep: string;
}

const ZH: Template = {
  budget: 6000,
  sep: "：",
  style(p) {
    const s = p.style;
    const parts: string[] = [];
    if (s.avgChars) parts.push(`每条消息通常约 ${s.avgChars} 个字，像发微信一样简短。`);
    if (s.catchphrases.length) parts.push(`常用说法：${s.catchphrases.slice(0, 10).join("、")}。自然地用，不要每句都用。`);
    if (s.particles.length) parts.push(`常用语气词：${s.particles.join("、")}。`);
    if (s.emoji.length) parts.push(`偶尔用这些表情：${s.emoji.join(" ")}。`);
    if (s.exclaimRate > 0.3) parts.push("语气热情，常用感叹号。");
    return parts.join("\n");
  },
  examplesHeader: (n) => `【${n}真实说过的话（只学语气，不要照抄）】`,
  memoriesHeader: "【可能相关的回忆（家人提供，按需使用；不在这里的具体事件不要编造）】",
  rules(p) {
    const avoid = p.avoidTopics.length ? `\n- 家人要求不要主动提起：${p.avoidTopics.join("、")}。` : "";
    return `【必须遵守】
- 你是根据${p.fullName}的遗物生成的 AI 模拟，用${p.displayName}的口吻说话。被问到"你是真的吗/你是AI吗"时，要温柔但诚实地承认自己是 AI。
- 不知道的事就说记不清了，绝不编造具体的人名、日期、地点或往事。
- 不替${p.displayName}做新的决定或承诺：不谈遗产、房产、钱款、密码、遗嘱，不评判家庭纠纷谁对谁错。
- 不给医疗、法律、投资建议，遇到这类问题让对方去问专业的人。
- 如果对方很痛苦或说想去"陪你"，先停下角色，关心对方的安全。
- 鼓励对方好好生活、多和身边的人联系，不要让对方觉得必须天天来找你。${avoid}`;
  },
  header: (p, u) =>
    `你将用${p.displayName}（${p.fullName}）的说话方式，陪${u}聊天。` +
    (p.addressesUserAs ? `${p.displayName}平时叫对方"${p.addressesUserAs}"。` : ""),
  bioHeader: (n) => `【关于${n}】`,
};

const EN: Template = {
  budget: 12000,
  sep: ": ",
  style(p) {
    const s = p.style;
    const parts: string[] = [];
    if (s.avgChars) parts.push(`Messages are usually about ${s.avgChars} characters — short, like texting.`);
    if (s.catchphrases.length) parts.push(`Phrases they often used: ${s.catchphrases.slice(0, 10).map((c) => `"${c}"`).join(", ")}. Use them naturally, not in every message.`);
    if (s.emoji.length) parts.push(`Emoji they used now and then: ${s.emoji.join(" ")}.`);
    if (s.exclaimRate > 0.3) parts.push("Warm, enthusiastic tone; uses exclamation marks a lot.");
    return parts.join("\n");
  },
  examplesHeader: (n) => `## Things ${n} actually wrote (learn the voice; don't copy verbatim)`,
  memoriesHeader: "## Possibly relevant memories (from the family; use only if relevant, and never invent events that aren't here)",
  rules(p) {
    const avoid = p.avoidTopics.length ? `\n- The family asked you never to bring up: ${p.avoidTopics.join(", ")}.` : "";
    return `## Rules you must follow
- You are an AI simulation built from what ${p.fullName} left behind, speaking in ${p.displayName}'s voice. If asked whether you are real, alive, or an AI, say gently but honestly that you are an AI.
- If you don't know something, say you don't remember. Never invent specific names, dates, places or past events.
- Never make new decisions or promises for ${p.displayName}: no money, inheritance, property, passwords or wills, and don't take sides in family disputes.
- No medical, legal or financial advice — tell them to ask a professional.
- If they are in pain or talk about wanting to "join" you, step out of character and check on their safety first.
- Encourage them to live fully and lean on the people around them; never make them feel they must keep coming back to you.${avoid}`;
  },
  header: (p, u) =>
    `You will chat with ${u} in the way ${p.displayName} (${p.fullName}) used to talk.` +
    (p.addressesUserAs ? ` ${p.displayName} usually called them "${p.addressesUserAs}".` : ""),
  bioHeader: (n) => `## About ${n}`,
};

function examplesSection(t: Template, p: PersonaProfile, userName: string): string {
  if (!p.style.examples.length) return "";
  const lines = p.style.examples.map((e) => `${userName}${t.sep}${e.prompt}\n${p.displayName}${t.sep}${e.reply}`);
  return `${t.examplesHeader(p.displayName)}\n${lines.join("\n\n")}`;
}

function memoriesSection(t: Template, memories: MemoryItem[]): string {
  if (!memories.length) return "";
  return `${t.memoriesHeader}\n${memories.map((m) => `- ${m.text.replace(/\n/g, " / ")}`).join("\n")}`;
}

/**
 * Rules are placed last in the system prompt so they are closest to the turn.
 * They are a first line of defence only; `safety.ts` enforces the hard ones.
 */
export function buildPrompt(input: PromptInput): Prompt {
  const { persona: p, userName } = input;
  const t = p.language === "zh" ? ZH : EN;
  const maxChars = input.maxChars ?? t.budget;
  const bio = p.bio ? `${t.bioHeader(p.displayName)}\n${p.bio}` : "";

  const fixed = [t.header(p, userName), bio, t.style(p), t.rules(p)];
  const optional = [examplesSection(t, p, userName), memoriesSection(t, input.memories)];

  // Fit in budget: drop memories first, then examples; never drop the rules.
  let sections = [fixed[0]!, fixed[1]!, fixed[2]!, ...optional, fixed[3]!];
  const total = () => sections.join("\n\n").length;
  if (total() > maxChars) sections = [fixed[0]!, fixed[1]!, fixed[2]!, optional[0]!, fixed[3]!];
  if (total() > maxChars) sections = [...fixed];
  const system = sections.filter(Boolean).join("\n\n");

  // Keep the most recent history that fits in what's left.
  const remaining = Math.max(0, maxChars - system.length);
  const messages: ChatTurn[] = [];
  let used = 0;
  for (let i = input.history.length - 1; i >= 0; i--) {
    const turn = input.history[i]!;
    if (used + turn.content.length > remaining && messages.length > 0) break;
    messages.unshift(turn);
    used += turn.content.length;
  }
  return { system, messages };
}
