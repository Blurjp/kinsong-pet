import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Image as SvgImage,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import type { GardenState, PetPhoto, PetProfile, Pose, Spot } from "@sinian/core";
import { PetSprite } from "./PetSprite";
import { Flower } from "./Flower";

const W = 400;
const H = 300;
const RAINBOW = ["#f4a4a4", "#f7c58b", "#f6e08f", "#a9dba0", "#9cc9ee", "#b9a6e3"];
const STARS = Array.from({ length: 34 }, (_, i) => ({ x: (i * 97) % W, y: (i * 53) % 150, r: i % 3 ? 0.9 : 1.6 }));

/** Feet position in scene units for a meadow spot. */
export function footOf(at: Spot): { x: number; y: number } {
  return { x: at.x * W, y: 205 + at.depth * 72 };
}

export interface SceneProps {
  pet: PetProfile;
  garden: GardenState;
  at: Spot;
  pose: Pose;
  night: boolean;
  photos: readonly PetPhoto[];
  /** Changes each time hearts should float up. */
  heartsKey?: number;
  onPetPress?: () => void;
  onPhotoPress?: (photo: PetPhoto) => void;
}

/** The meadow by the Rainbow Bridge, with the pet living in it. */
export function GardenScene({ pet, garden, at, pose, night, photos, heartsKey, onPetPress, onPhotoPress }: SceneProps) {
  const [k, setK] = useState(0); // px per scene unit, known after layout

  return (
    <View
      style={{ width: "100%", aspectRatio: W / H, borderRadius: 18, overflow: "hidden" }}
      accessibilityLabel={`${pet.name}'s garden${night ? " at night" : ""}`}
      onLayout={(e) => setK(e.nativeEvent.layout.width / W)}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={night ? "#1d2b52" : "#bfe2f4"} />
            <Stop offset="0.75" stopColor={night ? "#4a4f7d" : "#fbefdc"} />
          </LinearGradient>
          <RadialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={night ? "#fdf6d8" : "#fff6c8"} stopOpacity={night ? 0.5 : 0.95} />
            <Stop offset="1" stopColor="#fff6c8" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="meadow" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={night ? "#4f7c63" : "#a8d98f"} />
            <Stop offset="1" stopColor={night ? "#3d6650" : "#7fc46c"} />
          </LinearGradient>
          {photos.slice(0, 3).map((p, i) => (
            <ClipPath key={p.id} id={`ph${i}`}>
              <Rect x={polaroid(i).x + 3} y={polaroid(i).y + 3} width={26} height={24} />
            </ClipPath>
          ))}
        </Defs>

        <Rect width={W} height={H} fill="url(#sky)" />
        {night && STARS.map((s, i) => <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={0.85} />)}
        <Circle cx={330} cy={52} r={night ? 46 : 70} fill="url(#glow)" />
        {night && <Circle cx={330} cy={52} r={15} fill="#fbf3d3" />}

        <G opacity={night ? 0.35 : 0.75}>
          {RAINBOW.map((c, i) => (
            <Path key={c} d={`M ${170 + i * 7} 196 A ${150 - i * 7} ${125 - i * 7} 0 0 1 ${470 - i * 7} 196`} stroke={c} strokeWidth={7} fill="none" />
          ))}
        </G>
        <Cloud x={176} y={186} s={1.1} night={night} />
        {!night && <Cloud x={250} y={36} s={0.55} night={night} />}

        <Path d={`M0 200 Q90 160 200 190 T400 178 V${H} H0 Z`} fill={night ? "#5a7f6c" : "#c7e6b4"} />
        <Path d={`M0 214 Q120 190 230 208 T400 204 V${H} H0 Z`} fill="url(#meadow)" />

        <MemoryTree x={66} y={226} rings={garden.treeRings} night={night} />

        {/* the family's photos, hanging like polaroids on a string */}
        {photos.length > 0 && <Path d="M8 98 Q70 122 128 100" stroke="#e9dcc6" strokeWidth={1.2} fill="none" />}
        {photos.slice(0, 3).map((p, i) => {
          const { x, y } = polaroid(i);
          return (
            <G key={p.id} onPress={onPhotoPress ? () => onPhotoPress(p) : undefined} transform={`rotate(${[-6, 4, -3][i]} ${x + 16} ${y})`}>
              <Rect x={x} y={y} width={32} height={36} fill="#fffdf8" />
              <SvgImage href={{ uri: p.uri }} x={x + 3} y={y + 3} width={26} height={24} preserveAspectRatio="xMidYMid slice" clipPath={`url(#ph${i})`} />
              <Circle cx={x + 16} cy={y} r={1.6} fill="#c9a26a" />
            </G>
          );
        })}

        <G>
          <Rect x={352} y={196} width={4} height={34} fill="#8a6a4a" />
          <Path d="M338 186 h32 v14 h-32 z M338 186 a16 9 0 0 1 32 0" fill="#e8796b" />
          {garden.letters > 0 && (
            <>
              <Rect x={370} y={178} width={3} height={16} fill="#7a5a3a" />
              <Rect x={373} y={178} width={10} height={7} fill="#f5c542" />
              <SvgText x={354} y={197} fontSize={9} fontWeight="bold" fill="#fff" textAnchor="middle">
                {garden.letters}
              </SvgText>
            </>
          )}
        </G>

        {garden.flowers.filter((f) => f.depth < NEAR).map((f) => <FlowerAt key={f.id} f={f} />)}

        {pet.favorites.toys.length > 0 && <Circle cx={252} cy={223} r={6} fill="#f08a5d" stroke="#fff" strokeWidth={1.5} />}
        <G>
          <Path d="M137 218 h30 l-4 10 h-22 z" fill="#6aa0d8" />
          {garden.treats.length > 0 && <Ellipse cx={152} cy={218} rx={15} ry={3.5} fill="#c98a4b" />}
        </G>

        {Array.from({ length: Math.min(garden.candlesLit, 5) }, (_, i) => (
          <Candle key={i} x={292 + i * 14} y={262 - (i % 2) * 6} night={night} />
        ))}
      </Svg>

      {k > 0 && <LivingPet pet={pet} at={at} pose={pose} k={k} heartsKey={heartsKey} onPress={onPetPress} />}

      {/* near flowers stand in front of the pet */}
      <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
          {garden.flowers.filter((f) => f.depth >= NEAR).map((f) => <FlowerAt key={f.id} f={f} />)}
        </Svg>
      </View>
    </View>
  );
}

