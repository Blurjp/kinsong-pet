/**
 * Memorial garden for a pet who has crossed the Rainbow Bridge.
 *
 * Product rules this module encodes (see docs/MEMORIAL_GARDEN.md):
 *  - Every gesture is free. There is nothing to buy, no rarity, and no
 *    "more gifts make them happier".
 *  - No streaks and no "you missed a day". The app only reaches out on the
 *    pet's own remembrance days.
 *  - Anything the app imagines (a postcard, a note "from" the pet) is
 *    labelled as imagined.
 *  - The garden only grows: each visit leaves something that stays, and the
 *    memory tree gains a ring for every year the family comes back.
 *
 * Dates are calendar days ("YYYY-MM-DD") in the owner's local time.
 */

export type Species = "dog" | "cat" | "rabbit" | "bird" | "other";

export interface PetProfile {
  name: string;
  species: Species;
  /** Main coat colour, used to tint the illustrated pet. */
  coat: string;
  /** Optional second colour (ears, patches). */
  accent?: string;
  born?: string;
  /** "Gotcha day": the day they came home. */
  adopted?: string;
  passed: string;
  favorites: { toys: string[]; treats: string[]; spots: string[] };
  /** A few words: "goofy", "gentle", "always hungry". */
  traits: string[];
  wishes: Wish[];
}

export interface Wish {
  id: string;
  /** Written as an action: "chase the seagulls at the beach". */
  text: string;
  /** Set when the family did it for them in real life. */
  doneInRealLife?: { on: string; note?: string };
}

export type FlowerKind = "daisy" | "tulip" | "sunflower" | "forget-me-not" | "lavender";
export const FLOWER_KINDS: readonly FlowerKind[] = ["daisy", "tulip", "sunflower", "forget-me-not", "lavender"];

export type Visit =
  | { id: string; on: string; kind: "candle"; by?: string }
  | { id: string; on: string; kind: "flower"; flower: FlowerKind; by?: string }
  | { id: string; on: string; kind: "treat"; treat: string; by?: string }
  | { id: string; on: string; kind: "letter"; text: string; by?: string };

// ---------- calendar helpers (date-only, timezone-free) ----------

const DAY_MS = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY_MS);
}

