import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { SOUND_TAGS, type PetPhoto, type PetProfile, type SoundTag } from "@sinian/core";
import { newId, today, useStore } from "../state/store";
import { coatFromPhoto, forget, pickPhotos, pickRecording, play } from "../media";
import { PhotoViewer } from "../components/PhotoViewer";
import { Button, Card, Chip, Note, colors, s } from "../ui";

const TAG_LABEL: Record<SoundTag, string> = {
  bark: "Bark",
  whine: "Whine",
  howl: "Howl",
  meow: "Meow",
  purr: "Purr",
  chirp: "Chirp",
  squeak: "Squeak",
  happy: "Happy noise",
  other: "Other",
};

/** Default tag for a new recording, by species. */
const FIRST_TAG: Record<PetProfile["species"], SoundTag> = { dog: "bark", cat: "meow", bird: "chirp", rabbit: "happy", other: "happy" };

/**
 * The family's own photos and recordings of the pet. Photos hang in the
 * garden and can set the storybook pet's colours; recordings are what the
 * pet sounds like when it reacts. Nothing leaves the phone.
 */
export function MemoriesScreen({ pet }: { pet: PetProfile }) {
  const { state, update } = useStore();
  const [viewing, setViewing] = useState<PetPhoto>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

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

  const addPhotos = () =>
    run(async () => {
      const uris = await pickPhotos();
      if (!uris.length) return;
      const photos = uris.map((uri) => ({ id: newId(), uri, addedOn: today() }));
      const first = state.photos.length === 0 ? await coatFromPhoto(uris[0]!).catch(() => undefined) : undefined;
      update((st) => ({
        ...st,
        photos: [...photos, ...st.photos],
        // The very first photo also sets the storybook colours; later ones only on request.
        pet: first && st.pet ? { ...st.pet, ...first } : st.pet,
      }));
      if (first) setMessage(`${pet.name}'s colours now come from your photo. You can change them in Days → Edit.`);
    });

  const applyColours = (p: PetPhoto) =>
    run(async () => {
      const c = await coatFromPhoto(p.uri);
      if (!c) throw new Error("Couldn't read colours from that photo. Try one where they fill the middle of the picture.");
      update((st) => (st.pet ? { ...st, pet: { ...st.pet, ...c } } : st));
      setMessage(`Updated ${pet.name}'s colours from this photo.`);
    });

  const removePhoto = (p: PetPhoto) => {
    forget(p.uri);
    update((st) => ({ ...st, photos: st.photos.filter((x) => x.id !== p.id) }));
  };

  const addSound = () =>
    run(async () => {
      const uri = await pickRecording();
      if (!uri) return;
      update((st) => ({ ...st, sounds: [...st.sounds, { id: newId(), uri, tag: FIRST_TAG[pet.species] }] }));
    });

  return (
    <View>
      <Text style={[s.h1, { marginBottom: 4 }]}>{`Memories of ${pet.name}`}</Text>
      <Note>Your photos hang in the garden, and your recordings become {pet.name}&apos;s voice there. Everything stays on this phone.</Note>
      {message && <Note>{message}</Note>}

      <Card title="Photos">
        <View style={[s.row, { marginBottom: 6 }]}>
          {state.photos.map((p) => (
            <View key={p.id} style={{ width: 96 }}>
              <Pressable onPress={() => setViewing(p)} accessibilityLabel="Open photo">
                <Image source={{ uri: p.uri }} style={{ width: 96, height: 96, borderRadius: 10, backgroundColor: "#eee" }} />
              </Pressable>
              <Text style={{ color: colors.accent, fontSize: 12, marginTop: 4 }} onPress={() => applyColours(p)}>
                Use colours
              </Text>
              <Text style={{ color: colors.danger, fontSize: 12 }} onPress={() => removePhoto(p)}>
                Remove
              </Text>
            </View>
          ))}
        </View>
        <Button label={busy ? "Working…" : "Add photos"} onPress={addPhotos} disabled={busy} />
      </Card>

      <Card title={`${pet.name}'s voice`}>
        <Note>Add short recordings: a bark at the door, a purr on your lap. Tag each one so {pet.name} uses the right sound when you call, pet or play.</Note>
        {state.sounds.map((c, i) => (
          <View key={c.id} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderColor: "#eee" }}>
            <View style={[s.row, { alignItems: "center" }]}>
              <Text style={{ color: colors.ink, fontSize: 15 }}>Recording {i + 1}</Text>
              <Text style={{ color: colors.accent }} onPress={() => play(c.uri)}>
                ▶︎ Play
              </Text>
              <Text
                style={{ color: colors.danger }}
                onPress={() => {
                  forget(c.uri);
                  update((st) => ({ ...st, sounds: st.sounds.filter((x) => x.id !== c.id) }));
                }}
              >
                Remove
              </Text>
            </View>
            <View style={[s.row, { marginTop: 6 }]}>
              {SOUND_TAGS.map((t) => (
                <Chip
                  key={t}
                  label={TAG_LABEL[t]}
                  on={c.tag === t}
                  onPress={() => update((st) => ({ ...st, sounds: st.sounds.map((x) => (x.id === c.id ? { ...x, tag: t } : x)) }))}
                />
              ))}
            </View>
          </View>
        ))}
        <Button label={busy ? "Working…" : "Add a recording"} onPress={addSound} disabled={busy} />
        <View style={[s.row, { marginTop: 10 }]}>
          <Chip label={state.soundOn ? "🔊 Sounds on" : "🔈 Sounds off"} on={state.soundOn} onPress={() => update((st) => ({ ...st, soundOn: !st.soundOn }))} />
        </View>
      </Card>

      {viewing && <PhotoViewer photo={viewing} sounds={state.soundOn ? state.sounds : []} onClose={() => setViewing(undefined)} />}
    </View>
  );
}
