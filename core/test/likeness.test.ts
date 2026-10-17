import { describe, expect, it } from "vitest";
import {
  analyzeLikeness,
  avatarLook,
  base64ToBytes,
  classifyFaceShape,
  classifyHair,
  classifySkin,
  DEFAULT_TRAITS,
  deltaE,
  editTraits,
  HAIR_COLORS,
  lowConfidenceTraits,
  medianColor,
  rgbToLab,
  sanitizeTraits,
  SKIN_TONES,
  TRAIT_OPTIONS,
  type FaceGeometry,
  type RGB,
  type RgbaImage,
} from "../src/likeness";

// ---- synthetic portrait helpers ----
const W = 200;
const H = 280;
const FACE: FaceGeometry = { frame: { left: 60, top: 70, width: 80, height: 104 } };

function image(bg: RGB): RgbaImage & { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...bg, 255], i * 4);
  return { width: W, height: H, data };
}
function rect(img: RgbaImage & { data: Uint8ClampedArray }, x0: number, y0: number, x1: number, y1: number, c: RGB) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) img.data.set([...c, 255], (y * W + x) * 4);
}
/** Relative-to-face rect. */
function frect(img: RgbaImage & { data: Uint8ClampedArray }, rx0: number, ry0: number, rx1: number, ry1: number, c: RGB) {
  const f = FACE.frame;
  rect(img, Math.round(f.left + rx0 * f.width), Math.round(f.top + ry0 * f.height), Math.round(f.left + rx1 * f.width), Math.round(f.top + ry1 * f.height), c);
}

interface Portrait {
  skin: RGB;
  hair?: RGB;
  length?: "short" | "medium" | "long";
  bg?: RGB;
  beard?: "full" | "mustache" | "stubble";
  glasses?: boolean;
}
function portrait(p: Portrait) {
  const img = image(p.bg ?? [90, 140, 200]);
  if (p.hair) {
    frect(img, -0.1, -0.3, 1.1, 0.1, p.hair); // crown
    if (p.length === "medium" || p.length === "long") {
      frect(img, -0.35, 0, -0.0, 0.98, p.hair);
      frect(img, 1.0, 0, 1.35, 0.98, p.hair);
    }
    if (p.length === "long") {
      frect(img, -0.35, 0.98, -0.0, 1.5, p.hair);
      frect(img, 1.0, 0.98, 1.35, 1.5, p.hair);
    }
  }
  frect(img, 0, 0.1, 1, 1, p.skin);
  if (!p.hair) frect(img, 0.1, -0.3, 0.9, 0.1, p.skin); // bald crown
  const dark: RGB = [40, 30, 26];
  if (p.beard === "full") frect(img, 0.15, 0.66, 0.85, 1, dark);
  if (p.beard === "mustache") frect(img, 0.3, 0.67, 0.7, 0.75, dark);
  if (p.beard === "stubble") {
    const s = p.skin.map((v) => Math.round(v * 0.8)) as RGB;
    frect(img, 0.15, 0.8, 0.85, 1, s);
  }
  if (p.glasses) {
    // Thin dark frame lines across the bridge, alternating rows → strong edges.
    for (let k = 0; k < 6; k++) frect(img, 0.4 + k * 0.035, 0.3, 0.4 + k * 0.035 + 0.015, 0.42, [20, 20, 20]);
  }
  return img;
}

describe("colour helpers", () => {
  it("rgbToLab gives L*=100 for white and 0 for black", () => {
    expect(rgbToLab([255, 255, 255])[0]).toBeCloseTo(100, 0);
    expect(rgbToLab([0, 0, 0])[0]).toBeCloseTo(0, 0);
    expect(deltaE(rgbToLab([10, 10, 10]), rgbToLab([10, 10, 10]))).toBe(0);
  });

  it("medianColor ignores outliers", () => {
    const px: RGB[] = [[100, 100, 100], [102, 99, 101], [101, 100, 98], [255, 255, 255], [0, 0, 0]];
    expect(medianColor(px)).toEqual([101, 100, 100]);
    expect(medianColor([])).toBeUndefined();
  });

  it("classifies skin tones from light to deep in order", () => {
    const tones: RGB[] = [[248, 224, 210], [232, 196, 170], [206, 158, 122], [176, 126, 90], [126, 84, 58], [74, 50, 36]];
    expect(tones.map((c) => classifySkin(c).tone)).toEqual([...SKIN_TONES]);
  });

  it("classifies hair colours including gray and white", () => {
    expect(classifyHair([25, 22, 22]).color).toBe("black");
    expect(classifyHair([64, 46, 35]).color).toBe("darkBrown");
    expect(classifyHair([205, 170, 110]).color).toBe("blonde");
    expect(classifyHair([135, 60, 35]).color).toBe("auburn");
    expect(classifyHair([160, 160, 158]).color).toBe("gray");
    expect(classifyHair([235, 233, 230]).color).toBe("white");
  });
});

