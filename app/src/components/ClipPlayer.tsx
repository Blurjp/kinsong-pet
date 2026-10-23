import { useEffect, useState } from "react";
import { Animated, Easing, Image, StyleSheet, View } from "react-native";
import type { VideoClip } from "@sinian/core";
import { PetClipView } from "../../modules/pet-cutout";

/**
 * One of the family's video clips, playing on a loop at its own frame rate,
 * with the garden showing through around the pet. Fills its parent and stands
 * the pet on the parent's bottom edge, centred, `height` px tall. When the
 * clip changes (sitting → barking) the two crossfade instead of cutting, the
 * way footage of one animal would. Where native video isn't available (tests,
 * web) the clip's first frame stands in.
 */
export function ClipPlayer({
  clip,
  height,
  flip = false,
  night = false,
  restartKey,
}: {
  clip: VideoClip;
  height: number;
  flip?: boolean;
  /** Light it like the night-time garden. */
  night?: boolean;
  restartKey?: number;
}) {
  const [shown, setShown] = useState(clip);
  const [leaving, setLeaving] = useState<VideoClip>();
  const [fade] = useState(() => new Animated.Value(1));
  if (clip.id !== shown.id) {
    setLeaving(shown);
    setShown(clip);
  }

  useEffect(() => {
    fade.setValue(0);
    const anim = Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    anim.start(({ finished }) => finished && setLeaving(undefined));
    return () => anim.stop();
  }, [shown.id, fade]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {leaving && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
          <Layer clip={leaving} height={height} flip={flip} night={night} />
        </Animated.View>
      )}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: leaving ? fade : 1 }]}>
        <Layer clip={shown} height={height} flip={flip} night={night} restartKey={restartKey} />
      </Animated.View>
    </View>
  );
}

function Layer({ clip, height, flip, night, restartKey }: { clip: VideoClip; height: number; flip: boolean; night: boolean; restartKey?: number }) {
  const width = (height * clip.width) / clip.height;
  const box = {
    position: "absolute" as const,
    left: "50%" as const,
    bottom: 0,
    width,
    height,
    marginLeft: -width / 2,
    // Footage that couldn't be cut out sits in a soft frame instead.
    ...(clip.cutout ? null : { borderRadius: Math.min(width, height) * 0.12, overflow: "hidden" as const, borderWidth: 2, borderColor: "#fffdf8" }),
  };
  return PetClipView ? (
    <PetClipView uri={clip.videoUri} flip={flip} night={night} restartKey={restartKey} style={box} />
  ) : (
    <Image source={{ uri: clip.posterUri }} style={[box, flip && { transform: [{ scaleX: -1 }] }]} accessibilityIgnoresInvertColors />
  );
}
