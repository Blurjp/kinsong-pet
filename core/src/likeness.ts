/**
 * Stylized likeness: turn one photo into a handful of *cartoon* avatar traits.
 *
 * Everything here is pure TypeScript and runs on the phone. The app supplies a
 * small decoded RGBA image and the face geometry from the on-device face
 * detector; this module samples colours in face-relative regions and buckets
 * the result into a fixed, deliberately stylized vocabulary. Output is never a
 * photo, texture or embedding — only a few enum values the user can edit.
 */

export const SKIN_TONES = ["porcelain", "light", "medium", "tan", "brown", "deep"] as const;
export const HAIR_COLORS = ["black", "darkBrown", "brown", "auburn", "blonde", "gray", "white"] as const;
export const HAIR_STYLES = ["bald", "short", "medium", "long", "bun"] as const;
export const FACE_SHAPES = ["round", "oval", "long", "square"] as const;
export const BEARDS = ["none", "stubble", "mustache", "full"] as const;
export const AGES = ["young", "adult", "senior"] as const;

export type SkinTone = (typeof SKIN_TONES)[number];
export type HairColor = (typeof HAIR_COLORS)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type FaceShape = (typeof FACE_SHAPES)[number];
export type Beard = (typeof BEARDS)[number];
export type AgeBucket = (typeof AGES)[number];

export interface AvatarTraits {
  skinTone: SkinTone;
  hairColor: HairColor;
  hairStyle: HairStyle;
  glasses: boolean;
  faceShape: FaceShape;
  beard: Beard;
  age: AgeBucket;
  /** "auto" straight from detection; "edited" once a person changed anything. */
  source: "default" | "auto" | "edited";
  /** Detection confidence per trait, 0…1 (absent for defaults/edits). */
  confidence?: Partial<Record<TraitKey, number>>;
}

export type TraitKey = "skinTone" | "hairColor" | "hairStyle" | "glasses" | "faceShape" | "beard" | "age";
export const TRAIT_KEYS: readonly TraitKey[] = ["skinTone", "hairColor", "hairStyle", "glasses", "faceShape", "beard", "age"];

export const DEFAULT_TRAITS: AvatarTraits = {
  skinTone: "light",
  hairColor: "darkBrown",
  hairStyle: "short",
  glasses: false,
  faceShape: "oval",
  beard: "none",
  age: "adult",
  source: "default",
};

/** Options per enum trait, for editors. */
export const TRAIT_OPTIONS = {
  skinTone: SKIN_TONES,
  hairColor: HAIR_COLORS,
  hairStyle: HAIR_STYLES,
  faceShape: FACE_SHAPES,
  beard: BEARDS,
  age: AGES,
} as const;

// ---------------------------------------------------------------- colour

