import { useState } from "react";
import { Image, Text, View } from "react-native";
import type { PetProfile } from "@sinian/core";
import { useStore } from "../state/store";
import { forget, pickOnePhoto } from "../media";
import { asleepFromPhoto, playFromClip, playFromPhoto, type PlayState } from "../play/setup";
import { PetCutout } from "../../modules/pet-cutout";
import { Button, Card, Note, colors, s } from "../ui";

/**
 * "Play with them": make the pet into a real-time puppet from one photo.
 * Everything happens on the phone; nothing is sent anywhere.
 */
export function PlayCard({ pet }: { pet: PetProfile }) {
  const { state, update } = useStore();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const hasVideo = state.clips.some((c) => c.cutout && !c.closeUp);

  const use = (next: PlayState | undefined) => {
    if (!next) return;
    if (state.play?.pet.from === "photo" && state.play.pet.uri !== next.pet.uri) forget(state.play.pet.uri);
    update((st) => ({ ...st, play: { ...next, scene: st.play?.scene, asleep: st.play?.asleep } }));
    setMessage(`${pet.name} is in the garden now. Stroke them, tap the ground to call them over, or flick the ball.`);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`Play with ${pet.name}`}>
      <Note>
        {PetCutout
          ? `${pet.name} can come and play in the garden: one photo of them standing, seen from the side, nose to tail, is all it takes. Your phone finds their shape and makes them move. Nothing leaves this phone.`
          : "Playing needs the installed app."}
      </Note>
      {message && <Note>{message}</Note>}
      {state.play && (
        <View style={[s.row, { alignItems: "center", marginBottom: 8 }]}>
          <View style={{ width: 96, height: 72, borderRadius: 10, backgroundColor: "#e9efe3", alignItems: "center", justifyContent: "center" }}>
            <Image source={{ uri: state.play.pet.uri }} style={{ width: 88, height: 64 }} resizeMode="contain" />
          </View>
          <Text style={{ color: colors.muted, flex: 1 }}>{`From your ${state.play.pet.from}.`}</Text>
        </View>
      )}
      {PetCutout && (
        <View style={s.row}>
          <Button label={busy ? "Working…" : state.play ? "Use another photo" : "Choose their photo"} kind={state.play ? "soft" : undefined} disabled={busy} onPress={() => run(async () => {
            const uri = await pickOnePhoto();
            if (uri) use(await playFromPhoto(uri));
          })} />
          {hasVideo && <Button label="Use their video" kind="soft" disabled={busy} onPress={() => run(async () => use(await playFromClip(state.clips)))} />}
          {state.play && <Button label="Stop playing" kind="soft" onPress={() => update((st) => ({ ...st, play: undefined }))} />}
        </View>
      )}
      {PetCutout && state.play && (
        <>
          <Note>{`Optional: a photo of ${pet.name} asleep, curled up or stretched out. At night they'll sleep like that.`}</Note>
          <View style={s.row}>
            <Button label={busy ? "Working…" : state.play.asleep ? "Use another sleeping photo" : "Add a photo of them asleep"} kind="soft" disabled={busy} onPress={() => run(async () => {
              const uri = await pickOnePhoto();
              if (!uri) return;
              const asleep = await asleepFromPhoto(uri);
              if (state.play?.asleep) forget(state.play.asleep.uri);
              update((st) => (st.play ? { ...st, play: { ...st.play, asleep } } : st));
              setMessage(`At night ${pet.name} will sleep like that.`);
            })} />
          </View>
        </>
      )}
    </Card>
  );
}
