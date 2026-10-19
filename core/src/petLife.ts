/**
 * The pet's life in the garden, and how it responds to its family.
 *
 * Rules (see docs/MEMORIAL_GARDEN.md and pets/README.md):
 *  - The pet is always content. It never gets hungry, lonely or sad, and it
 *    never "misses" you. Nothing here depends on how long it has been since
 *    the last visit, so there is no guilt loop and nothing to keep alive.
 *  - Captions describe what the simulated pet does, in the third person. The
 *    pet does not talk, and nothing claims to be the real animal.
 *  - Its voice is the family's own recordings, played back as-is. Nothing
 *    is synthesised.
 *  - With video clips, it looks and moves exactly as in the family's own
 *    footage: the real frames, cut out of their background. It can only do
 *    what the footage shows; no new movement is generated.
 */

import type { RgbaImage } from "./likeness";
import type { PlacedFlower, Species } from "./garden";

export type Activity = "sit" | "wander" | "nap" | "sniff" | "play" | "gaze" | "sleep";
export type Interaction = "pet" | "call" | "play" | "treat";
export type Pose = "sit" | "walk" | "sleep" | "happy" | "eat";
export type SoundTag = "bark" | "whine" | "howl" | "meow" | "purr" | "chirp" | "squeak" | "happy" | "other";

export const SOUND_TAGS: readonly SoundTag[] = ["bark", "whine", "howl", "meow", "purr", "chirp", "squeak", "happy", "other"];

export interface SoundClip {
  id: string;
  uri: string;
  tag: SoundTag;
}

export interface PetPhoto {
  id: string;
  uri: string;
  addedOn: string;
}

/** What a clip from the family's own video shows the pet doing. */
export type ClipAction = "sit" | "walk" | "play" | "bark" | "sleep" | "eat";

export const CLIP_ACTIONS: readonly ClipAction[] = ["sit", "walk", "play", "bark", "sleep", "eat"];

/**
 * A short clip from the family's own video, cut out of its background on the
 * phone. The picture is the real footage at its own frame rate, with the
 * background made transparent; the sound is the clip's own audio, untouched.
 * Nothing is generated.
 */
export interface VideoClip {
  id: string;
  action: ClipAction;
  /** Folder holding the video, poster and audio, so the clip can be forgotten in one go. */
  dir: string;
  videoUri: string;
  /** The first frame, for places that don't play video. */
  posterUri: string;
  /** Frame size in pixels. Unless it's a close-up, the pet's feet touch the bottom edge. */
  width: number;
  height: number;
  seconds: number;
  /** False when the pet couldn't be separated from the background, so the footage keeps it. */
  cutout: boolean;
  /** The pet runs off the bottom of the picture, so it's shown near, from the bottom of the scene. */
  closeUp: boolean;
  /** Which way the pet travels in the footage, to face it the right way in the garden. */
  facing: "left" | "right";
  audioUri?: string;
}

/**
 * How the real pet moves in the garden. A real animal can't glide, so it only
 * travels when there's a walking clip to show it walking; otherwise it stays
 * where it is and only what it's doing changes. Close-ups never travel.
 */
export function canTravel(clips: readonly VideoClip[]): boolean {
  return clips.some((c) => c.action === "walk" && !c.closeUp);
}

/** A point in the meadow: x 0..1 left→right, depth 0 (far) → 1 (near). */
export interface Spot {
  x: number;
  depth: number;
}

export const LANDMARKS = {
  tree: { x: 0.2, depth: 0.12 },
  bowl: { x: 0.38, depth: 0.2 },
  toy: { x: 0.63, depth: 0.22 },
  view: { x: 0.52, depth: 0.04 },
  owner: { x: 0.5, depth: 0.95 },
} satisfies Record<string, Spot>;

export function isNight(hour: number): boolean {
  return hour >= 21 || hour < 6;
}