/** The same month/day in `year`; Feb 29 falls on Feb 28 in common years. */
function onYear(day: string, year: number): string {
  const [, m, d] = day.split("-").map(Number);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dd = m === 2 && d === 29 && !leap ? 28 : d!;
  return `${year}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** n-th weekday (0 = Sunday) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return fromUtc(Date.UTC(year, month - 1, day));
}

// ---------- remembrance days ----------

export type OccasionKind =
  | "birthday"
  | "gotcha-day"
  | "anniversary"
  | "national-pet-day"
  | "rainbow-bridge-day"
  | "pet-memorial-day";

export interface Occasion {
  kind: OccasionKind;
  on: string;
  /** Years since birth / adoption / passing, where that applies. */
  years?: number;
}

/**
 * Community observances. Dates as commonly observed in the US; check before
 * each release: National Pet Day (Apr 11), Rainbow Bridge Remembrance Day
 * (Aug 28), National Pet Memorial Day (second Sunday of September).
 */
function communityDays(year: number): Occasion[] {
  return [
    { kind: "national-pet-day", on: `${year}-04-11` },
    { kind: "rainbow-bridge-day", on: `${year}-08-28` },
    { kind: "pet-memorial-day", on: nthWeekday(year, 9, 0, 2) },
  ];
}

function personalDays(pet: PetProfile, year: number): Occasion[] {
  const out: Occasion[] = [];
  const add = (kind: OccasionKind, base: string | undefined, minYears: number) => {
    if (!base) return;
    const years = year - Number(base.slice(0, 4));
    if (years >= minYears) out.push({ kind, on: onYear(base, year), years });
  };
  add("birthday", pet.born, 1);
  add("gotcha-day", pet.adopted, 1);
  // The day itself is not a "remembrance day"; the first anniversary is.
  add("anniversary", pet.passed, 1);
  return out;
}

/** Remembrance days from `today` (inclusive) through the next `horizonDays`. */
export function upcomingOccasions(pet: PetProfile, today: string, horizonDays = 365): Occasion[] {
  const y = Number(today.slice(0, 4));
  const end = addDays(today, horizonDays);
  const all: Occasion[] = [];
  for (const year of [y, y + 1]) all.push(...personalDays(pet, year), ...communityDays(year));
  return all
    .filter((o) => o.on >= today && o.on <= end && o.on > pet.passed)
    .sort((a, b) => a.on.localeCompare(b.on) || a.kind.localeCompare(b.kind));
}

export function occasionsOn(pet: PetProfile, day: string): Occasion[] {
  return upcomingOccasions(pet, day, 0);
}

// ---------- the garden ----------

/** Small deterministic hash so a visit always lands in the same spot. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // FNV alone leaves ids like "v1"/"v2" in nearly the same spot; finish with
  // murmur3's avalanche step so neighbouring ids scatter across the meadow.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export interface PlacedFlower {
  id: string;
  flower: FlowerKind;
  /** 0..1 across the meadow. */
  x: number;
  /** 0..1 down the meadow band (0 = far, 1 = near). */
  depth: number;
  /** Grows a little each year it has been in the garden. */
  scale: number;
  by?: string;
}

export interface GardenState {
  flowers: PlacedFlower[];
  /** Candles lit today. */
  candlesLit: number;
  /** Treats left in the last week, most recent first. */
  treats: string[];
  letters: number;
  /** One ring per calendar year with at least one visit; capped for drawing. */
  treeRings: number;
  /** Days since they crossed the bridge. */
  daysSince: number;
}

export function gardenState(pet: PetProfile, visits: readonly Visit[], today: string): GardenState {
  const past = visits.filter((v) => v.on <= today);
  const flowers = past
    .filter((v): v is Extract<Visit, { kind: "flower" }> => v.kind === "flower")
    .map((v) => {
      const years = Math.max(0, Math.floor(daysBetween(v.on, today) / 365));
      return {
        id: v.id,
        flower: v.flower,
        x: 0.06 + hash(v.id + "x") * 0.88,
        depth: hash(v.id + "d"),
        scale: 1 + 0.2 * Math.min(years, 3),
        ...(v.by ? { by: v.by } : {}),
      };
    })
    // Far flowers first so near ones draw on top.
    .sort((a, b) => a.depth - b.depth);
  const years = new Set(past.map((v) => v.on.slice(0, 4)));
  return {
    flowers,
    candlesLit: past.filter((v) => v.kind === "candle" && v.on === today).length,
    treats: past
      .filter((v): v is Extract<Visit, { kind: "treat" }> => v.kind === "treat" && daysBetween(v.on, today) < 7)
      .sort((a, b) => b.on.localeCompare(a.on))
      .map((v) => v.treat),
    letters: past.filter((v) => v.kind === "letter").length,
    treeRings: Math.min(years.size, 6),
    daysSince: Math.max(0, daysBetween(pet.passed, today)),
  };
}

// ---------- wishes and imagined postcards ----------

export type Scene = "beach" | "snow" | "forest" | "meadow" | "sky" | "lake";

const SCENE_WORDS: [Scene, RegExp][] = [
  ["beach", /\b(beach|ocean|sea|seagulls?|waves?|sand|shore|surf)\b/i],
  ["snow", /\b(snow|snowy|ski|winter|ice|sled)\b/i],
  ["lake", /\b(lake|river|pond|swim|swimming|fish(ing)?|boat|duck)/i],
  ["forest", /\b(forest|woods|trail|hike|hiking|camp(ing)?|squirrels?|trees?|mountains?)\b/i],
  ["sky", /\b(fly|flying|clouds?|sky|stars?|moon|plane|kite)\b/i],
];

export function sceneFor(wish: string): Scene {
  return SCENE_WORDS.find(([, re]) => re.test(wish))?.[0] ?? "meadow";
}

export interface Postcard {
  scene: Scene;
  caption: string;
  /** Always shown with the card. */
  label: string;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function imaginedPostcard(pet: PetProfile, wish: Wish): Postcard {
  const action = lowerFirst(wish.text.trim().replace(/[.!]+$/, ""));
  return {
    scene: sceneFor(wish.text),
    caption: `Today ${pet.name} finally got to ${action}.`,
    label: "Imagined postcard: a picture of a wish, not something that happened.",
  };
}

// ---------- gentle words ----------

const OCCASION_TITLE: Record<OccasionKind, (pet: PetProfile, o: Occasion) => string> = {
  birthday: (p, o) => `${p.name}'s birthday (${o.years} years)`,
  "gotcha-day": (p, o) => `${o.years} years since ${p.name} came home`,
  anniversary: (p, o) => `${o.years === 1 ? "One year" : `${o.years} years`} since ${p.name} crossed the bridge`,
  "national-pet-day": () => "National Pet Day",
  "rainbow-bridge-day": () => "Rainbow Bridge Remembrance Day",
  "pet-memorial-day": () => "National Pet Memorial Day",
};

export function occasionTitle(pet: PetProfile, o: Occasion): string {
  return OCCASION_TITLE[o.kind](pet, o);
}

/**
 * The only time the app reaches out. Returns nothing on ordinary days, so
 * there is no streak to keep and nothing to feel guilty about.
 */
export function gentleNudge(pet: PetProfile, today: string): string | undefined {
  const o = occasionsOn(pet, today)[0];
  if (!o) return undefined;
  return `${occasionTitle(pet, o)}. Would you like to stop by the garden?`;
}

/**
 * A short imagined note "from" the pet for a remembrance day, built only from
 * what the family wrote. Labelled by the caller as imagined.
 */
export function imaginedNote(pet: PetProfile, o: Occasion): string {
  const spot = pet.favorites.spots[0];
  const toy = pet.favorites.toys[0];
  const trait = pet.traits[0];
  const lines = [
    o.kind === "birthday" ? "It's my birthday! I hope there's cake. (There's always cake here.)" : "I felt you thinking of me today.",
    spot ? `I found a sunny spot here that's almost as good as ${spot}.` : "The meadow here is warm and the grass is soft.",
    toy ? `I still carry my ${toy} everywhere.` : undefined,
    trait ? `Still ${trait}. Some things never change.` : undefined,
    "Thank you for loving me so well. Go give someone a hug for me.",
  ];
  return `${lines.filter(Boolean).join(" ")}\n— ${pet.name}`;
}
