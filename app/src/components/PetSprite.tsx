import { Circle, Ellipse, G, Line, Path, Polygon } from "react-native-svg";
import type { Pose, Species } from "@sinian/core";

/**
 * A soft, storybook-style pet drawn from shapes, tinted with the pet's coat.
 * Deliberately not photoreal: it should feel like a keepsake illustration,
 * not a stand-in for the real animal. Drawn in a 100×100 box at (x, y) with
 * the given size; (x, y) is the centre of the box.
 */
export function PetSprite({
  species,
  coat,
  accent,
  x,
  y,
  size,
  pose = "sit",
  flip = false,
}: {
  species: Species;
  coat: string;
  accent?: string;
  x: number;
  y: number;
  size: number;
  pose?: Pose;
  /** Face left instead of right. */
  flip?: boolean;
}) {
  const s = size / 100;
  const ac = accent ?? shade(coat, -0.18);
  const eye = "#2b2320";
  const mirror = flip ? " translate(100 0) scale(-1 1)" : "";
  if (pose === "sleep") {
    return (
      <G transform={`translate(${x - size / 2} ${y - size / 2}) scale(${s})${mirror}`}>
        <Sleeping species={species} coat={coat} accent={ac} eye={eye} />
      </G>
    );
  }
  const happy = pose === "happy";
  const eating = pose === "eat";
  return (
    <G transform={`translate(${x - size / 2} ${y - size / 2}) scale(${s})${mirror}`}>
      {/* soft shadow on the grass */}
      <Ellipse cx={50} cy={94} rx={30} ry={5} fill="#000" opacity={0.12} />
      {species === "bird" ? (
        <Bird coat={coat} accent={ac} eye={eye} />
      ) : (
        <>
          {tail(species, coat, ac)}
          {/* body */}
          <Ellipse cx={50} cy={72} rx={species === "rabbit" ? 20 : 23} ry={21} fill={coat} />
          <Ellipse cx={50} cy={78} rx={13} ry={12} fill="#fff" opacity={0.28} />
          {/* front paws */}
          <Ellipse cx={41} cy={90} rx={7} ry={5} fill={coat} />
          <Ellipse cx={59} cy={90} rx={7} ry={5} fill={coat} />
          <G transform={eating ? "translate(0 9) rotate(8 50 42)" : undefined}>
          {ears(species, coat, ac)}
          {/* head */}
          <Circle cx={50} cy={42} r={species === "cat" ? 17 : 18} fill={coat} />
          {species === "dog" && <Ellipse cx={58} cy={36} rx={7} ry={6} fill={ac} opacity={0.55} />}
          {/* muzzle */}
          <Ellipse cx={50} cy={50} rx={species === "dog" ? 10 : 7.5} ry={species === "dog" ? 7.5 : 5.5} fill="#fff" opacity={0.55} />
          <Ellipse cx={50} cy={47.5} rx={species === "dog" ? 3.6 : 2.4} ry={species === "dog" ? 2.6 : 1.8} fill={species === "dog" ? eye : "#e58f9a"} />
          {happy ? (
            <>
              <Path d="M45 51.5 Q50 58 55 51.5 Z" fill="#7a3b3b" />
              {species === "dog" && <Ellipse cx={50} cy={56} rx={3} ry={3.6} fill="#ef8a95" />}
            </>
          ) : (
            <Path d="M46 52 Q50 55.5 54 52" stroke={eye} strokeWidth={1.3} fill="none" strokeLinecap="round" />
          )}
          {/* eyes, gently closed in a smile: content, at rest */}
          <Path d="M39.5 40 Q43 37 46.5 40" stroke={eye} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          <Path d="M53.5 40 Q57 37 60.5 40" stroke={eye} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          {/* blush */}
          <Ellipse cx={37} cy={47} rx={3.6} ry={2.2} fill="#f2a0a8" opacity={0.45} />
          <Ellipse cx={63} cy={47} rx={3.6} ry={2.2} fill="#f2a0a8" opacity={0.45} />
          {species === "cat" && (
            <G stroke={eye} strokeWidth={0.8} opacity={0.6}>
              <Line x1={30} y1={48} x2={41} y2={49.5} />
              <Line x1={30} y1={52} x2={41} y2={51} />
              <Line x1={59} y1={49.5} x2={70} y2={48} />
              <Line x1={59} y1={51} x2={70} y2={52} />
            </G>
          )}
          </G>
        </>
      )}
    </G>
  );
}

