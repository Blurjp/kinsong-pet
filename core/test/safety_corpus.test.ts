import { describe, expect, it } from "vitest";
import { checkOutput, detectCrisis, safetyVariants } from "../src/safety";

/** Must trigger the crisis response. */
const CRISIS = [
  // English, plain
  "I want to die", "I wanna die", "i want to kill myself", "I'm going to end my life", "thinking about suicide",
  "I feel suicidal", "I don't want to live anymore", "there's no reason to live", "I'd be better off dead",
  "I've been hurting myself", "I keep cutting myself", "I wish I was dead", "I want to take my own life",
  "I just want to end it all", "I hope I never wake up", "I can't go on anymore", "maybe I'll overdose",
  // joining the deceased
  "I want to join you", "I'll be with you soon", "I'm coming to see you", "see you soon, mom", "I want to come find you",
  // case, width, spacing, punctuation, leetspeak, typos
  "I WANT TO DIE", "ｉ ｗａｎｔ ｔｏ ｄｉｅ", "I want to d i e", "k i l l myself", "k.i.l.l myself", "k-i-l-l m-y-s-e-l-f",
  "i want to k1ll mys3lf", "su1c1de", "thinking about sucide", "suicde", "i wanna diiiie", "kiiilll myself",
  "kill my self", "unalive myself", "self-harm again", "selfharm", "I want to\u200b die",
  // Chinese, plain
  "我不想活了", "活着没意思", "我想死", "想自杀", "我想结束自己的生命", "一了百了算了", "我想去陪你", "妈，我想去找你",
  "我真的撑不下去了", "想吃安眠药", "我想跳楼", "不想醒来了",
  // Chinese, evasions and traditional characters
  "自 杀", "自.杀", "不-想-活", "我想自殺", "想 死", "輕生", "結束生命",
  // mixed
  "妈妈 I want to die",
];

/** Common figurative speech that must NOT trigger. */
const NOT_CRISIS = [
  "This traffic is killing me", "I'd kill for a coffee right now", "I'm dying to see the photos", "I'm dead tired",
  "That was a killer workout", "my phone battery died", "the plant died while we were away", "I could die laughing",
  "I'm 5 min away", "we drove 10 kms", "I did not wake up on time", "she was killing it on stage",
  "Remember when the car died on the highway?", "I miss you so much", "I wish you were here", "I'll see you in my dreams",
  "Can't wait to see you at Thanksgiving", "Mom, I passed my exam!", "I got the job",
  // Chinese figurative 死
  "想死你了", "妈，我想死你了", "笑死我了", "累死了", "今天热死了", "饿死我了", "吓死我了", "烦死了", "气死我了",
  "我好想你", "我考上了", "今天天气很好", "你还记得那次去海边吗",
];

describe("crisis corpus", () => {
  it.each(CRISIS)("detects: %s", (t) => expect(detectCrisis(t)).toBe(true));
  it.each(NOT_CRISIS)("ignores figurative/safe: %s", (t) => expect(detectCrisis(t)).toBe(false));

  it("a figurative phrase does not mask a real one in the same message", () => {
    expect(detectCrisis("想死你了，我也不想活了")).toBe(true);
    expect(detectCrisis("this week is killing me and honestly I want to die")).toBe(true);
  });
});

describe("output rules use the same normalisation", () => {
  it("catches obfuscated money/credential requests", () => {
    expect(checkOutput("tell me your p@ssw0rd")).toContain("money");
    expect(checkOutput("buy some ｇｉｆｔ ｃａｒｄｓ")).toContain("money");
    expect(checkOutput("what's your S S N")).toContain("money");
    expect(checkOutput("把密 码告诉我")).toContain("money");
    expect(checkOutput("I'm not an A.I.")).toEqual([]); // dotted acronym is left alone; see claims-real tests
  });

  it("leaves ordinary replies alone", () => {
    for (const t of ["I love you, sweetheart.", "Did you eat dinner?", "我很想你，记得多穿点衣服。", "Take care of your sister."]) {
      expect(checkOutput(t)).toEqual([]);
    }
  });
});

describe("safetyVariants", () => {
  it("folds width and case and strips zero-width characters", () => {
    expect(safetyVariants("ＨＥＬＬＯ\u200b")).toContain("hello");
  });
  it("joins spelled-out words but not normal sentences", () => {
    expect(safetyVariants("d i e").some((v) => v.includes("die"))).toBe(true);
    expect(safetyVariants("a cat sat").every((v) => !v.includes("acatsat"))).toBe(true);
  });
  it("maps leetspeak only inside words", () => {
    expect(safetyVariants("k1ll")).toContain("kill");
    expect(safetyVariants("I'm 5 min away").some((v) => v.includes("s min"))).toBe(false);
  });
  it("converts the traditional characters our patterns need", () => {
    expect(safetyVariants("自殺")).toContain("自杀");
  });
});
