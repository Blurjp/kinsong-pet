import { useState } from "react";
import { Image, Text, View } from "react-native";
import type { VideoClip } from "@sinian/core";
import { DOG_METRES, groundY, unitsPerMetre, type Place } from "./PhotoGarden";
import { colors } from "../ui";

const W = 400;
const H = 300;

/**
 * The family's photo of a place, with a line they drag to where the ground
 * meets the far distance. Their pet's cut-out stands in the preview at the
 * nearest and furthest spots, at the size it will be in the garden, so they
 * can see straight away whether the line is right.
 */
export function PlaceEditor({ place, clip, onChange }: { place: { uri: string; horizon: number }; clip?: VideoClip; onChange: (horizon: number) => void }) {
  const [k, setK] = useState(0); // px per scene unit, known after layout
  const [horizon, setHorizon] = useState(place.horizon);
  const at = (y: number) => (k ? Math.min(0.85, Math.max(0.15, y / (H * k))) : horizon);

  const p: Place = { uri: place.uri, horizon };

  return (
    <View>
      <View
        style={{ width: "100%", aspectRatio: W / H, borderRadius: 12, overflow: "hidden", backgroundColor: "#dcebd0" }}
        onLayout={(e) => setK(e.nativeEvent.layout.width / W)}
        accessibilityLabel="Their place. Drag the line to where the ground meets the distance."
        accessibilityRole="adjustable"
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setHorizon(at(e.nativeEvent.locationY))}
        onResponderMove={(e) => setHorizon(at(e.nativeEvent.locationY))}
        onResponderRelease={(e) => onChange(at(e.nativeEvent.locationY))}
      >
        <View style={{ flex: 1 }} pointerEvents="none">
          <Image source={{ uri: place.uri }} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} resizeMode="cover" />
          {k > 0 && clip && !clip.closeUp && <StandIn clip={clip} place={p} depth={0} x={0.68} k={k} />}
          {k > 0 && clip && !clip.closeUp && <StandIn clip={clip} place={p} depth={1} x={0.4} k={k} />}
          <View style={{ position: "absolute", left: 0, right: 0, top: `${horizon * 100}%`, height: 2, marginTop: -1, backgroundColor: "#fff", opacity: 0.9 }} />
          <View style={{ position: "absolute", right: 8, top: `${horizon * 100}%`, marginTop: -11, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: "#fff", justifyContent: "center" }}>
            <Text style={{ fontSize: 11, color: colors.ink }}>↕ horizon</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/** The pet's first frame standing at a spot, at its garden size. */
function StandIn({ clip, place, depth, x, k }: { clip: VideoClip; place: Place; depth: number; x: number; k: number }) {
  const y = groundY(depth, place);
  const h = DOG_METRES * unitsPerMetre(y, place) * k;
  const w = (h * clip.width) / clip.height;
  return <Image source={{ uri: clip.posterUri }} style={{ position: "absolute", left: x * W * k - w / 2, top: y * k - h, width: w, height: h }} />;
}