export type RGB = [number, number, number];
export type Lab = [number, number, number];

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** sRGB (0–255) → CIE L*a*b* (D65). */
export function rgbToLab([r, g, b]: RGB): Lab {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const chroma = (l: Lab) => Math.hypot(l[1], l[2]);

/** Reference colours for bucketing (typical photo values, not the render colours). */
const SKIN_REF: Record<SkinTone, RGB> = {
  porcelain: [246, 222, 208],
  light: [232, 196, 170],
  medium: [208, 160, 124],
  tan: [178, 128, 92],
  brown: [128, 86, 60],
  deep: [78, 52, 38],
};
const HAIR_REF: Record<Exclude<HairColor, "gray" | "white">, RGB> = {
  black: [28, 24, 24],
  darkBrown: [62, 44, 34],
  brown: [112, 78, 54],
  auburn: [134, 62, 36],
  blonde: [206, 172, 112],
};

function nearest<K extends string>(lab: Lab, refs: Record<K, RGB>): { key: K; dist: number; second: number } {
  let best: K | undefined;
  let d1 = Infinity;
  let d2 = Infinity;
  for (const k of Object.keys(refs) as K[]) {
    const d = deltaE(lab, rgbToLab(refs[k]));
    if (d < d1) {
      d2 = d1;
      d1 = d;
      best = k;
    } else if (d < d2) d2 = d;
  }
  return { key: best!, dist: d1, second: d2 };
}

/** Confidence from how clearly the best match beats the runner-up. */
const margin = (d1: number, d2: number) => Math.max(0.05, Math.min(0.95, (d2 - d1) / (d2 + 1e-6) + 0.3 - d1 / 100));

export function classifySkin(rgb: RGB): { tone: SkinTone; confidence: number } {
  // Bucket mostly by lightness: hue varies with lighting far more than tone does.
  const lab = rgbToLab(rgb);
  const n = nearest(lab, SKIN_REF);
  return { tone: n.key, confidence: margin(n.dist, n.second) };
}

export function classifyHair(rgb: RGB): { color: HairColor; confidence: number } {
  const lab = rgbToLab(rgb);
  // Low chroma and light → gray/white (checked first: they don't match brown refs well).
  if (chroma(lab) < 12 && lab[0] > 52) return { color: lab[0] > 78 ? "white" : "gray", confidence: 0.6 };
  const n = nearest(lab, HAIR_REF);
  return { color: n.key, confidence: margin(n.dist, n.second) };
}

// ---------------------------------------------------------------- image sampling

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: ArrayLike<number>;
}

export interface Point {
  x: number;
  y: number;
}

export interface FaceGeometry {
  /** Face bounding box in image pixels (forehead to chin, cheek to cheek). */
  frame: { left: number; top: number; width: number; height: number };
  leftEye?: Point;
  rightEye?: Point;
  /** Face outline points (e.g. ML Kit "face" contour), image pixels. */
  oval?: Point[];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Box in face-relative units (0..1 of the frame, may extend outside) → pixels, clamped. */
function faceBox(img: RgbaImage, f: FaceGeometry, rx0: number, ry0: number, rx1: number, ry1: number): Box | undefined {
  const { left, top, width, height } = f.frame;
  const x0 = Math.max(0, Math.round(left + rx0 * width));
  const y0 = Math.max(0, Math.round(top + ry0 * height));
  const x1 = Math.min(img.width, Math.round(left + rx1 * width));
  const y1 = Math.min(img.height, Math.round(top + ry1 * height));
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x0, y0, x1, y1 } : undefined;
}

function pixels(img: RgbaImage, b: Box | undefined): RGB[] {
  if (!b) return [];
  const out: RGB[] = [];
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = (y * img.width + x) * 4;
      out.push([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]);
    }
  }
  return out;
}

/** Per-channel median: robust to stray highlights, freckles and background pixels. */
export function medianColor(px: RGB[]): RGB | undefined {
  if (!px.length) return undefined;
  const med = (c: 0 | 1 | 2) => {
    const v = px.map((p) => p[c]).sort((a, b) => a - b);
    return v[v.length >> 1]!;
  };
  return [med(0), med(1), med(2)];
}

/** Fraction of pixels within `tol` ΔE of a colour. */
function fractionNear(px: RGB[], ref: Lab, tol: number): number {
  if (!px.length) return 0;
  let n = 0;
  for (const p of px) if (deltaE(rgbToLab(p), ref) < tol) n++;
  return n / px.length;
}

/** Mean absolute luminance gradient (edge energy). */
function edgeEnergy(img: RgbaImage, b: Box | undefined): number {
  if (!b || b.x1 - b.x0 < 2 || b.y1 - b.y0 < 2) return 0;
  const lum = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    return 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
  };
  let sum = 0;
  let n = 0;
  for (let y = b.y0; y < b.y1 - 1; y++) {
    for (let x = b.x0; x < b.x1 - 1; x++) {
      sum += Math.abs(lum(x + 1, y) - lum(x, y)) + Math.abs(lum(x, y + 1) - lum(x, y));
      n++;
    }
  }
  return n ? sum / n : 0;
}

// ---------------------------------------------------------------- shape