/** Curled up asleep, chin on paws. */
function Sleeping({ species, coat, accent, eye }: { species: Species; coat: string; accent: string; eye: string }) {
  return (
    <>
      <Ellipse cx={52} cy={93} rx={36} ry={5} fill="#000" opacity={0.12} />
      {species === "cat" || species === "dog" ? (
        <Path d="M78 84 Q92 74 80 66" stroke={species === "cat" ? coat : accent} strokeWidth={6} fill="none" strokeLinecap="round" />
      ) : null}
      <Ellipse cx={56} cy={78} rx={30} ry={16} fill={coat} />
      <Ellipse cx={58} cy={82} rx={18} ry={8} fill="#fff" opacity={0.22} />
      {species === "rabbit" ? (
        <Ellipse cx={34} cy={58} rx={5} ry={14} fill={coat} transform="rotate(-60 34 58)" />
      ) : species === "cat" ? (
        <>
          <Polygon points="20,70 22,56 32,64" fill={coat} />
          <Polygon points="40,64 44,52 50,64" fill={coat} />
        </>
      ) : species === "dog" ? (
        <Ellipse cx={24} cy={78} rx={6} ry={11} fill={accent} transform="rotate(30 24 78)" />
      ) : null}
      {species === "bird" ? (
        <Polygon points="20,78 12,80 20,82" fill="#f0b23c" />
      ) : null}
      <Circle cx={34} cy={76} r={15} fill={coat} />
      <Path d="M27 75 Q30 77.5 33 75" stroke={eye} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      <Path d="M37 75 Q40 77.5 43 75" stroke={eye} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      <Ellipse cx={35} cy={82} rx={5} ry={3.4} fill="#fff" opacity={0.5} />
      <Ellipse cx={26} cy={81} rx={2.8} ry={1.8} fill="#f2a0a8" opacity={0.45} />
      <Ellipse cx={30} cy={89} rx={8} ry={4} fill={coat} />
    </>
  );
}

function ears(species: Species, coat: string, ac: string) {
  switch (species) {
    case "dog":
      return (
        <>
          <Ellipse cx={33} cy={44} rx={7.5} ry={14} fill={ac} transform="rotate(18 33 44)" />
          <Ellipse cx={67} cy={44} rx={7.5} ry={14} fill={ac} transform="rotate(-18 67 44)" />
        </>
      );
    case "cat":
      return (
        <>
          <Polygon points="34,36 37,17 50,30" fill={coat} />
          <Polygon points="66,36 63,17 50,30" fill={coat} />
          <Polygon points="37,32 38.5,22 45,29" fill="#f2a0a8" opacity={0.7} />
          <Polygon points="63,32 61.5,22 55,29" fill="#f2a0a8" opacity={0.7} />
        </>
      );
    case "rabbit":
      return (
        <>
          <Ellipse cx={42} cy={16} rx={6} ry={17} fill={coat} transform="rotate(-8 42 16)" />
          <Ellipse cx={58} cy={16} rx={6} ry={17} fill={coat} transform="rotate(8 58 16)" />
          <Ellipse cx={42} cy={17} rx={3} ry={12} fill="#f2a0a8" opacity={0.6} transform="rotate(-8 42 17)" />
          <Ellipse cx={58} cy={17} rx={3} ry={12} fill="#f2a0a8" opacity={0.6} transform="rotate(8 58 17)" />
        </>
      );
    default:
      return (
        <>
          <Circle cx={37} cy={28} r={6.5} fill={ac} />
          <Circle cx={63} cy={28} r={6.5} fill={ac} />
        </>
      );
  }
}

function tail(species: Species, coat: string, ac: string) {
  if (species === "dog") return <Path d="M70 80 Q88 74 84 58" stroke={ac} strokeWidth={7} fill="none" strokeLinecap="round" />;
  if (species === "cat") return <Path d="M70 84 Q94 82 88 60 Q86 52 80 54" stroke={coat} strokeWidth={6} fill="none" strokeLinecap="round" />;
  if (species === "rabbit") return <Circle cx={71} cy={84} r={6} fill="#fff" />;
  return null;
}

function Bird({ coat, accent, eye }: { coat: string; accent: string; eye: string }) {
  return (
    <>
      <Path d="M68 74 L90 82 L70 84 Z" fill={accent} />
      <Ellipse cx={50} cy={66} rx={22} ry={24} fill={coat} />
      <Ellipse cx={50} cy={74} rx={13} ry={13} fill="#fff" opacity={0.3} />
      <Ellipse cx={64} cy={68} rx={9} ry={15} fill={accent} transform="rotate(-20 64 68)" />
      <Polygon points="46,52 54,52 50,59" fill="#f0b23c" />
      <Path d="M39 46 Q43 43 47 46" stroke={eye} strokeWidth={2} fill="none" strokeLinecap="round" />
      <Path d="M53 46 Q57 43 61 46" stroke={eye} strokeWidth={2} fill="none" strokeLinecap="round" />
      <Line x1={45} y1={89} x2={44} y2={95} stroke="#f0b23c" strokeWidth={2} />
      <Line x1={55} y1={89} x2={56} y2={95} stroke="#f0b23c" strokeWidth={2} />
    </>
  );
}

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(Math.max(0, Math.min(255, amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