/** Small seeded PRNG (mulberry32) so behaviour is reproducible in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE: Record<Species, Partial<Record<Activity, number>>> = {
  dog: { wander: 3, sniff: 3, play: 2, nap: 2, sit: 2, gaze: 1 },
  cat: { nap: 4, sit: 2, gaze: 2, play: 2, wander: 1, sniff: 1 },
  rabbit: { wander: 3, sniff: 3, nap: 2, sit: 1, play: 1 },
  bird: { wander: 3, sit: 2, gaze: 2, play: 1, nap: 1 },
  other: { wander: 2, sniff: 2, nap: 2, sit: 2, play: 1 },
};

const TRAIT_BOOST: [RegExp, Partial<Record<Activity, number>>][] = [
  [/\b(lazy|calm|gentle|sleepy|chill|mellow|old|cuddly|quiet|sweet)\b/i, { nap: 2, sit: 1 }],
  [/\b(playful|goofy|energetic|silly|crazy|hyper|zoom\w*|puppy|kitten|bouncy|fetch)\b/i, { play: 3, wander: 1 }],
  [/\b(curious|nosy|explorer|adventur\w*|sniff\w*|smart)\b/i, { sniff: 2, wander: 1 }],
  [/\b(dreamy|thoughtful|wise|watchful|loyal)\b/i, { gaze: 2, sit: 1 }],
];

export function activityWeights(species: Species, traits: readonly string[]): Record<Activity, number> {
  const w: Record<Activity, number> = { sit: 0, wander: 0, nap: 0, sniff: 0, play: 0, gaze: 0, sleep: 0, ...BASE[species] };
  const text = traits.join(" ");
  for (const [re, boost] of TRAIT_BOOST) {
    if (!re.test(text)) continue;
    for (const [k, v] of Object.entries(boost) as [Activity, number][]) w[k] += v;
  }
  return w;
}

export interface LifeContext {
  name: string;
  species: Species;
  traits: readonly string[];
  /** Local hour 0–23. */
  hour: number;
  seed: number;
  flowers: readonly PlacedFlower[];
  toy?: string;
}

export interface Moment {
  activity: Activity;
  pose: Pose;
  at: Spot;
  /** How long to stay in this moment before choosing the next one. */
  seconds: number;
  caption: string;
}

const VERB: Record<Species, { move: string; sniff: string }> = {
  dog: { move: "trots", sniff: "is sniffing" },
  cat: { move: "pads", sniff: "is sniffing" },
  rabbit: { move: "hops", sniff: "is nibbling clover near" },
  bird: { move: "hops", sniff: "is pecking around" },
  other: { move: "scampers", sniff: "is exploring" },
};

/** What the pet does next, on its own. */
export function nextMoment(c: LifeContext): Moment {
  const r = rng(c.seed);
  if (isNight(c.hour)) {
    return {
      activity: "sleep",
      pose: "sleep",
      at: LANDMARKS.tree,
      seconds: 40,
      caption: `${c.name} is fast asleep under the stars, curled up by the memory tree.`,
    };
  }
  const w = activityWeights(c.species, c.traits);
  if (!c.toy) w.play = Math.min(w.play, 1);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let pick = r() * total;
  let activity: Activity = "sit";
  for (const [k, v] of Object.entries(w) as [Activity, number][]) {
    if ((pick -= v) < 0) {
      activity = k;
      break;
    }
  }
  const anywhere = (): Spot => ({ x: 0.12 + r() * 0.76, depth: 0.1 + r() * 0.6 });
  const v = VERB[c.species];
  switch (activity) {
    case "nap":
      return { activity, pose: "sleep", at: LANDMARKS.tree, seconds: 14, caption: `${c.name} is napping in the shade of the memory tree.` };
    case "play":
      return {
        activity,
        pose: "happy",
        at: LANDMARKS.toy,
        seconds: 7,
        caption: c.species === "cat" ? `${c.name} is batting the ${c.toy} around the grass.` : `${c.name} is playing with the ${c.toy}.`,
      };
    case "sniff": {
      const f = c.flowers.length ? c.flowers[Math.floor(r() * c.flowers.length)] : undefined;
      return f
        ? { activity, pose: "sit", at: { x: f.x, depth: Math.max(0, f.depth - 0.08) }, seconds: 7, caption: `${c.name} ${v.sniff} the ${f.flower}s you planted.` }
        : { activity, pose: "sit", at: anywhere(), seconds: 7, caption: `${c.name} ${v.sniff} the meadow.` };
    }
    case "gaze":
      return { activity, pose: "sit", at: LANDMARKS.view, seconds: 9, caption: `${c.name} sits quietly, watching the rainbow.` };
    case "wander":
      return { activity, pose: "walk", at: anywhere(), seconds: 6, caption: `${c.name} ${v.move} happily across the meadow.` };
    default:
      return { activity: "sit", pose: "sit", at: anywhere(), seconds: 8, caption: `${c.name} is sitting in the warm sun.` };
  }
}

