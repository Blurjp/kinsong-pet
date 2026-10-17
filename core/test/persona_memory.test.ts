import { describe, expect, it } from "vitest";
import { buildStyleProfile } from "../src/persona";
import { chatToMemories, MemoryIndex, tokenize } from "../src/memory";
import type { ChatMessage } from "../src/types";

const chat: ChatMessage[] = [];
for (let i = 0; i < 20; i++) {
  chat.push({ time: `2023-01-${String(i + 1).padStart(2, "0")}T20:00:00`, sender: "我", text: `今天加班到${i}点` });
  chat.push({ time: `2023-01-${String(i + 1).padStart(2, "0")}T20:01:00`, sender: "妈妈", text: "注意身体呀，早点睡觉哈😊" });
}

describe("buildStyleProfile", () => {
  it("captures catchphrases, particles, emoji and examples", () => {
    const s = buildStyleProfile(chat, "妈妈", 5);
    expect(s.messageCount).toBe(20);
    expect(s.catchphrases.some((p) => p.includes("注意身体"))).toBe(true);
    expect(s.particles).toContain("呀");
    expect(s.emoji).toContain("😊");
    expect(s.examples).toHaveLength(5);
    expect(s.examples[0]!.reply).toContain("注意身体");
  });
});

describe("MemoryIndex", () => {
  it("tokenizes mixed CJK/latin", () => {
    expect(tokenize("去北京 trip")).toEqual(["去北", "北京", "trip"]);
  });

  it("retrieves the relevant story and favours family-written memories", () => {
    const idx = new MemoryIndex();
    idx.add({ id: "1", kind: "story", text: "1998年夏天全家去北戴河看海，妈妈第一次见到大海。" });
    idx.add({ id: "2", kind: "fact", text: "妈妈最拿手的菜是红烧肉。" });
    for (const m of chatToMemories(chat)) idx.add(m);
    expect(idx.search("还记得我们去看海吗")[0]!.id).toBe("1");
    expect(idx.search("想吃你做的红烧肉")[0]!.id).toBe("2");
  });
});

describe("English style", () => {
  it("keeps distinctive phrases and drops function-word n-grams", () => {
    const chat: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      chat.push({ time: "", sender: "Me", text: `long day ${i}` });
      chat.push({ time: "", sender: "Dad", text: "Proud of you kiddo. Get some rest!" });
    }
    const s = buildStyleProfile(chat, "Dad");
    expect(s.catchphrases.some((p) => p.includes("proud of you kiddo") || p.includes("you kiddo"))).toBe(true);
    expect(s.catchphrases).not.toContain("of you");
    expect(s.exclaimRate).toBe(1);
  });
});
