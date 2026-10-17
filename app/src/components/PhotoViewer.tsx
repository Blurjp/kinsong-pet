import { useEffect, useState } from "react";
import { Animated, Easing, Image, Modal, Pressable, Text, View } from "react-native";
import { pickSound, type PetPhoto, type SoundClip } from "@sinian/core";
import { play } from "../media";

/** A real photo, full screen, drifting slowly (Ken Burns), with one of their sounds if there is one. */
export function PhotoViewer({ photo, sounds, onClose }: { photo: PetPhoto; sounds: readonly SoundClip[]; onClose: () => void }) {
  const [drift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.timing(drift, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    anim.start();
    const clip = pickSound(sounds, ["happy", "bark", "purr", "meow", "chirp"], photo.id.length + photo.addedOn.length);
    if (clip) play(clip.uri);
    return () => anim.stop();
  }, [drift, photo, sounds]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(20,18,16,0.92)", justifyContent: "center", alignItems: "center", padding: 20 }}>
        <View style={{ width: "100%", maxWidth: 520, aspectRatio: 1, overflow: "hidden", borderRadius: 14 }}>
          <Animated.View
            style={{
              flex: 1,
              transform: [
                { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
                { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) },
              ],
            }}
          >
            <Image source={{ uri: photo.uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityLabel="Photo" />
          </Animated.View>
        </View>
        <Text style={{ color: "#eee", marginTop: 14 }}>Tap anywhere to go back to the garden</Text>
      </Pressable>
    </Modal>
  );
}
