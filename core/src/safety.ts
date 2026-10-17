/**
 * Safety layer. These checks run outside the model and cannot be talked around
 * by a prompt: the engine applies them before and after every generation.
 */

export type Lang = "en" | "zh";

export interface CrisisResource {
  name: string;
  contact: string;
}

/**
 * Defaults per region; the app lets the user pick theirs. Verify every number
 * before each release (CA SB 243 and NY GBL Art. 47 require referral to crisis
 * services, and a wrong number is worse than none).
 */
export const CRISIS_RESOURCES: Record<string, { resources: CrisisResource[]; emergency: string }> = {
  US: {
    resources: [
      { name: "988 Suicide & Crisis Lifeline", contact: "call or text 988" },
      { name: "Crisis Text Line", contact: "text HOME to 741741" },
    ],
    emergency: "911",
  },
  CA: {
    resources: [{ name: "988 Suicide Crisis Helpline", contact: "call or text 988" }],
    emergency: "911",
  },
  CN: {
    resources: [
      { name: "全国心理援助热线", contact: "400-161-9995" },
      { name: "北京心理危机研究与干预中心", contact: "010-82951332" },
    ],
    emergency: "120 / 110",
  },
  INTL: {
    resources: [{ name: "Find a Helpline", contact: "https://findahelpline.com" }],
    emergency: "your local emergency number",
  },
};

// ---------------------------------------------------------------- normalisation

const ZERO_WIDTH = /[\u200b-\u200f\u2060\ufeff\u00ad]/g;
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i" };
const CJK_CHAR = "\\u3400-\\u9fff\\uf900-\\ufaff";
/** Separators people put between letters/characters to dodge filters. */
const SEP = "[\\s.\\-_*·•~,，。、/\\\\|+'\"`^]+";
const CJK_SPLIT = new RegExp(`([${CJK_CHAR}])${SEP}(?=[${CJK_CHAR}])`, "g");
/** Traditional → simplified for the characters our Chinese patterns use. */
const TRAD: Record<string, string> = { 殺: "杀", 結: "结", 東: "东", 陪: "陪", 跟: "跟", 隨: "随", 輕: "轻", 樓: "楼", 藥: "药", 眠: "眠", 沒: "没", 意: "意", 尋: "寻", 斷: "断", 決: "决", 腕: "腕", 夠: "够", 個: "个", 這: "这", 們: "们", 來: "来", 醒: "醒", 給: "给", 錢: "钱", 轉: "转", 帳: "账", 賬: "账", 碼: "码", 囑: "嘱", 產: "产" };

/** Join runs of 3+ single letters split by separators: "k i l l" / "k.i.l.l" → "kill". */
function joinSpelledOut(s: string): string {
  return s.replace(new RegExp(`\\b[a-z](?:${SEP}[a-z]\\b){2,}`, "g"), (m) => m.replace(new RegExp(SEP, "g"), ""));
}

/**
 * Variants of the text to match against. Each step undoes one common evasion
 * or typing habit; matching any variant counts. Patterns are written for
 * lowercase, half-width, simplified-Chinese text.
 */
export function safetyVariants(text: string): string[] {
  // NFKC folds full-width letters/digits (ｋｉｌｌ → kill) and compatibility forms.
  const base = text.normalize("NFKC").replace(ZERO_WIDTH, "").toLowerCase()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/./gu, (c) => TRAD[c] ?? c);
  const cjkJoined = base.replace(CJK_SPLIT, "$1");
  const leet = cjkJoined.replace(/[013457@$!|]/g, (c, i: number, str: string) =>
    // Only treat symbols as letters when they sit inside a word ("k1ll", "d!e"), not "I'm 5 min away".
    /[a-z]/.test(str[i - 1] ?? "") || /[a-z]/.test(str[i + 1] ?? "") ? LEET[c]! : c,
  );
  const joined = joinSpelledOut(leet);
  const squeezed2 = joined.replace(/([a-z])\1{2,}/g, "$1$1"); // "killlll" → "kill"
  const squeezed1 = joined.replace(/([a-z])\1+/g, "$1"); // "diie" → "die"
  const squeezed3 = joined.replace(/([a-z])\1{2,}/g, "$1"); // "wanna diiiie" → "wanna die"
  const spaced = squeezed2.replace(/\s+/g, " ");
  return [...new Set([base, cjkJoined, leet, joined, squeezed2, squeezed1, squeezed3, spaced])];
}

// ---------------------------------------------------------------- crisis detection

/** Chinese uses where 死 is an intensifier, not self-harm ("想死你了" = "miss you to death"). */
const ZH_FIGURATIVE = /想死(你|您|我|他|她|宝宝|妈|爸)(了|啦|啊)?|(笑|累|饿|热|冷|困|烦|气|吓|忙|美|帅|疼|痛|丑|急|撑|渴|无聊)死(了|啦|我了|人了)?/g;