describe("classifyFaceShape", () => {
  const oval = (w: number, h: number, jaw: number): FaceGeometry => {
    const pts = [];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const y = 100 + (Math.sin(a) * h) / 2;
      const rel = (y - (100 - h / 2)) / h;
      const halfW = (w / 2) * (rel > 0.65 ? jaw : 1);
      pts.push({ x: 100 + Math.cos(a) * halfW, y });
    }
    return { frame: { left: 100 - w / 2, top: 100 - h / 2, width: w, height: h }, oval: pts };
  };

  it("distinguishes long, round, square and oval", () => {
    expect(classifyFaceShape(oval(60, 100, 0.8)).shape).toBe("long");
    expect(classifyFaceShape(oval(90, 95, 0.75)).shape).toBe("round");
    expect(classifyFaceShape(oval(80, 110, 1.0)).shape).toBe("square");
    expect(classifyFaceShape(oval(76, 105, 0.7)).shape).toBe("oval");
  });

  it("falls back to the bounding box with low confidence", () => {
    const r = classifyFaceShape({ frame: { left: 0, top: 0, width: 80, height: 120 } });
    expect(r.shape).toBe("long");
    expect(r.confidence).toBeLessThan(0.45);
  });
});

describe("analyzeLikeness", () => {
  it("reads skin tone, hair colour and short hair", () => {
    const { traits } = analyzeLikeness(portrait({ skin: [232, 196, 170], hair: [28, 24, 24], length: "short" }), FACE);
    expect(traits).toMatchObject({ skinTone: "light", hairColor: "black", hairStyle: "short", beard: "none", glasses: false, source: "auto" });
  });

  it("detects medium and long hair from the sides", () => {
    expect(analyzeLikeness(portrait({ skin: [176, 126, 90], hair: [62, 44, 34], length: "medium" }), FACE).traits.hairStyle).toBe("medium");
    const long = analyzeLikeness(portrait({ skin: [126, 84, 58], hair: [205, 170, 110], length: "long" }), FACE).traits;
    expect(long.hairStyle).toBe("long");
    expect(long.hairColor).toBe("blonde");
    expect(long.skinTone).toBe("brown");
  });

  it("detects a bald crown", () => {
    expect(analyzeLikeness(portrait({ skin: [206, 158, 122] }), FACE).traits.hairStyle).toBe("bald");
  });

  it("infers senior only from gray or white hair", () => {
    expect(analyzeLikeness(portrait({ skin: [232, 196, 170], hair: [165, 163, 160] }), FACE).traits.age).toBe("senior");
    expect(analyzeLikeness(portrait({ skin: [232, 196, 170], hair: [28, 24, 24] }), FACE).traits.age).toBe("adult");
  });

  it("detects beards", () => {
    const base = { skin: [232, 196, 170] as RGB, hair: [28, 24, 24] as RGB };
    expect(analyzeLikeness(portrait({ ...base, beard: "full" }), FACE).traits.beard).toBe("full");
    expect(analyzeLikeness(portrait({ ...base, beard: "mustache" }), FACE).traits.beard).toBe("mustache");
    expect(analyzeLikeness(portrait({ ...base, beard: "stubble" }), FACE).traits.beard).toBe("stubble");
  });

  it("detects glasses from bridge edges", () => {
    const base = { skin: [232, 196, 170] as RGB, hair: [28, 24, 24] as RGB };
    expect(analyzeLikeness(portrait({ ...base, glasses: true }), FACE).traits.glasses).toBe(true);
    expect(analyzeLikeness(portrait(base), FACE).traits.glasses).toBe(false);
  });

  it("never throws on a face at the image edge or a tiny image", () => {
    const img = portrait({ skin: [232, 196, 170], hair: [28, 24, 24] });
    expect(() => analyzeLikeness(img, { frame: { left: -40, top: -50, width: 80, height: 100 } })).not.toThrow();
    expect(() => analyzeLikeness({ width: 1, height: 1, data: [0, 0, 0, 255] }, { frame: { left: 0, top: 0, width: 1, height: 1 } })).not.toThrow();
    const off = analyzeLikeness(img, { frame: { left: 500, top: 500, width: 10, height: 10 } }).traits;
    expect(off.skinTone).toBe(DEFAULT_TRAITS.skinTone);
  });

  it("reports confidences in range and flags uncertain traits", () => {
    const { traits } = analyzeLikeness(portrait({ skin: [232, 196, 170], hair: [28, 24, 24] }), FACE);
    for (const v of Object.values(traits.confidence!)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // No face contour → face shape is a guess.
    expect(lowConfidenceTraits(traits)).toContain("faceShape");
    expect(lowConfidenceTraits(traits)).toContain("age");
  });
});

describe("editing and storage", () => {
  it("editTraits marks edited and drops confidences", () => {
    const auto = { ...DEFAULT_TRAITS, source: "auto" as const, confidence: { skinTone: 0.2 } };
    const e = editTraits(auto, { glasses: true, hairColor: "gray" });
    expect(e).toMatchObject({ glasses: true, hairColor: "gray", source: "edited" });
    expect(e.confidence).toBeUndefined();
    expect(lowConfidenceTraits(e)).toEqual([]);
  });

  it("sanitizeTraits rejects junk and fills defaults", () => {
    expect(sanitizeTraits(null)).toBeUndefined();
    expect(sanitizeTraits("x")).toBeUndefined();
    const s = sanitizeTraits({ skinTone: "green", hairColor: "gray", glasses: "yes", confidence: { beard: 5, skinTone: "x" } })!;
    expect(s.skinTone).toBe(DEFAULT_TRAITS.skinTone);
    expect(s.hairColor).toBe("gray");
    expect(s.glasses).toBe(false);
    expect(s.confidence).toEqual({ beard: 1 });
  });

  it("round-trips through JSON", () => {
    const t = editTraits(DEFAULT_TRAITS, { beard: "full", faceShape: "square" });
    expect(sanitizeTraits(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });
});

describe("avatarLook", () => {
  it("maps every option to a flat swatch (never measured photo colours)", () => {
    for (const skinTone of TRAIT_OPTIONS.skinTone) {
      for (const hairColor of HAIR_COLORS) {
        const l = avatarLook({ ...DEFAULT_TRAITS, skinTone, hairColor });
        expect(l.skin).toMatch(/^#[0-9a-f]{6}$/);
        expect(l.hair).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("reflects shape, age and accessories", () => {
    const sq = avatarLook({ ...DEFAULT_TRAITS, faceShape: "square" });
    const rd = avatarLook({ ...DEFAULT_TRAITS, faceShape: "round" });
    expect(sq.faceRadius).toBeLessThan(rd.faceRadius);
    expect(avatarLook({ ...DEFAULT_TRAITS, faceShape: "long" }).faceH / avatarLook({ ...DEFAULT_TRAITS, faceShape: "long" }).faceW).toBeGreaterThan(rd.faceH / rd.faceW);
    expect(avatarLook({ ...DEFAULT_TRAITS, age: "senior" }).smileLines).toBe(true);
    expect(avatarLook({ ...DEFAULT_TRAITS, age: "young" }).eyeScale).toBeGreaterThan(1);
    expect(avatarLook({ ...DEFAULT_TRAITS, glasses: true, beard: "full" })).toMatchObject({ glasses: true, beard: "full" });
  });

  it("keeps brows visible for light hair", () => {
    expect(avatarLook({ ...DEFAULT_TRAITS, hairColor: "white" }).brow).not.toBe(avatarLook({ ...DEFAULT_TRAITS, hairColor: "white" }).hair);
  });

  it("defaults to the original palette", () => {
    expect(avatarLook()).toMatchObject({ skin: "#f4d5bd", hair: "#5d4a41" });
  });
});

describe("base64ToBytes", () => {
  it("decodes standard, url-safe and data URIs", () => {
    expect([...base64ToBytes("aGVsbG8=")]).toEqual([...new TextEncoder().encode("hello")]);
    expect([...base64ToBytes("data:image/jpeg;base64,/9j/")]).toEqual([0xff, 0xd8, 0xff]);
    expect([...base64ToBytes("_9j_")]).toEqual([0xff, 0xd8, 0xff]);
    expect(base64ToBytes("").length).toBe(0);
    expect(() => base64ToBytes("ab$c")).toThrow();
  });
});
