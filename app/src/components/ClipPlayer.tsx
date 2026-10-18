import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import type { VideoClip } from "@sinian/core";

/**
 * Plays one of the family's video clips from its sprite sheet, looping. The
 * frame is fitted into a `size` box with the pet's feet on the bottom edge,
 * like the storybook sprite, so it stands on the meadow the same way.
 */
export function ClipPlayer({ clip, size, flip = false, playing = true }: { clip: VideoClip; size: number; flip?: boolean; playing?: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!playing || clip.frameCount < 2) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000 / clip.fps);
    return () => clearInterval(t);
  }, [clip, playing]);

  const frame = tick % clip.frameCount;
  const fit = size / Math.max(clip.width, clip.height);
  const w = clip.width * fit;
  const h = clip.height * fit;
  const rows = Math.ceil(clip.frameCount / clip.cols);
  const col = frame % clip.cols;
  const row = Math.floor(frame / clip.cols);

  return (
    <View style={[{ width: size, height: size }, flip && { transform: [{ scaleX: -1 }] }]} pointerEvents="none">
      {clip.cutout && (
        <View style={{ position: "absolute", left: (size - w * 0.8) / 2, top: size - 8, width: w * 0.8, height: 10, borderRadius: 999, backgroundColor: "#000", opacity: 0.12 }} />
      )}
      <View
        style={{
          position: "absolute",
          left: (size - w) / 2,
          top: size - h,
          width: w,
          height: h,
          overflow: "hidden",
          // Footage that couldn't be cut out sits in a soft frame instead.
          ...(clip.cutout ? null : { borderRadius: w * 0.18, borderWidth: 2, borderColor: "#fffdf8" }),
        }}
      >
        <Image
          source={{ uri: clip.sheetUri }}
          fadeDuration={0}
          style={{ position: "absolute", left: -col * w, top: -row * h, width: w * clip.cols, height: h * rows }}
        />
      </View>
    </View>
  );
}
