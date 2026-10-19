import type { ReactNode } from "react";
import {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  FeColorMatrix,
  Filter,
  G,
  Image as SvgImage,

  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import type { FlowerKind, GardenState, PlacedFlower } from "@sinian/core";
import { LANDMARKS } from "@sinian/core";

/**
 * The garden as a real place, for the real pet: a photograph of a meadow, with
 * the family's things in it cut out of real photos too (see
 * assets/garden/CREDITS.md). Everything stands on the meadow at its real size
 * for how far away it is, so it looks like part of the photograph. Drawn in the
 * same 400×300 scene units as the storybook garden.
 */

const W = 400;
const H = 300;
/** Where the meadow meets the trees in the photo: the eye-level horizon. */
export const HORIZON = (640 / 1080) * H;
/** The treeline cut-out (sky made transparent), so the rainbow and stars can sit behind the trees. */
const TREELINE = { y: (368 / 1080) * H, h: ((670 - 368) / 1080) * H };
/** Camera height in metres. Things on the ground are this many metres tall at the horizon line… */
const CAMERA_M = 0.75;

/** Scene units per metre for something standing at scene height y. */
export function unitsPerMetre(y: number): number {
  return Math.max(0, y - HORIZON) / CAMERA_M;
}

/** Scene height of the ground at a meadow depth (0 far → 1 near), matching footOf(). */
export function groundY(depth: number): number {
  return 205 + depth * 72;
}

/** How tall a dog of average size is at a spot. */
export const DOG_METRES = 0.6;

const ASSET = {
  day: require("../../assets/garden/meadow-day.jpg"),
  night: require("../../assets/garden/meadow-night.jpg"),
  treelineDay: require("../../assets/garden/treeline-day.png"),
  treelineNight: require("../../assets/garden/treeline-night.png"),
  tree: require("../../assets/garden/tree.png"),
  mailbox: require("../../assets/garden/mailbox.png"),
  bowl: require("../../assets/garden/bowl.png"),
  ball: require("../../assets/garden/ball.png"),
  candle: require("../../assets/garden/candle.png"),
  daisy: require("../../assets/garden/daisy.png"),
  tulip: require("../../assets/garden/tulip.png"),
  sunflower: require("../../assets/garden/sunflower.png"),
  "forget-me-not": require("../../assets/garden/forgetmenot.png"),
  lavender: require("../../assets/garden/lavender.png"),
};

/** Pixel sizes of the cut-outs, for their proportions. */
const SIZE = {
  tree: [331, 512],
  mailbox: [489, 398],
  bowl: [512, 430],
  ball: [256, 246],
  candle: [336, 512],
  daisy: [406, 403],
  tulip: [337, 512],
  sunflower: [512, 402],
  "forget-me-not": [383, 512],
  lavender: [135, 512],
} as const;

/** Real heights in metres, before a flower's own yearly growth. */
const FLOWER_METRES: Record<FlowerKind, number> = { daisy: 0.16, tulip: 0.38, sunflower: 0.55, "forget-me-not": 0.24, lavender: 0.42 };

/** Flowers at least this near stand in front of the pet. */
export const NEAR = 0.55;

/**
 * Moonlight, matching the night photo: mostly desaturated, then dark and blue.
 * Applied to every cut-out at night so nothing glows in daylight colours.
 */
const MOONLIGHT = (() => {
  const tint = [0.3, 0.38, 0.62], lum = [0.3, 0.59, 0.11];
  const rows = tint.map((t, c) => [0, 1, 2].map((i) => t * ((i === c ? 0.35 : 0) + 0.65 * lum[i]!)));
  return rows.map((r) => [...r, 0, 0].join(" ")).join("  ") + "  0 0 0 1 0";
})();

const STARS = Array.from({ length: 40 }, (_, i) => ({ x: (i * 97) % W, y: (i * 53) % 96, r: i % 3 ? 0.7 : 1.3 }));
/** Outer (red) to inner (violet), in thin bands so the colours blend like light, not paint. */
const RAINBOW = Array.from({ length: 22 }, (_, i) => {
  const f = i / 21;
  const fade = Math.sin(Math.PI * f) ** 0.6; // soft at both edges
  return { r: 158 - i * 0.75, colour: `hsl(${Math.round(f * 270)}, 85%, 62%)`, opacity: 0.2 * fade };
});

/** Something standing on the ground: (x, depth) is where its base touches the meadow. */
function Standing({ x, depth, metres, size, href, shadow = 0.6, night }: { x: number; depth: number; metres: number; size: readonly [number, number]; href: number; shadow?: number; night: boolean }) {
  const y = groundY(depth);
  const h = metres * unitsPerMetre(y);
  const w = (h * size[0]) / size[1];
  return (
    <G>
      {shadow > 0 && <Ellipse cx={x} cy={y} rx={w * 0.5 * shadow} ry={Math.max(0.6, h * 0.05)} fill="url(#contact)" />}
      <SvgImage href={href} x={x - w / 2} y={y - h} width={w} height={h} preserveAspectRatio="none" filter={night ? "url(#moonlight)" : undefined} />
    </G>
  );
}

function Flower({ f, night }: { f: PlacedFlower; night: boolean }) {
  const metres = FLOWER_METRES[f.flower] * f.scale;
  const x = f.x * W;
  if (f.flower === "lavender") {
    // A little clump of stems rather than one.
    return (
      <G>
        {[-0.6, 0, 0.55].map((dx, i) => (
          <Standing key={i} x={x + dx * 3} depth={f.depth - i * 0.004} metres={metres * (1 - Math.abs(dx) * 0.15)} size={SIZE.lavender} href={ASSET.lavender} shadow={0} night={night} />
        ))}
      </G>
    );
  }
  return <Standing x={x} depth={f.depth} metres={metres} size={SIZE[f.flower]} href={ASSET[f.flower]} shadow={0.35} night={night} />;
}

function Candle({ x, depth, night }: { x: number; depth: number; night: boolean }) {
  const y = groundY(depth);
  const h = 0.1 * unitsPerMetre(y);
  const w = (h * SIZE.candle[0]) / SIZE.candle[1];
  const flameY = y - h * 0.93;
  return (
    <G>
      <Standing x={x} depth={depth} metres={0.1} size={SIZE.candle} href={ASSET.candle} shadow={0.5} night={night} />
      {/* The flame lights the night; it isn't dimmed with everything else. */}
      <Circle cx={x} cy={flameY} r={w * (night ? 3.2 : 1.6)} fill="url(#candleGlow)" opacity={night ? 0.9 : 0.35} />
      {night && <Ellipse cx={x} cy={flameY + h * 0.02} rx={w * 0.09} ry={h * 0.13} fill="#ffe9b0" />}
    </G>
  );
}

function Defs_({ night }: { night: boolean }) {
  return (
    <Defs>
      <RadialGradient id="contact" cx="0.5" cy="0.5" r="0.5">
        <Stop offset="0" stopColor="#1d2a14" stopOpacity={night ? 0.45 : 0.35} />
        <Stop offset="1" stopColor="#1d2a14" stopOpacity={0} />
      </RadialGradient>
      <RadialGradient id="candleGlow" cx="0.5" cy="0.5" r="0.5">
        <Stop offset="0" stopColor="#ffd78a" stopOpacity={0.85} />
        <Stop offset="0.4" stopColor="#ffb648" stopOpacity={0.25} />
        <Stop offset="1" stopColor="#ffb648" stopOpacity={0} />
      </RadialGradient>
      <RadialGradient id="moonGlow" cx="0.5" cy="0.5" r="0.5">
        <Stop offset="0" stopColor="#fdf6d8" stopOpacity={0.45} />
        <Stop offset="1" stopColor="#fdf6d8" stopOpacity={0} />
      </RadialGradient>
      <ClipPath id="aboveGround">
        <Rect x={0} y={0} width={W} height={HORIZON + 1} />
      </ClipPath>
      <Filter id="moonlight">
        <FeColorMatrix type="matrix" values={MOONLIGHT} />
      </Filter>
    </Defs>
  );
}

/** The photograph, sky, treeline and everything that stands behind the pet. */
export function PhotoBackdrop({ garden, night, toy }: { garden: GardenState; night: boolean; toy: boolean }) {
  const back: { y: number; node: ReactNode }[] = [];
  const add = (depth: number, node: ReactNode) => back.push({ y: groundY(depth), node });

  const tree = LANDMARKS.tree;
  add(tree.depth, <Standing key="tree" x={tree.x * W} depth={tree.depth} metres={Math.min(6, 1.2 + garden.treeRings * 0.9)} size={SIZE.tree} href={ASSET.tree} shadow={0.7} night={night} />);
  add(0.3, <Mailbox key="mailbox" letters={garden.letters} night={night} />);
  if (garden.treats.length) add(LANDMARKS.bowl.depth, <Standing key="bowl" x={LANDMARKS.bowl.x * W} depth={LANDMARKS.bowl.depth} metres={0.09} size={SIZE.bowl} href={ASSET.bowl} night={night} />);
  if (toy) add(LANDMARKS.toy.depth, <Standing key="ball" x={LANDMARKS.toy.x * W} depth={LANDMARKS.toy.depth} metres={0.1} size={SIZE.ball} href={ASSET.ball} night={night} />);
  for (const f of garden.flowers.filter((f) => f.depth < NEAR)) add(f.depth, <Flower key={f.id} f={f} night={night} />);
  for (let i = 0; i < Math.min(garden.candlesLit, 5); i++) {
    const depth = 0.5 - (i % 2) * 0.06;
    add(depth, <Candle key={`c${i}`} x={292 + i * 14} depth={depth} night={night} />);
  }

  return (
    <G>
      <Defs_ night={night} />
      <SvgImage href={night ? ASSET.night : ASSET.day} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />
      {night ? (
        <G>
          {STARS.map((s, i) => (
            <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={0.8} />
          ))}
          <Circle cx={330} cy={52} r={44} fill="url(#moonGlow)" />
          <Circle cx={330} cy={52} r={11} fill="#fbf3d3" />
        </G>
      ) : (
        <G clipPath="url(#aboveGround)">
          {RAINBOW.map((b, i) => (
            <Path key={i} d={`M ${310 - b.r} ${HORIZON + 4} A ${b.r} ${b.r * 0.86} 0 0 1 ${310 + b.r} ${HORIZON + 4}`} stroke={b.colour} strokeOpacity={b.opacity} strokeWidth={1.1} fill="none" />
          ))}
        </G>
      )}
      <SvgImage href={night ? ASSET.treelineNight : ASSET.treelineDay} x={0} y={TREELINE.y} width={W} height={TREELINE.h} preserveAspectRatio="none" />
      {back.sort((a, b) => a.y - b.y).map((b) => b.node)}
    </G>
  );
}

/** Flowers near enough to stand in front of the pet. */
export function PhotoFront({ garden, night }: { garden: GardenState; night: boolean }) {
  return (
    <G>
      <Defs_ night={night} />
      {garden.flowers
        .filter((f) => f.depth >= NEAR)
        .sort((a, b) => a.depth - b.depth)
        .map((f) => (
          <Flower key={f.id} f={f} night={night} />
        ))}
    </G>
  );
}

function Mailbox({ letters, night }: { letters: number; night: boolean }) {
  const x = 352, depth = 0.3;
  const y = groundY(depth);
  const u = unitsPerMetre(y);
  const post = { w: 0.09 * u, h: 0.95 * u };
  const box = { w: 0.5 * u, h: (0.5 * u * SIZE.mailbox[1]) / SIZE.mailbox[0] };
  return (
    <G>
      <Ellipse cx={x} cy={y} rx={post.w * 2.2} ry={Math.max(0.6, post.h * 0.03)} fill="url(#contact)" />
      <Rect x={x - post.w / 2} y={y - post.h} width={post.w} height={post.h} fill={night ? "#2b2a33" : "#6b5137"} />
      <Rect x={x - post.w / 2} y={y - post.h} width={post.w * 0.35} height={post.h} fill="#fff" opacity={night ? 0.04 : 0.12} />
      <SvgImage href={ASSET.mailbox} x={x - box.w * 0.42} y={y - post.h - box.h * 0.82} width={box.w} height={box.h} preserveAspectRatio="none" filter={night ? "url(#moonlight)" : undefined} />
      {letters > 0 && (
        <G>
          <Circle cx={x + box.w * 0.5} cy={y - post.h - box.h * 0.8} r={5.5} fill="#c0453a" />
          <SvgText x={x + box.w * 0.5} y={y - post.h - box.h * 0.8 + 3} fontSize={7.5} fontWeight="bold" fill="#fff" textAnchor="middle">
            {letters}
          </SvgText>
        </G>
      )}
    </G>
  );
}