export interface Reaction {
  pose: Pose;
  /** Where the pet goes to respond. */
  at: Spot;
  seconds: number;
  caption: string;
  /** Recording tags to try, in order. */
  sounds: SoundTag[];
  /** Video clip actions to try, in order. */
  clips: ClipAction[];
  /** Small floating hearts in the scene. */
  hearts: boolean;
}

type ReactionText = Partial<Record<Species, string>> & { default: string };

const REACTION_CLIPS: Record<Interaction, ClipAction[]> = {
  pet: ["play", "sit"],
  call: ["bark", "play"],
  play: ["play", "bark"],
  treat: ["eat", "sit"],
};

const REACTIONS: Record<Interaction, { text: ReactionText; sounds: Partial<Record<Species, SoundTag[]>> & { default: SoundTag[] }; pose: Pose; at: (c: ReactContext) => Spot }> = {
  pet: {
    text: {
      dog: "{name} leans into your hand, tail going a mile a minute.",
      cat: "{name} starts to purr and kneads the grass.",
      rabbit: "{name} flops over on its side, perfectly content.",
      bird: "{name} fluffs up its feathers and leans in.",
      default: "{name} snuggles into your hand.",
    },
    sounds: { dog: ["happy", "whine", "bark"], cat: ["purr", "meow"], bird: ["chirp"], default: ["happy", "other"] },
    pose: "happy",
    at: (c) => c.here,
  },
  call: {
    text: {
      dog: "{name} hears your voice and comes running!",
      cat: "{name} looks up, blinks slowly, and wanders over to you.",
      rabbit: "{name} perks up its ears and hops over.",
      bird: "{name} flutters over and lands right in front of you.",
      default: "{name} hurries over to see you.",
    },
    sounds: { dog: ["bark", "happy"], cat: ["meow"], bird: ["chirp"], default: ["happy", "squeak", "other"] },
    pose: "happy",
    at: () => LANDMARKS.owner,
  },
  play: {
    text: {
      dog: "{name} chases the {toy} and brings it right back to you.",
      cat: "{name} pounces on the {toy}!",
      rabbit: "{name} does a happy little binky around the {toy}.",
      bird: "{name} hops around the {toy}, very pleased.",
      default: "{name} plays with the {toy}.",
    },
    sounds: { dog: ["bark", "happy"], cat: ["meow"], bird: ["chirp"], default: ["happy", "squeak", "other"] },
    pose: "happy",
    at: () => LANDMARKS.toy,
  },
  treat: {
    text: { default: "{name} happily munches the {treat}." },
    sounds: { dog: ["happy", "bark"], cat: ["purr", "meow"], bird: ["chirp"], default: ["happy", "other"] },
    pose: "eat",
    at: () => LANDMARKS.bowl,
  },
};

export interface ReactContext {
  name: string;
  species: Species;
  here: Spot;
  toy?: string;
  treat?: string;
}

export function react(i: Interaction, c: ReactContext): Reaction {
  const r = REACTIONS[i];
  const text = (r.text[c.species] ?? r.text.default)
    .replace("{name}", c.name)
    .replace("{toy}", c.toy ?? "ball")
    .replace("{treat}", c.treat ?? "treat");
  return {
    pose: r.pose,
    at: r.at(c),
    seconds: 5,
    caption: text,
    sounds: r.sounds[c.species] ?? r.sounds.default,
    clips: REACTION_CLIPS[i],
    hearts: i === "pet" || i === "call",
  };
}