export function classifyFaceShape(f: FaceGeometry): { shape: FaceShape; confidence: number } {
  const { width, height } = f.frame;
  const pts = f.oval;
  if (!pts || pts.length < 8) {
    const r = height / Math.max(1, width);
    return { shape: r > 1.35 ? "long" : r < 1.08 ? "round" : "oval", confidence: 0.3 };
  }
  const ys = pts.map((p) => p.y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const h = bottom - top;
  const widthAt = (rel: number) => {
    const y = top + rel * h;
    const band = pts.filter((p) => Math.abs(p.y - y) < h * 0.08);
    if (band.length < 2) return 0;
    const xs = band.map((p) => p.x);
    return Math.max(...xs) - Math.min(...xs);
  };
  const cheek = widthAt(0.5) || width;
  const jaw = widthAt(0.82);
  const ratio = h / Math.max(1, cheek);
  const jawRatio = jaw / Math.max(1, cheek);
  if (ratio > 1.5) return { shape: "long", confidence: 0.6 };
  if (jawRatio > 0.86) return { shape: "square", confidence: 0.5 };
  if (ratio < 1.2) return { shape: "round", confidence: 0.55 };
  return { shape: "oval", confidence: 0.5 };
}

// ---------------------------------------------------------------- whole pipeline

export interface LikenessResult {
  traits: AvatarTraits;
  /** Measured colours, for debugging/QA only (not stored). */
  measured: { skin?: RGB; hair?: RGB };
}

/**
 * Derive cartoon traits from a decoded image and face geometry. Every trait has
 * a fallback, so this never throws on odd input; low-confidence traits should
 * be highlighted in the editor for the family to check.
 */
export function analyzeLikeness(img: RgbaImage, face: FaceGeometry): LikenessResult {
  const conf: Partial<Record<TraitKey, number>> = {};

  // Skin: both cheeks + forehead, away from eyes, brows, mouth and hairline.
  const skinPx = [
    ...pixels(img, faceBox(img, face, 0.18, 0.5, 0.34, 0.64)),
    ...pixels(img, faceBox(img, face, 0.66, 0.5, 0.82, 0.64)),
    ...pixels(img, faceBox(img, face, 0.38, 0.12, 0.62, 0.22)),
  ];
  const skin = medianColor(skinPx);
  const skinC = skin ? classifySkin(skin) : { tone: DEFAULT_TRAITS.skinTone, confidence: 0 };
  conf.skinTone = skinC.confidence;
  const skinLab = skin ? rgbToLab(skin) : rgbToLab(SKIN_REF[DEFAULT_TRAITS.skinTone]);

  // Hair: a band just above the face frame (crown). Background can leak in here.
  const crownPx = pixels(img, faceBox(img, face, 0.22, -0.22, 0.78, -0.04));
  const hair = medianColor(crownPx);
  let hairStyle: HairStyle = DEFAULT_TRAITS.hairStyle;
  let hairColor: HairColor = DEFAULT_TRAITS.hairColor;
  if (!hair) {
    conf.hairStyle = 0;
    conf.hairColor = 0;
  } else if (deltaE(rgbToLab(hair), skinLab) < 14) {
    hairStyle = "bald";
    conf.hairStyle = 0.5;
    conf.hairColor = 0.1;
  } else {
    const hc = classifyHair(hair);
    hairColor = hc.color;
    conf.hairColor = hc.confidence;
    // Length: how much hair-coloured area sits beside the face at jaw and below-chin level.
    const hairLab = rgbToLab(hair);
    const side = (ry0: number, ry1: number) =>
      (fractionNear(pixels(img, faceBox(img, face, -0.32, ry0, -0.04, ry1)), hairLab, 16) +
        fractionNear(pixels(img, faceBox(img, face, 1.04, ry0, 1.32, ry1)), hairLab, 16)) /
      2;
    const jawLevel = side(0.55, 0.95);
    const belowChin = side(1.0, 1.45);
    if (belowChin > 0.45) hairStyle = "long";
    else if (jawLevel > 0.4) hairStyle = "medium";
    else hairStyle = "short";
    conf.hairStyle = 0.35 + 0.4 * Math.abs((hairStyle === "long" ? belowChin : jawLevel) - 0.4);
  }

  // Beard: chin and upper-lip regions noticeably darker than skin.
  const chin = medianColor(pixels(img, faceBox(img, face, 0.32, 0.84, 0.68, 0.97)));
  const lip = medianColor(pixels(img, faceBox(img, face, 0.36, 0.68, 0.64, 0.74)));
  const darker = (c?: RGB) => (c ? skinLab[0] - rgbToLab(c)[0] : 0);
  const dChin = darker(chin);
  const dLip = darker(lip);
  let beard: Beard = "none";
  if (dChin > 22) beard = "full";
  else if (dLip > 22 && dChin < 12) beard = "mustache";
  else if (dChin > 12) beard = "stubble";
  conf.beard = beard === "none" ? Math.max(0.3, 0.8 - dChin / 30) : Math.min(0.8, 0.3 + Math.max(dChin, dLip) / 60);

  // Glasses: frames add strong edges on the nose bridge, where bare skin is smooth.
  const bridge = edgeEnergy(img, faceBox(img, face, 0.42, 0.3, 0.58, 0.42));
  const cheekEdges = edgeEnergy(img, faceBox(img, face, 0.18, 0.5, 0.34, 0.64)) + 1;
  const glassesScore = bridge / cheekEdges;
  const glasses = glassesScore > 3;
  conf.glasses = Math.min(0.7, 0.2 + Math.abs(glassesScore - 3) / 10);

  const shape = classifyFaceShape(face);
  conf.faceShape = shape.confidence;

  // Age: only "senior" is inferred, and only from gray/white hair. Never guessed young.
  const age: AgeBucket = hairColor === "gray" || hairColor === "white" ? "senior" : "adult";
  conf.age = age === "senior" ? 0.45 : 0.2;

  return {
    traits: {
      skinTone: skinC.tone,
      hairColor,
      hairStyle,
      glasses,
      faceShape: shape.shape,
      beard,
      age,
      source: "auto",
      confidence: conf,
    },
    measured: { skin, hair },
  };
}

/** Traits whose detection is too uncertain to trust without review. */
export function lowConfidenceTraits(t: AvatarTraits, threshold = 0.45): TraitKey[] {
  if (t.source !== "auto" || !t.confidence) return [];
  return TRAIT_KEYS.filter((k) => (t.confidence![k] ?? 0) < threshold);
}

/** Apply a manual edit; the result is marked edited and confidences dropped. */
export function editTraits(t: AvatarTraits, patch: Partial<Omit<AvatarTraits, "source" | "confidence">>): AvatarTraits {
  const next = sanitizeTraits({ ...t, ...patch });
  const { confidence: _drop, ...rest } = next ?? DEFAULT_TRAITS;
  void _drop;
  return { ...rest, source: "edited" };
}

const oneOf = <T extends string>(opts: readonly T[], v: unknown, d: T): T => (opts.includes(v as T) ? (v as T) : d);

/** Validate traits read from storage; unknown values fall back to defaults. */
export function sanitizeTraits(x: unknown): AvatarTraits | undefined {
  if (typeof x !== "object" || x === null) return undefined;
  const o = x as Record<string, unknown>;
  const D = DEFAULT_TRAITS;
  const out: AvatarTraits = {
    skinTone: oneOf(SKIN_TONES, o.skinTone, D.skinTone),
    hairColor: oneOf(HAIR_COLORS, o.hairColor, D.hairColor),
    hairStyle: oneOf(HAIR_STYLES, o.hairStyle, D.hairStyle),
    glasses: o.glasses === true,
    faceShape: oneOf(FACE_SHAPES, o.faceShape, D.faceShape),
    beard: oneOf(BEARDS, o.beard, D.beard),
    age: oneOf(AGES, o.age, D.age),
    source: oneOf(["default", "auto", "edited"] as const, o.source, "edited"),
  };
  if (typeof o.confidence === "object" && o.confidence !== null) {
    const c: Partial<Record<TraitKey, number>> = {};
    for (const k of TRAIT_KEYS) {
      const v = (o.confidence as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) c[k] = Math.max(0, Math.min(1, v));
    }
    out.confidence = c;
  }
  return out;
}

// ---------------------------------------------------------------- rendering look

/**
 * Flat cartoon render colours. These are intentionally *not* the measured
 * photo colours: each bucket maps to one fixed, slightly idealised swatch so
 * the avatar always reads as an illustration.
 */
export const SKIN_SWATCH: Record<SkinTone, { skin: string; shade: string; outline: string }> = {
  porcelain: { skin: "#fbe6d8", shade: "#efcdb8", outline: "#e6c1a8" },
  light: { skin: "#f4d5bd", shade: "#e8c3a5", outline: "#e0b998" },
  medium: { skin: "#e2b48e", shade: "#cf9c74", outline: "#c48f68" },
  tan: { skin: "#c98f62", shade: "#b47a50", outline: "#a86f47" },
  brown: { skin: "#94613f", shade: "#7f5133", outline: "#74482c" },
  deep: { skin: "#5f3d29", shade: "#4f3221", outline: "#462b1c" },
};
export const HAIR_SWATCH: Record<HairColor, string> = {
  black: "#2b2523",
  darkBrown: "#5d4a41",
  brown: "#8a6146",
  auburn: "#9c4f2e",
  blonde: "#d9b878",
  gray: "#a3a19e",
  white: "#e7e4df",
};

export interface AvatarLook {
  skin: string;
  skinShade: string;
  outline: string;
  hair: string;
  brow: string;
  hairStyle: HairStyle;
  glasses: boolean;
  beard: Beard;
  /** Face width/height as fractions of the avatar size. */
  faceW: number;
  faceH: number;
  /** Corner radius of the face as a fraction of its width (0.5 = fully round). */
  faceRadius: number;
  /** Show soft smile lines (senior). */
  smileLines: boolean;
  /** Eye scale multiplier (young faces get slightly larger eyes). */
  eyeScale: number;
}

const SHAPE_DIMS: Record<FaceShape, { faceW: number; faceH: number; faceRadius: number }> = {
  round: { faceW: 0.82, faceH: 0.86, faceRadius: 0.5 },
  oval: { faceW: 0.78, faceH: 0.92, faceRadius: 0.5 },
  long: { faceW: 0.7, faceH: 0.96, faceRadius: 0.48 },
  square: { faceW: 0.8, faceH: 0.9, faceRadius: 0.32 },
};

export function avatarLook(t: AvatarTraits = DEFAULT_TRAITS): AvatarLook {
  const s = SKIN_SWATCH[t.skinTone] ?? SKIN_SWATCH.light;
  const hair = HAIR_SWATCH[t.hairColor] ?? HAIR_SWATCH.darkBrown;
  // Very light hair would vanish as brows on light skin; darken brows a little.
  const brow = t.hairColor === "white" || t.hairColor === "blonde" || t.hairColor === "gray" ? "#8b7d70" : hair;
  return {
    skin: s.skin,
    skinShade: s.shade,
    outline: s.outline,
    hair,
    brow,
    hairStyle: t.hairStyle,
    glasses: t.glasses,
    beard: t.beard,
    ...(SHAPE_DIMS[t.faceShape] ?? SHAPE_DIMS.oval),
    smileLines: t.age === "senior",
    eyeScale: t.age === "young" ? 1.12 : 1,
  };
}

// ---------------------------------------------------------------- util

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t["-".charCodeAt(0)] = 62; // base64url
  t["_".charCodeAt(0)] = 63;
  return t;
})();

/** Decode base64 (standard or URL-safe; whitespace and data: prefix tolerated) without relying on atob/Buffer. */
export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/^data:[^,]*,/, "").replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c]! : -1;
    if (v < 0) throw new Error(`Invalid base64 character at ${i}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}