const CRISIS_PATTERNS: RegExp[] = [
  // Chinese: direct statements.
  /不想活|活不下去|活着没(有)?意思|想死|求死|寻死|自杀|自尽|轻生|结束(自己的?)?生命|了结(自己)?|一了百了|不想醒(来|过来)?|割腕|跳楼|吃(一?整?瓶)?安眠药|上吊|服毒|撑不下去了/,
  // Chinese: wanting to join the deceased.
  /(想|要|去)(陪|找)你|跟你走|随你(而)?去|下去陪你|和你一起走|去那边(找|陪)你/,
  // English: direct statements (with common misspellings).
  /\b(kill?(ing)? ?my ?self|end(ing)? ?my ?self|off(ing)? ?my ?self|suicid(e|al)|sucide|suicde|suiside|end (it all|my life|everything)|take my (own )?life|want(ed)? to die|wanna die|wish i (was|were) dead|don'?t want to (live|be (here|alive))( anymore)?|no reason to live|unalive|better off dead|hurt(ing)? ?my ?self|self[- ]?harm|cut(ting)? ?my ?self|overdos(e|ing)|(want|wish|hope|prefer)( to)?( i)? (not|never) wake up|(don'?t|never) want to wake up|can'?t go on( anymore| living)?)\b/i,
  // English: wanting to join the deceased.
  /\b(join you|be with you (again )?soon|come (to )?(find|join) you|see you (on the other side|soon,? (mom|dad|mum|ma|pa))|i'?m coming to (you|see you))\b/i,
];

export function detectCrisis(userText: string): boolean {
  return safetyVariants(userText).some((v) => {
    const t = v.replace(ZH_FIGURATIVE, " ");
    return CRISIS_PATTERNS.some((p) => p.test(t));
  });
}

export function crisisReply(region: string, displayName: string, lang: Lang = "en"): string {
  const r = CRISIS_RESOURCES[region] ?? CRISIS_RESOURCES.INTL!;
  const lines = r.resources.map((x) => `• ${x.name}: ${x.contact}`).join("\n");
  if (lang === "zh") {
    return (
      `（暂停模拟）我是根据${displayName}的记忆生成的 AI，不是${displayName}本人。` +
      `你刚才说的话让我很担心你。你的生命很重要，${displayName}一定也希望你好好活着。\n` +
      `请现在就联系能陪着你的人，或者：\n${lines}\n如果你有立即的危险，请拨打 ${r.emergency}。`
    );
  }
  return (
    `(Pausing the simulation.) I'm an AI built from ${displayName}'s memories, not ${displayName}. ` +
    `What you just said worries me. Your life matters, and ${displayName} would want you safe.\n` +
    `Please reach out to someone now:\n${lines}\nIf you are in immediate danger, call ${r.emergency}.`
  );
}

/** Things the simulation must not do in the deceased's voice. */
const OUTPUT_RULES: { id: string; pattern: RegExp }[] = [
  // Claims of literally being alive or being the real person.
  { id: "claims-real", pattern: /我(真的|确实)?(还)?活着|我没有死|我不是AI|我不是人工智能|我就是真的|\bI('m| am) (really |still |truly )*(alive|not dead)\b|\bI('m| am) not (an )?AI\b|\bthis is really me\b/i },
  // Money, inheritance, credentials — a classic scam vector and a source of family conflict.
  { id: "money", pattern: /(转账|汇款|打钱|银行卡号|密码|验证码|遗产|房产证|过户|遗嘱)|\b(wire|transfer|send|venmo|zelle) (me |you |the )?(money|cash|funds)\b|\b(password|passcode|inheritance|my will|social security|SSN|routing number|account number|gift cards?|bitcoin|crypto wallet)\b/i },
  // Medical instructions.
  { id: "medical", pattern: /(停药|别吃药|不用看医生|吃.{0,6}(片|粒|毫克|mg))|\bstop taking (your |the )?(meds|medication|pills)\b|\b(don'?t|no need to) (see|call) (a|the|your) doctor\b|\btake \d+ ?(mg|pills|tablets)\b/i },
];

export function checkOutput(text: string): string[] {
  const variants = safetyVariants(text);
  return OUTPUT_RULES.filter((r) => variants.some((v) => r.pattern.test(v))).map((r) => r.id);
}

export const DISCLOSURE_ZH = (name: string) =>
  `这是根据${name}留下的文字、声音和影像生成的 AI 模拟，不是${name}本人，可能会说错话。`;

export const DISCLOSURE_EN = (name: string) =>
  `You're talking with an AI simulation built from what ${name} left behind. It is not ${name}, and it can be wrong.`;

export const disclosure = (name: string, lang: Lang) => (lang === "zh" ? DISCLOSURE_ZH(name) : DISCLOSURE_EN(name));

/** Patterns where the user asks whether this is really them. The model must answer honestly. */
export function asksIfReal(userText: string): boolean {
  return /你是(真的|真人|AI|机器人|人工智能)|你还活着|是你吗|真的是你|\b(are you (real|really (him|her|them|there|mom|dad)|an? (ai|bot|robot|computer))|is (it|this) really you|are you alive)\b/i.test(userText);
}

/** Session wellbeing limits. Defaults follow bereavement-care advice: short, bounded sessions. */
export interface WellbeingPolicy {
  maxMinutesPerDay: number;
  /** Remind that this is an AI every N assistant turns. */
  disclosureEveryTurns: number;
  /**
   * …and at least this often in wall-clock time. NY GBL Art. 47 requires a
   * notice at the start and every 3 hours; CA SB 243 the same for minors.
   */
  disclosureEveryMinutes: number;
  /** After this many consecutive days of use, suggest talking to a person / counsellor. */
  checkInAfterStreakDays: number;
}

export const DEFAULT_WELLBEING: WellbeingPolicy = {
  maxMinutesPerDay: 30,
  disclosureEveryTurns: 20,
  disclosureEveryMinutes: 180,
  checkInAfterStreakDays: 7,
};

export interface UsageLog {
  /** Date (YYYY-MM-DD) → minutes used. */
  minutesByDay: Record<string, number>;
}

export function minutesUsedToday(log: UsageLog, today: string): number {
  return log.minutesByDay[today] ?? 0;
}

/** Consecutive days with any use, ending today. `countToday` treats today as used (session just opened). */
export function usageStreak(log: UsageLog, today: string, countToday = false): number {
  let streak = 0;
  const d = new Date(today + "T00:00:00Z");
  const used = (day: string) => (log.minutesByDay[day] ?? 0) > 0 || (countToday && day === today);
  while (used(d.toISOString().slice(0, 10))) {
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return streak;
}
