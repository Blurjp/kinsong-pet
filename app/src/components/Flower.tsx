import { Circle, Ellipse, G, Line, Path } from "react-native-svg";
import type { FlowerKind } from "@sinian/core";

/** One flower with its stem base at (x, y); `h` is the stem height. */
export function Flower({ kind, x, y, h }: { kind: FlowerKind; x: number; y: number; h: number }) {
  const top = y - h;
  const r = h * 0.28;
  const stem = <Line x1={x} y1={y} x2={x} y2={top} stroke="#5b9a4a" strokeWidth={Math.max(1, h * 0.06)} />;
  const leaf = <Ellipse cx={x + r * 0.6} cy={y - h * 0.4} rx={r * 0.6} ry={r * 0.25} fill="#6fb35a" transform={`rotate(-30 ${x + r * 0.6} ${y - h * 0.4})`} />;
  switch (kind) {
    case "daisy":
      return (
        <G>
          {stem}
          {leaf}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <Ellipse key={a} cx={x} cy={top - r * 0.55} rx={r * 0.28} ry={r * 0.6} fill="#fffdf7" transform={`rotate(${a} ${x} ${top})`} />
          ))}
          <Circle cx={x} cy={top} r={r * 0.38} fill="#f6c343" />
        </G>
      );
    case "tulip":
      return (
        <G>
          {stem}
          {leaf}
          <Path d={`M${x - r * 0.8} ${top - r * 0.3} Q${x - r * 0.9} ${top + r * 0.9} ${x} ${top + r * 0.9} Q${x + r * 0.9} ${top + r * 0.9} ${x + r * 0.8} ${top - r * 0.3} L${x + r * 0.4} ${top} L${x} ${top - r * 0.6} L${x - r * 0.4} ${top} Z`} fill="#e8656f" />
        </G>
      );
    case "sunflower":
      return (
        <G>
          {stem}
          {leaf}
          {Array.from({ length: 12 }, (_, i) => i * 30).map((a) => (
            <Ellipse key={a} cx={x} cy={top - r * 0.75} rx={r * 0.25} ry={r * 0.55} fill="#f7c02b" transform={`rotate(${a} ${x} ${top})`} />
          ))}
          <Circle cx={x} cy={top} r={r * 0.5} fill="#7a4a24" />
        </G>
      );
    case "forget-me-not":
      return (
        <G>
          {stem}
          {[
            [-0.5, 0],
            [0.45, -0.3],
            [0, -0.75],
          ].map(([dx, dy], i) => (
            <G key={i}>
              {[0, 72, 144, 216, 288].map((a) => (
                <Circle key={a} cx={x + dx! * r} cy={top + dy! * r - r * 0.28} r={r * 0.22} fill="#7fb2ee" transform={`rotate(${a} ${x + dx! * r} ${top + dy! * r})`} />
              ))}
              <Circle cx={x + dx! * r} cy={top + dy! * r} r={r * 0.12} fill="#f8e27a" />
            </G>
          ))}
        </G>
      );
    case "lavender":
      return (
        <G>
          {stem}
          {Array.from({ length: 6 }, (_, i) => (
            <Ellipse key={i} cx={x + (i % 2 ? r * 0.18 : -r * 0.18)} cy={top + i * r * 0.32} rx={r * 0.2} ry={r * 0.26} fill="#a58bd6" />
          ))}
        </G>
      );
  }
}
