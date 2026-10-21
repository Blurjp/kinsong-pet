import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import Svg from "react-native-svg";
import type { GardenState } from "@sinian/core";
import { AliveView } from "../../modules/pet-cutout";
import { placeOf, type AliveScene } from "../alive/scenes";
import type { AliveSceneState } from "../alive/types";
import { SceneThings } from "./PhotoGarden";

const W = 400;
const H = 300;

/**
 * A brought-to-life scene in the garden: the generated clips, full frame (the
 * pet and its place together, moving as one), with the family's flowers and
 * candles standing in the same perspective. Tapping the pet pets it.
 */
export function AliveStage({
  name,
  scene,
  state,
  garden,
  night,
  loopUri,
  action,
  onActionEnd,
  onPetPress,
}: {
  name: string;
  scene: AliveScene;
  state: AliveSceneState;
  garden: GardenState;
  night: boolean;
  loopUri: string;
  action?: { uri: string; key: number; then?: string };
  onActionEnd: () => void;
  onPetPress?: () => void;
}) {
  const [k, setK] = useState(0);
  const petWidth = scene.height * 1.4 * (H / W); // about how wide a standing pet is, as a fraction of the width
  return (
    <View
      style={{ width: "100%", aspectRatio: W / H, borderRadius: 18, overflow: "hidden", backgroundColor: "#000" }}
      accessibilityLabel={`${name} in the ${scene.title.toLowerCase()}${night ? " at night" : ""}`}
      onLayout={(e) => setK(e.nativeEvent.layout.width / W)}
    >
      {AliveView ? (
        <AliveView style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} loopUri={loopUri} action={action} night={night} onActionEnd={onActionEnd} />
      ) : (
        <Image source={{ uri: state.key }} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      )}
      <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
          <SceneThings garden={garden} night={night} place={placeOf(scene)} pet={{ x: scene.feet.x, width: petWidth }} />
        </Svg>
      </View>
      {k > 0 && (
        <Pressable
          onPress={onPetPress}
          accessibilityRole="button"
          accessibilityLabel={`Pet ${name}`}
          style={{
            position: "absolute",
            left: (scene.feet.x - petWidth / 2) * W * k,
            top: (scene.feet.y - scene.height) * H * k,
            width: petWidth * W * k,
            height: scene.height * H * k,
          }}
        />
      )}
    </View>
  );
}
