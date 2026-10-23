import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { Asset } from "expo-asset";
import { PlayView } from "../../modules/pet-cutout";
import { placeOf, type AliveScene } from "../alive/scenes";
import type { PlayState } from "../play/setup";

export type PlayCommand = { kind: "call" | "play" | "pet" | "treat"; key: number };

const BALL = require("../../assets/garden/ball.png");

/**
 * The real-time garden: the family's pet as a photo-puppet in a photographed
 * scene, played with by touch (stroke it, tap the ground, flick the ball) and
 * by the buttons below it.
 */
export function PlayStage({
  name,
  species,
  play,
  scene,
  night,
  command,
  onEvent,
}: {
  name: string;
  species: string;
  play: PlayState;
  scene: AliveScene;
  night: boolean;
  command?: PlayCommand;
  onEvent: (type: string) => void;
}) {
  const [files, setFiles] = useState<{ scene: string; background: string; ball: string }>();
  useEffect(() => {
    let live = true;
    void (async () => {
      const [bg, ball] = [Asset.fromModule(scene.image), Asset.fromModule(BALL)];
      await Promise.all([bg.downloadAsync(), ball.downloadAsync()]);
      if (live && bg.localUri && ball.localUri) setFiles({ scene: scene.id, background: bg.localUri, ball: ball.localUri });
    })();
    return () => {
      live = false;
    };
  }, [scene]);
  const place = placeOf(scene);
  return (
    <View style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 18, overflow: "hidden", backgroundColor: "#cfe3c4" }} accessibilityLabel={`${name} in the ${scene.title.toLowerCase()}`}>
      {PlayView && files ? (
        <PlayView
          style={{ flex: 1 }}
          pet={{ uri: play.pet.uri, rig: play.rig, asleep: play.asleep && { uri: play.asleep.uri, facesRight: play.asleep.facesRight } }}
          background={files.background}
          ball={files.ball}
          horizon={scene.horizon}
          cameraMetres={place.cameraMetres}
          night={night}
          species={species}
          command={command}
          onPlayEvent={(e) => onEvent(e.nativeEvent.type)}
        />
      ) : (
        <Image source={scene.image} style={{ flex: 1, width: "100%" }} />
      )}
    </View>
  );
}
