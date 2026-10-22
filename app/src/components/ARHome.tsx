import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Asset } from "expo-asset";
import { ARPlayView } from "../../modules/pet-cutout";
import type { PlayState } from "../play/setup";
import type { PlayCommand } from "./PlayStage";

const BALL = require("../../assets/garden/ball.png");

/**
 * The pet in your home: the camera, your floor, and the pet on it, played
 * with just like in the garden. Full screen, until the family closes it.
 */
export function ARHome({
  name,
  species,
  play,
  caption,
  onEvent,
  onClose,
}: {
  name: string;
  species: string;
  play: PlayState;
  caption?: string;
  onEvent: (type: string) => void;
  onClose: () => void;
}) {
  const [ball, setBall] = useState<string>();
  const [status, setStatus] = useState<"find" | "placed" | "unsupported">(
    "find",
  );
  const [command, setCommand] = useState<PlayCommand>();
  useEffect(() => {
    const a = Asset.fromModule(BALL);
    void a.downloadAsync().then(() => setBall(a.localUri ?? undefined));
  }, []);
  const send = (kind: PlayCommand["kind"]) =>
    setCommand((c) => ({ kind, key: (c?.key ?? 0) + 1 }));
  const hint =
    status === "unsupported"
      ? "This phone can't show them in your home (it needs AR)."
      : status === "find"
        ? `Point your phone at the floor, then tap where ${name} should be.`
        : (caption ?? `${name} is here with you.`);

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      {/* A modal is its own window, so it needs its own safe-area insets. */}
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {ARPlayView && ball && (
            <ARPlayView
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
              }}
              pet={{ uri: play.pet.uri, rig: play.rig }}
              ball={ball}
              species={species}
              command={command}
              onPlayEvent={(e) => {
                const type = e.nativeEvent.type;
                if (type === "ar-unsupported") setStatus("unsupported");
                else if (type === "ar-placed") setStatus("placed");
                else if (type !== "ar-find-floor") onEvent(type);
              }}
            />
          )}
          <SafeAreaView
            style={{ flex: 1, justifyContent: "space-between" }}
            pointerEvents="box-none"
          >
            <View
              style={{
                margin: 16,
                padding: 12,
                borderRadius: 14,
                backgroundColor: "rgba(0,0,0,0.45)",
              }}
              pointerEvents="none"
            >
              <Text style={{ color: "#fff", fontSize: 16 }}>{hint}</Text>
              <Text
                style={{
                  color: "rgba(255,255,255,0.75)",
                  fontSize: 12,
                  marginTop: 4,
                }}
              >{`✦ ${name}, from your photo, moving as a puppet. Imagined, not filmed.`}</Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 10,
                justifyContent: "center",
                margin: 16,
              }}
            >
              {status === "placed" &&
                (
                  [
                    ["📣  Call", "call"],
                    ["🤚  Pet", "pet"],
                    ["🎾  Throw the ball", "play"],
                  ] as const
                ).map(([label, kind]) => (
                  <Pressable
                    key={kind}
                    onPress={() => send(kind)}
                    accessibilityRole="button"
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 18,
                      borderRadius: 24,
                      backgroundColor: "rgba(255,255,255,0.9)",
                    }}
                  >
                    <Text style={{ fontSize: 16, color: "#2b2320" }}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 18,
                  borderRadius: 24,
                  backgroundColor: "rgba(0,0,0,0.55)",
                }}
              >
                <Text style={{ fontSize: 16, color: "#fff" }}>Close</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
