import { describe, expect, it } from "vitest";
import {
  addDays,
  gardenState,
  gentleNudge,
  imaginedNote,
  imaginedPostcard,
  occasionsOn,
  sceneFor,
  upcomingOccasions,
  type PetProfile,
  type Visit,
} from "../src/garden";

const max: PetProfile = {
  name: "Max",
  species: "dog",
  coat: "#c8955a",
  born: "2012-03-14",
  adopted: "2012-06-01",
  passed: "2025-10-20",
  favorites: { toys: ["squeaky duck"], treats: ["peanut butter"], spots: ["the back porch"] },
  traits: ["goofy"],
  wishes: [{ id: "w1", text: "Chase the seagulls at the beach!" }],
};

describe("remembrance days", () => {
  it("lists personal and community days in order, with years", () => {
    const days = upcomingOccasions(max, "2026-01-01", 365).map((o) => `${o.on} ${o.kind} ${o.years ?? ""}`.trim());
    expect(days).toEqual([
      "2026-03-14 birthday 14",
      "2026-04-11 national-pet-day",
      "2026-06-01 gotcha-day 14",
      "2026-08-28 rainbow-bridge-day",
      "2026-09-13 pet-memorial-day", // second Sunday of September 2026
      "2026-10-20 anniversary 1",
    ]);
  });

  it("does not count the day they passed, or anything before it", () => {
    expect(occasionsOn(max, "2025-10-20")).toEqual([]);
    expect(upcomingOccasions(max, "2025-09-01", 40).map((o) => o.kind)).toEqual([]);
  });

  it("moves a Feb 29 birthday to Feb 28 in common years", () => {
    const leapPup = { ...max, born: "2016-02-29", adopted: undefined };
    expect(occasionsOn(leapPup, "2027-02-28").map((o) => o.kind)).toEqual(["birthday"]);
  });

  it("only nudges on remembrance days — never on ordinary days", () => {
    expect(gentleNudge(max, "2026-10-20")).toBe("One year since Max crossed the bridge. Would you like to stop by the garden?");
    expect(gentleNudge(max, "2026-10-21")).toBeUndefined();
  });
});

describe("garden", () => {
  const visits: Visit[] = [
    { id: "a", on: "2025-11-01", kind: "flower", flower: "daisy", by: "Sam" },
    { id: "b", on: "2026-10-20", kind: "flower", flower: "sunflower" },
    { id: "c", on: "2026-10-20", kind: "candle" },
    { id: "d", on: "2026-10-18", kind: "treat", treat: "peanut butter" },
    { id: "e", on: "2026-01-02", kind: "letter", text: "Miss you buddy" },
    { id: "f", on: "2027-01-01", kind: "flower", flower: "tulip" }, // future: not shown yet
  ];

  it("keeps every flower, lights today's candles, shows a week of treats", () => {
    const g = gardenState(max, visits, "2026-10-20");
    expect(g.flowers.map((f) => f.id).sort()).toEqual(["a", "b"]);
    expect(g.candlesLit).toBe(1);
    expect(g.treats).toEqual(["peanut butter"]);
    expect(g.letters).toBe(1);
    expect(g.daysSince).toBe(365);
    expect(gardenState(max, visits, "2026-10-21").candlesLit).toBe(0);
    expect(gardenState(max, visits, "2026-10-26").treats).toEqual([]);
  });

  it("places a flower in the same spot every time and lets it grow with the years", () => {
    const a1 = gardenState(max, visits, "2026-10-20").flowers.find((f) => f.id === "a")!;
    const a2 = gardenState(max, visits, addDays("2025-11-01", 365 * 2 + 1)).flowers.find((f) => f.id === "a")!;
    expect([a1.x, a1.depth]).toEqual([a2.x, a2.depth]);
    expect(a1.x).toBeGreaterThan(0);
    expect(a1.x).toBeLessThan(1);
    expect(a2.scale).toBeGreaterThan(a1.scale);
  });

  it("scatters flowers with similar ids across the meadow", () => {
    const many: Visit[] = Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, on: "2026-01-01", kind: "flower", flower: "daisy" }));
    const xs = gardenState(max, many, "2026-01-02").flowers.map((f) => f.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5);
  });

  it("grows the memory tree one ring per year the family came back", () => {
    expect(gardenState(max, visits, "2026-10-20").treeRings).toBe(2);
    expect(gardenState(max, visits, "2027-02-01").treeRings).toBe(3);
  });
});

describe("wishes", () => {
  it("picks a scene from the wish and labels the postcard as imagined", () => {
    const p = imaginedPostcard(max, max.wishes[0]!);
    expect(p).toMatchObject({ scene: "beach", caption: "Today Max finally got to chase the seagulls at the beach." });
    expect(p.label).toMatch(/^Imagined/);
    expect(sceneFor("go sledding in the snow")).toBe("snow");
    expect(sceneFor("a hike on a mountain trail")).toBe("forest");
    expect(sceneFor("swim in the lake")).toBe("lake");
    expect(sceneFor("eat a whole pizza")).toBe("meadow");
  });

  it("builds an imagined note only from what the family wrote", () => {
    const note = imaginedNote(max, { kind: "birthday", on: "2026-03-14", years: 14 });
    expect(note).toContain("the back porch");
    expect(note).toContain("squeaky duck");
    expect(note).toContain("goofy");
    expect(note.endsWith("— Max")).toBe(true);
    const sparse = imaginedNote({ ...max, favorites: { toys: [], treats: [], spots: [] }, traits: [] }, { kind: "anniversary", on: "2026-10-20", years: 1 });
    expect(sparse).not.toContain("undefined");
  });
});