function polaroid(i: number) {
  return [
    { x: 22, y: 104 },
    { x: 58, y: 112 },
    { x: 94, y: 106 },
  ][i]!;
}

/**
 * The pet in its own animated layer. Movement is a straight walk between
 * spots; it faces the way it is going, bobs while walking, breathes while
 * resting, and grows slightly as it comes nearer.
 */
function LivingPet({ pet, at, pose, k, heartsKey, onPress }: { pet: PetProfile; at: Spot; pose: Pose; k: number; heartsKey?: number; onPress?: () => void }) {
  const [ax] = useState(() => new Animated.Value(at.x));
  const [ad] = useState(() => new Animated.Value(at.depth));
  const [bob] = useState(() => new Animated.Value(0));
  const [hearts] = useState(() => new Animated.Value(1));
  const [flip, setFlip] = useState(false);
  const last = useRef(at);

  useEffect(() => {
    const from = last.current;
    last.current = at;
    const dist = Math.hypot(at.x - from.x, at.depth - from.depth);
    if (dist < 0.005) return;
    setFlip(at.x < from.x);
    const duration = 700 + dist * 3200;
    const anim = Animated.parallel([
      Animated.timing(ax, { toValue: at.x, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(ad, { toValue: at.depth, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [at, ax, ad]);

  const walking = pose === "walk";
  useEffect(() => {
    const t = walking ? 220 : 2200;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: t, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: t, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, walking]);

  useEffect(() => {
    if (heartsKey === undefined) return;
    hearts.setValue(0);
    const anim = Animated.timing(hearts, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [heartsKey, hearts]);

  // Box is 100 scene units; see footOf(): feet stay on the meadow as depth scales the pet.
  const box = 100 * k;
  const translateX = ax.interpolate({ inputRange: [0, 1], outputRange: [-50 * k, (W - 50) * k] });
  const translateY = ad.interpolate({ inputRange: [0, 1], outputRange: [127.72 * k, (127.72 + 57.04) * k] });
  const scale = ad.interpolate({ inputRange: [0, 1], outputRange: [0.62, 0.96] });
  const lift = bob.interpolate({ inputRange: [0, 1], outputRange: [0, walking ? -5 * k : -2.5 * k] });

  return (
    <Animated.View style={{ position: "absolute", left: 0, top: 0, width: box, height: box, transform: [{ translateX }, { translateY }, { scale }] }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Pet ${pet.name}`} style={{ flex: 1 }}>
        <Animated.View style={{ flex: 1, transform: [{ translateY: pose === "sleep" ? 0 : lift }] }}>
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <PetSprite species={pet.species} coat={pet.coat} accent={pet.accent} x={50} y={50} size={100} pose={pose} flip={flip} />
            {pose === "sleep" && (
              <G>
                <SvgText x={62} y={52} fontSize={11} fill="#fff" opacity={0.9}>z</SvgText>
                <SvgText x={70} y={40} fontSize={14} fill="#fff" opacity={0.8}>z</SvgText>
              </G>
            )}
          </Svg>
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: box * 0.3,
            top: 0,
            opacity: hearts.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
            transform: [{ translateY: hearts.interpolate({ inputRange: [0, 1], outputRange: [0, -36 * k] }) }],
          }}
        >
          <Svg width={box * 0.4} height={box * 0.3} viewBox="0 0 40 30">
            <Heart x={10} y={18} s={1} />
            <Heart x={28} y={10} s={0.7} />
          </Svg>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function Heart({ x, y, s }: { x: number; y: number; s: number }) {
  return <Path transform={`translate(${x} ${y}) scale(${s})`} d="M0 3 C-6 -3 -10 4 0 10 C10 4 6 -3 0 3 Z" fill="#f2788a" />;
}

const NEAR = 0.55;

function FlowerAt({ f }: { f: GardenState["flowers"][number] }) {
  return <Flower kind={f.flower} x={f.x * W} y={236 + f.depth * 58} h={(16 + f.depth * 16) * f.scale} />;
}

function Cloud({ x, y, s, night }: { x: number; y: number; s: number; night: boolean }) {
  const c = night ? "#7c80a8" : "#fff";
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`} opacity={0.95}>
      <Ellipse cx={0} cy={0} rx={34} ry={14} fill={c} />
      <Circle cx={-12} cy={-8} r={14} fill={c} />
      <Circle cx={10} cy={-12} r={17} fill={c} />
    </G>
  );
}

function Candle({ x, y, night }: { x: number; y: number; night: boolean }) {
  return (
    <G>
      <Circle cx={x} cy={y - 16} r={night ? 16 : 11} fill="#ffe7a3" opacity={night ? 0.55 : 0.45} />
      <Rect x={x - 3.5} y={y - 12} width={7} height={14} rx={1.5} fill="#fff8ec" />
      <Ellipse cx={x} cy={y - 16} rx={2.6} ry={4.6} fill="#ffb648" />
      <Ellipse cx={x} cy={y - 15} rx={1.2} ry={2.2} fill="#fff1b8" />
    </G>
  );
}

/** One more cluster of leaves for every year the family came back. */
function MemoryTree({ x, y, rings, night }: { x: number; y: number; rings: number; night: boolean }) {
  if (rings === 0) {
    return (
      <G>
        <Path d={`M${x} ${y} v-14`} stroke="#7a5a3a" strokeWidth={2} />
        <Ellipse cx={x + 4} cy={y - 14} rx={5} ry={3} fill="#7cc06a" />
      </G>
    );
  }
  const h = 30 + rings * 8;
  const leaves = [
    [0, 0, 18],
    [-14, 8, 13],
    [14, 8, 13],
    [-8, -12, 12],
    [10, -12, 12],
    [0, -22, 11],
  ].slice(0, rings);
  return (
    <G>
      <Path d={`M${x - 4} ${y} L${x - 2} ${y - h} L${x + 2} ${y - h} L${x + 4} ${y} Z`} fill="#8a6a4a" />
      {leaves.map(([dx, dy, r], i) => (
        <Circle key={i} cx={x + dx!} cy={y - h + dy!} r={r! + rings} fill={night ? (i % 2 ? "#3f6e4c" : "#4a7d56") : i % 2 ? "#6fb35a" : "#82c46c"} />
      ))}
    </G>
  );
}
