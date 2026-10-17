import { Text, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Polygon, Rect } from "react-native-svg";
import type { PetProfile, Postcard as PostcardData, Scene } from "@sinian/core";
import { PetSprite } from "./PetSprite";
import { colors } from "../ui";

const W = 300;
const H = 190;

/** An imagined postcard for a wish. The "imagined" label is part of the card and can't be hidden. */
export function Postcard({ pet, card }: { pet: PetProfile; card: PostcardData }) {
  return (
    <View style={{ backgroundColor: "#fffdf8", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: "#eadfcd" }}>
      <View style={{ borderRadius: 8, overflow: "hidden", aspectRatio: W / H }}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
          <Backdrop scene={card.scene} />
          <PetSprite species={pet.species} coat={pet.coat} accent={pet.accent} x={card.scene === "sky" ? 150 : 140} y={card.scene === "sky" ? 98 : 128} size={78} />
        </Svg>
      </View>
      <Text style={{ fontSize: 16, color: colors.ink, marginTop: 8, fontStyle: "italic" }}>{card.caption}</Text>
      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>✦ {card.label}</Text>
    </View>
  );
}

function Backdrop({ scene }: { scene: Scene }) {
  switch (scene) {
    case "beach":
      return (
        <G>
          <Rect width={W} height={H} fill="#bfe6f7" />
          <Circle cx={250} cy={40} r={20} fill="#ffe08a" />
          <Rect y={95} width={W} height={45} fill="#6fbfe0" />
          <Path d={`M0 112 Q40 104 80 112 T160 112 T240 112 T320 112`} stroke="#fff" strokeWidth={2} fill="none" opacity={0.7} />
          <Path d={`M0 140 Q150 120 ${W} 138 V${H} H0 Z`} fill="#f3dca6" />
          {[
            [70, 50],
            [100, 38],
            [210, 70],
          ].map(([x, y], i) => (
            <Path key={i} d={`M${x! - 8} ${y} q4 -5 8 0 q4 -5 8 0`} stroke="#5a6a7a" strokeWidth={1.6} fill="none" />
          ))}
        </G>
      );
    case "snow":
      return (
        <G>
          <Rect width={W} height={H} fill="#dbe9f5" />
          <Polygon points="20,140 90,50 160,140" fill="#c4d6e8" />
          <Polygon points="120,140 200,40 280,140" fill="#b6cbe0" />
          <Polygon points="180,72 200,40 220,72 210,66 200,74 190,66" fill="#fff" />
          <Path d={`M0 140 Q150 125 ${W} 140 V${H} H0 Z`} fill="#fbfdff" />
          {Array.from({ length: 24 }, (_, i) => (
            <Circle key={i} cx={(i * 53) % W} cy={(i * 37) % 130} r={1.6} fill="#fff" />
          ))}
        </G>
      );
    case "forest":
      return (
        <G>
          <Rect width={W} height={H} fill="#d9eed6" />
          {[30, 80, 210, 260, 290].map((x, i) => (
            <G key={x}>
              <Rect x={x - 3} y={110 - (i % 2) * 10} width={6} height={40} fill="#7a5a3a" />
              <Polygon points={`${x - 22},${120 - (i % 2) * 10} ${x},${50 - (i % 2) * 14} ${x + 22},${120 - (i % 2) * 10}`} fill={i % 2 ? "#4f9a5a" : "#5fae68"} />
            </G>
          ))}
          <Path d={`M0 145 Q150 130 ${W} 145 V${H} H0 Z`} fill="#9cce80" />
          <Path d="M120 190 Q140 160 150 145" stroke="#d8c08f" strokeWidth={14} fill="none" opacity={0.7} />
        </G>
      );
    case "lake":
      return (
        <G>
          <Rect width={W} height={H} fill="#cfe8f5" />
          <Path d={`M0 100 Q80 70 160 95 T${W} 90 V120 H0 Z`} fill="#9fcf8f" />
          <Ellipse cx={150} cy={150} rx={170} ry={36} fill="#7cbbe0" />
          <Ellipse cx={230} cy={150} rx={10} ry={5} fill="#f4f0e6" />
          <Circle cx={238} cy={145} r={4} fill="#f4f0e6" />
          <Path d={`M0 165 Q150 185 ${W} 168 V${H} H0 Z`} fill="#a8d98f" />
        </G>
      );
    case "sky":
      return (
        <G>
          <Rect width={W} height={H} fill="#b8dcf3" />
          {[
            [60, 150, 1],
            [230, 160, 1.3],
            [200, 50, 0.7],
          ].map(([x, y, s], i) => (
            <G key={i} transform={`translate(${x} ${y}) scale(${s})`}>
              <Ellipse rx={36} ry={14} fill="#fff" />
              <Circle cx={-12} cy={-8} r={14} fill="#fff" />
              <Circle cx={12} cy={-12} r={17} fill="#fff" />
            </G>
          ))}
          <Path d="M40 40 l40 10 l-36 6 z" fill="#f08a5d" />
        </G>
      );
    default:
      return (
        <G>
          <Rect width={W} height={H} fill="#cfe9f6" />
          <Circle cx={60} cy={40} r={18} fill="#ffe08a" />
          <Path d={`M0 135 Q150 115 ${W} 132 V${H} H0 Z`} fill="#a8d98f" />
          {[40, 90, 200, 250, 280].map((x, i) => (
            <Circle key={x} cx={x} cy={160 + (i % 2) * 10} r={4} fill={i % 2 ? "#f6c343" : "#fffdf7"} />
          ))}
        </G>
      );
  }
}
