import { describe, expect, it } from "vitest";
import {
  LANDMARKS,
  activityWeights,
  coatColorsFromImage,
  isNight,
  nextMoment,
  pickSound,
  react,
  type LifeContext,
  type SoundClip,
} from "../src/petLife";

const base: LifeContext = { name: "Max", species: "dog", traits: [], hour: 14, seed: 1, flowers: [], toy: "squeaky duck" };

describe("life in the garden", () => {
  it("sleeps under the stars at night, every night", () => {
    expect(isNight(22)).toBe(true);
    expect(isNight(5)).toBe(true);
    expect(isNight(6)).toBe(false);
    for (let seed = 0; seed < 20; seed++) {
      const m = nextMoment({ ...base, hour: 23, seed });
      expect(m).toMatchObject({ activity: "sleep", pose: "sleep", at: LANDMARKS.tree });
    }
  });

  it("is reproducible for a seed and varied across seeds", () => {
    expect(nextMoment(base)).toEqual(nextMoment(base));
    const kinds = new Set(Array.from({ length: 60 }, (_, seed) => nextMoment({ ...base, seed }).activity));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it("follows personality: lazy cats nap more than playful dogs", () => {
    const share = (c: Partial<LifeContext>, a: string) =>
      Array.from({ length: 400 }, (_, seed) => nextMoment({ ...base, ...c, seed }).activity).filter((x) => x === a).length / 400;
    expect(share({ species: "cat", traits: ["lazy"] }, "nap")).toBeGreaterThan(share({ species: "dog", traits: ["playful"] }, "nap") + 0.15);
    expect(activityWeights("dog", ["goofy"]).play).toBeGreaterThan(activityWeights("dog", []).play);
  });

  it("sniffs the flowers the family planted, and only plays when it has a toy", () => {
    const flowers = [{ id: "f", flower: "tulip" as const, x: 0.7, depth: 0.5, scale: 1 }];
    const sniffs = Array.from({ length: 200 }, (_, seed) => nextMoment({ ...base, seed, flowers })).filter((m) => m.activity === "sniff");
    expect(sniffs.length).toBeGreaterThan(0);
    expect(sniffs.every((m) => m.caption.includes("tulips you planted") && m.at.x === 0.7)).toBe(true);
    const plays = Array.from({ length: 200 }, (_, seed) => nextMoment({ ...base, seed, toy: undefined, traits: ["playful"] })).filter((m) => m.activity === "play");
    expect(plays.length).toBeLessThan(30);
  });

  it("always stays inside the meadow", () => {
    for (let seed = 0; seed < 200; seed++) {
      const { at } = nextMoment({ ...base, seed });
      expect(at.x).toBeGreaterThanOrEqual(0.1);
      expect(at.x).toBeLessThanOrEqual(0.9);
      expect(at.depth).toBeGreaterThanOrEqual(0);
      expect(at.depth).toBeLessThanOrEqual(1);
    }
  });

  it("never mentions being hungry, lonely, sad or missing you", () => {
    const words = /hungry|lonely|sad|miss|waiting|alone|starv/i;
    for (const species of ["dog", "cat", "rabbit", "bird", "other"] as const) {
      for (let seed = 0; seed < 80; seed++) {
        for (const hour of [3, 9, 15]) expect(nextMoment({ ...base, species, hour, seed }).caption).not.toMatch(words);
      }
    }
  });
});

describe("reacting to the family", () => {
  const here = { x: 0.3, depth: 0.4 };

  it("comes to you when called, and uses the right voice for the species", () => {
    const dog = react("call", { name: "Max", species: "dog", here });
    expect(dog).toMatchObject({ at: LANDMARKS.owner, pose: "happy", hearts: true, caption: "Max hears your voice and comes running!" });
    expect(dog.sounds[0]).toBe("bark");
    expect(react("pet", { name: "Luna", species: "cat", here }).sounds[0]).toBe("purr");
  });

  it("fetches their own toy and eats their own treat", () => {
    expect(react("play", { name: "Max", species: "dog", here, toy: "squeaky duck" }).caption).toBe("Max chases the squeaky duck and brings it right back to you.");
    expect(react("treat", { name: "Max", species: "dog", here, treat: "peanut butter" })).toMatchObject({ pose: "eat", at: LANDMARKS.bowl, caption: "Max happily munches the peanut butter." });
  });

  it("stays where it is when petted", () => {
    expect(react("pet", { name: "Max", species: "dog", here }).at).toEqual(here);
  });
});

describe("pickSound", () => {
  const clips: SoundClip[] = [
    { id: "1", uri: "a", tag: "bark" },
    { id: "2", uri: "b", tag: "bark" },
    { id: "3", uri: "c", tag: "whine" },
  ];

  it("prefers the first tag that has recordings", () => {
    expect(pickSound(clips, ["happy", "whine"], 1)?.id).toBe("3");
    expect(["1", "2"]).toContain(pickSound(clips, ["bark"], 7)?.id);
  });

  it("falls back to any of their recordings, or nothing when there are none", () => {
    expect(pickSound(clips, ["purr"], 1)).toBeDefined();
    expect(pickSound([], ["bark"], 1)).toBeUndefined();
  });
});

describe("coatColorsFromImage", () => {
  /** A golden dog with a dark-brown patch in the middle of a green lawn. */
  function photo() {
    const w = 60, h = 60, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inDog = x > 15 && x < 45 && y > 12 && y < 52;
        const inPatch = inDog && x > 30 && y < 25;
        const [r, g, b] = inPatch ? [92, 58, 34] : inDog ? [214, 168, 102] : [70, 150, 60];
        data.set([r, g, b, 255], i);
      }
    }
    return { width: w, height: h, data };
  }

  it("finds the coat and a distinct marking colour, ignoring the grass", () => {
    const c = coatColorsFromImage(photo())!;
    expect(c.coat).toBe("#d6a866");
    expect(c.accent).toBe("#5c3a22");
  });

  it("returns nothing for an image with no pet-like pixels", () => {
    const w = 10, h = 10, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([60, 160, 60, 255], i * 4);
    expect(coatColorsFromImage({ width: w, height: h, data })).toBeUndefined();
  });
});
