import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import type { PetProfile } from "@sinian/core";
import { useStore } from "../state/store";
import { pickOnePhoto } from "../media";
import { aliveAvailable } from "../alive/client";
import { forgetScene, petFromClip, petFromPhoto } from "../alive/make";
import { SCENES, type AliveScene } from "../alive/scenes";
import { NO_ALIVE, sceneProgress, type AliveSceneState } from "../alive/types";
import { Button, Card, Note, colors, s } from "../ui";

/**
 * "Bring them to life": the family agrees, chooses the photo (or their video)
 * to start from, and has the pet made into short clips in any of the scenes.
 * Everything that leaves the phone is said plainly before it does.
 */
export function AliveCard({ pet }: { pet: PetProfile }) {
  const { state, update } = useStore();
  const alive = state.alive ?? NO_ALIVE;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const fromVideo = petFromClip(state.clips);

  const set = (fn: (a: typeof alive) => typeof alive) => update((st) => ({ ...st, alive: fn(st.alive ?? NO_ALIVE) }));
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

  /** A new picture of the pet means every scene is made again from it. */
  const choosePet = (next: NonNullable<typeof alive.pet>) => {
    for (const id of Object.keys(alive.scenes)) forgetScene(id);
    set((a) => ({ ...a, pet: next, scenes: {}, scene: undefined }));
  };

  if (!aliveAvailable()) {
    return (
      <Card title="Bring them to life">
        <Note>This build isn&apos;t connected to the video service yet.</Note>
      </Card>
    );
  }

  if (!alive.consent) {
    return (
      <Card title="Bring them to life">
        <Note>
          {`An AI video model can bring ${pet.name} to life in beautiful places: resting, wandering, playing, sleeping, and answering when you call. `}
          {`To do that, the picture of ${pet.name} you choose, placed in a scene, is sent to our server and on to the video service (Runware) to be animated. `}
          {`Nothing else leaves this phone, and the clips are kept here. What you see is imagined, not filmed, and it's always labelled that way.`}
        </Note>
        <Button label="I understand, bring them to life" onPress={() => set((a) => ({ ...a, consent: true }))} />
      </Card>
    );
  }

  const make = (scene: AliveScene) => {
    forgetScene(scene.id);
    set((a) => ({ ...a, scenes: { ...a.scenes, [scene.id]: { clips: {}, tasks: {} } } }));
  };

  return (
    <Card title="Bring them to life">
      {message && <Note>{message}</Note>}
      {alive.pet ? (
        <View style={[s.row, { alignItems: "center", marginBottom: 8 }]}>
          <View style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: "#e9efe3", alignItems: "center", justifyContent: "center" }}>
            <Image source={{ uri: alive.pet.uri }} style={{ width: 64, height: 64 }} resizeMode="contain" />
          </View>
          <Text style={{ color: colors.muted, flex: 1 }}>{`From your ${alive.pet.from}. Choosing a new picture makes every scene again.`}</Text>
        </View>
      ) : (
        <Note>{`Start from a photo that shows ${pet.name} from head to paws, or from one of your videos.`}</Note>
      )}
      <View style={s.row}>
        <Button label={busy ? "Working…" : alive.pet ? "Use another photo" : "Use a photo"} kind={alive.pet ? "soft" : undefined} disabled={busy} onPress={() => run(async () => {
          const uri = await pickOnePhoto();
          if (uri) choosePet(await petFromPhoto(uri));
        })} />
        {fromVideo && alive.pet?.uri !== fromVideo.uri && <Button label="Use their video" kind="soft" onPress={() => choosePet(fromVideo)} />}
      </View>

      {alive.pet && (
        <>
          <Note>Each scene is about 45 seconds of generated video, made once and kept on this phone. It takes a few minutes.</Note>
          <View style={[s.row, { gap: 10 }]}>
            {SCENES.map((scene) => (
              <SceneTile
                key={scene.id}
                scene={scene}
                state={alive.scenes[scene.id]}
                shown={alive.scene === scene.id}
                onMake={() => make(scene)}
                onShow={() => set((a) => ({ ...a, scene: scene.id }))}
              />
            ))}
          </View>
          {alive.scene && <Text style={{ color: colors.accent, marginTop: 8 }} onPress={() => set((a) => ({ ...a, scene: undefined }))}>Back to the garden without them</Text>}
        </>
      )}
    </Card>
  );
}

function SceneTile({ scene, state, shown, onMake, onShow }: { scene: AliveScene; state?: AliveSceneState; shown: boolean; onMake: () => void; onShow: () => void }) {
  const p = sceneProgress(state);
  const status = !state
    ? "Make"
    : state.error
      ? "Try again"
      : p.ready
        ? shown
          ? "✓ In the garden"
          : "Show in the garden"
        : state.key
          ? `Making… ${p.done} of ${p.total}`
          : "Getting ready…";
  const act = !state || state.error ? onMake : p.ready ? onShow : undefined;
  return (
    <Pressable onPress={act} disabled={!act} accessibilityRole="button" accessibilityLabel={`${scene.title}: ${status}`} style={{ width: 150 }}>
      <Image source={state?.key ? { uri: state.key } : scene.image} style={{ width: 150, height: 112, borderRadius: 10, borderWidth: shown ? 3 : 0, borderColor: colors.accent }} />
      <Text style={{ color: colors.ink, marginTop: 4 }}>{scene.title}</Text>
      <Text style={{ color: state?.error ? colors.danger : colors.accent, fontSize: 12 }}>{status}</Text>
      {state?.error && <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={3}>{state.error}</Text>}
      {!!state?.cost && <Text style={{ color: colors.muted, fontSize: 11 }}>{`Cost so far $${state.cost.toFixed(2)}`}</Text>}
    </Pressable>
  );
}