const POSE_CLIPS: Record<Pose, ClipAction[]> = {
  sit: ["sit"],
  walk: ["walk"],
  sleep: ["sleep"],
  happy: ["play", "bark"],
  eat: ["eat"],
};

/** Clip actions to try for a pose, in order. */
export function clipActionsFor(pose: Pose): ClipAction[] {
  return POSE_CLIPS[pose];
}

const CLIP_CAPTION: Record<ClipAction, { day: string; night?: string }> = {
  sit: { day: "{name} sits in the warm sun, watching you.", night: "{name} sits with you under the stars." },
  walk: { day: "{name} trots across the meadow." },
  play: { day: "{name} is in a playful mood." },
  bark: { day: "{name} barks hello!" },
  sleep: { day: "{name} is fast asleep in the grass.", night: "{name} is fast asleep under the stars." },
  eat: { day: "{name} is munching away happily." },
};

/**
 * What the family can see the real pet doing. When there's no footage of what
 * the pet "would" be doing (asleep, but no sleeping clip), the caption has to
 * describe the clip that is showing, not the moment that was planned.
 */
export function clipCaption(name: string, action: ClipAction, night: boolean): string {
  const c = CLIP_CAPTION[action];
  return ((night && c.night) || c.day).replace("{name}", name);
}

/**
 * Choose one of the family's video clips: the first preferred action that has
 * clips, then a sitting clip (calm enough to stand in for anything), then any
 * clip that isn't walking, so the pet always looks like itself once there is
 * footage. A walking clip only stands in when there's nothing else, since
 * walking on the spot is the one thing a real pet never does.
 */
export function pickVideoClip(clips: readonly VideoClip[], prefer: readonly ClipAction[], seed: number): VideoClip | undefined {
  if (!clips.length) return undefined;
  const r = rng(seed);
  const pick = (list: readonly VideoClip[]) => list[Math.floor(r() * list.length)];
  for (const action of [...prefer, "sit" as const]) {
    const matching = clips.filter((c) => c.action === action);
    if (matching.length) return pick(matching);
  }
  const still = clips.filter((c) => c.action !== "walk");
  return pick(still.length ? still : clips);
}

/**
 * Choose one of the family's recordings for a reaction: the first preferred
 * tag that has clips, otherwise any clip at all (it's still their voice).
 */
export function pickSound(clips: readonly SoundClip[], prefer: readonly SoundTag[], seed: number): SoundClip | undefined {
  if (!clips.length) return undefined;
  const r = rng(seed);
  for (const tag of prefer) {
    const matching = clips.filter((c) => c.tag === tag);
    if (matching.length) return matching[Math.floor(r() * matching.length)];
  }
  return clips[Math.floor(r() * clips.length)];
}

// ---------- colours from a photo ----------

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Likely background: saturated grass green or sky blue. */
function looksLikeBackground(r: number, g: number, b: number): boolean {
  const s = saturation(r, g, b);
  return s > 0.35 && ((g > r * 1.15 && g > b * 1.05) || (b > r * 1.25 && b > g * 1.02));
}

/**
 * Coat and marking colours for the storybook pet, from a photo of it.
 * Looks at the middle of the frame (where the pet usually is), skips
 * grass/sky-like pixels, and takes the two most common distinct colours.
 */
export function coatColorsFromImage(img: RgbaImage): { coat: string; accent: string } | undefined {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const x0 = Math.floor(img.width * 0.2), x1 = Math.ceil(img.width * 0.8);
  const y0 = Math.floor(img.height * 0.2), y1 = Math.ceil(img.height * 0.85);
  const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 96));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!, a = img.data[i + 3]!;
      if (a < 128 || looksLikeBackground(r, g, b)) continue;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
      bins.set(key, e);
    }
  }
  const ranked = [...bins.values()].sort((a, b) => b.n - a.n).map((e) => [e.r / e.n, e.g / e.n, e.b / e.n] as const);
  const coat = ranked[0];
  if (!coat) return undefined;
  const dist = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
  const accent = ranked.find((c) => dist(c, coat) > 70) ?? coat.map((v) => v * 0.75);
  return { coat: toHex(coat[0], coat[1], coat[2]), accent: toHex(accent[0]!, accent[1]!, accent[2]!) };
}
