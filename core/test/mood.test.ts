import { describe, expect, it } from "vitest";
import { inferMood, MOODS, type Mood } from "../src/mood";

describe("inferMood", () => {
  it("returns a mood from the known set", () => {
    const m = inferMood("hello there", "Hi dear, how are you today?");
    expect(MOODS).toContain(m);
  });

  it("grief cues dominate: sadness beats everything else", () => {
    expect(inferMood("I've been so sad and crying all week", "Oh no, love you!")).toBe<Mood>("sad");
  });

  it("explicit sadness in Chinese", () => {
    expect(inferMood("最近特别难受，总是想哭", "孩子，别难过")).toBe<Mood>("sad");
  });

  it("user good news makes the face light up", () => {
    expect(inferMood("I passed my driving test!", "That's wonderful, congratulations!")).toBe<Mood>("happy");
  });

  it("joyful replies with several marks read as happy", () => {
    expect(inferMood("just wanted to say hi", "Hi sweetheart! So good to hear from you! 😊")).toBe<Mood>("happy");
  });

  it("affection reads as warm", () => {
    expect(inferMood("I miss you mom", "I miss you too, honey.")).toBe<Mood>("warm");
  });

  it("affection in Chinese reads as warm", () => {
    expect(inferMood("妈，我好想你", "妈也想你，好好吃饭")).toBe<Mood>("warm");
  });

  it("surprise interjections read as surprised", () => {
    expect(inferMood("wow, really?", "Yes! Hard to believe, right?")).toBe<Mood>("surprised");
  });

  it("a plain question reads as thinking", () => {
    expect(inferMood("what was your favorite season?", "Let me think… probably autumn.")).toBe<Mood>("thinking");
  });

  it("plain statements stay neutral", () => {
    expect(inferMood("the garden looks nice", "It does. Water the roses for me.")).toBe<Mood>("neutral");
  });
});
