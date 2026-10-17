import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  FLOWER_KINDS,
  gardenState,
  gentleNudge,
  imaginedNote,
  isNight,
  nextMoment,
  occasionsOn,
  pickSound,
  react,
  type FlowerKind,
  type Interaction,
  type PetPhoto,
  type PetProfile,
  type Pose,
  type Spot,
  type Visit,
} from "@sinian/core";
import { newId, today, useStore } from "../state/store";
import { GardenScene } from "../components/GardenScene";
import { PhotoViewer } from "../components/PhotoViewer";
import { play } from "../media";
import { Button, Card, Chip, Field, Note, colors, s } from "../ui";

const FLOWER_LABEL: Record<FlowerKind, string> = {
  daisy: "Daisy",
  tulip: "Tulip",
  sunflower: "Sunflower",
  "forget-me-not": "Forget-me-not",
  lavender: "Lavender",
};

type Panel = "flower" | "treat" | "letter" | undefined;
/** Omit applied to each member of the Visit union, so kind-specific fields survive. */
type NewVisit = Visit extends infer V ? (V extends Visit ? Omit<V, "id" | "on"> : never) : never;

interface Live {
  at: Spot;
  pose: Pose;
  caption: string;
}

export function GardenScreen({
  pet,
  day = today(),
  hour = new Date().getHours(),
  autoplay = true,
}: {
  pet: PetProfile;
  day?: string;
  hour?: number;
  /** Let the pet live on its own. Tests turn this off to control timing. */
  autoplay?: boolean;
}) {
  const { state, update } = useStore();
  const [panel, setPanel] = useState<Panel>();
  const [letter, setLetter] = useState("");
  const [viewing, setViewing] = useState<PetPhoto>();
  const [heartsKey, setHeartsKey] = useState<number>();
  const garden = useMemo(() => gardenState(pet, state.visits, day), [pet, state.visits, day]);
  const night = isNight(hour);
  const nudge = gentleNudge(pet, day);
  const occasion = occasionsOn(pet, day)[0];
  const toy = pet.favorites.toys[0];

  // Seeded so behaviour is reproducible within a visit; varies between visits.
  const [seed0] = useState(() => Math.floor(Math.random() * 1e6));
  const tick = useRef(0);
  const nextSeed = () => seed0 + ++tick.current;
  const ctx = useMemo(
    () => ({ name: pet.name, species: pet.species, traits: pet.traits, hour, flowers: garden.flowers, toy }),
    [pet.name, pet.species, pet.traits, hour, garden.flowers, toy],
  );
  const [live, setLive] = useState<Live>(() => {
    const m = nextMoment({ ...ctx, seed: seed0 });
    return { at: m.at, pose: m.pose === "walk" ? "sit" : m.pose, caption: m.caption };
  });
  const [holdUntil, setHoldUntil] = useState(0); // pause the life loop while a reaction plays out
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);

  // The life loop: walk to the next spot, then settle into what it's doing.
  useEffect(() => {
    if (!autoplay) return;
    const wait = Math.max(0, holdUntil - Date.now());
    const t = setTimeout(() => {
      const m = nextMoment({ ...ctx, seed: nextSeed() });
      const dist = Math.hypot(m.at.x - live.at.x, m.at.depth - live.at.depth);
      const moving = dist > 0.03 && m.pose !== "sleep";
      setLive({ at: m.at, pose: moving ? "walk" : m.pose, caption: m.caption });
      if (moving && m.pose !== "walk") {
        clearTimeout(settle.current);
        settle.current = setTimeout(() => setLive((l) => (l.at === m.at ? { ...l, pose: m.pose } : l)), 700 + dist * 3200);
      }
    }, wait + (live.pose === "walk" ? 4000 : 8000));
    return () => clearTimeout(t);
    // nextSeed only touches a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, ctx, live, holdUntil]);

  const respond = useCallback(
    (i: Interaction, treat?: string) => {
      const r = react(i, { name: pet.name, species: pet.species, here: live.at, toy, treat });
      setLive({ at: r.at, pose: r.pose, caption: r.caption });
      setHoldUntil(Date.now() + r.seconds * 1000);
      if (r.hearts) setHeartsKey((k) => (k ?? 0) + 1);
      const clip = state.soundOn ? pickSound(state.sounds, r.sounds, nextSeed()) : undefined;
      if (clip) play(clip.uri);
    },
    // nextSeed only touches a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pet.name, pet.species, live.at, toy, state.soundOn, state.sounds],
  );

  // Every gesture is free and leaves something that stays.
  const visit = (v: NewVisit) => {
    update((st) => ({ ...st, visits: [...st.visits, { ...v, id: newId(), on: day } as Visit] }));
    setPanel(undefined);
  };

  const treats = pet.favorites.treats.length ? pet.favorites.treats : ["a treat"];

  return (
    <View>
      {nudge && (
        <View style={{ backgroundColor: "#fff4dc", borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 15 }}>{nudge}</Text>
        </View>
      )}

      <GardenScene
        pet={pet}
        garden={garden}
        at={live.at}
        pose={live.pose}
        night={night}
        photos={state.photos}
        heartsKey={heartsKey}
        onPetPress={() => respond("pet")}
        onPhotoPress={setViewing}
      />
      <Text style={{ color: colors.ink, fontSize: 15, marginTop: 8, minHeight: 40 }} accessibilityLiveRegion="polite">
        {live.caption}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        ✦ A simulation of {pet.name}
        {state.sounds.length ? ", with your own recordings of their voice" : ""}.
      </Text>

      <View style={[s.row, { marginTop: 8 }]}>
        <Button label={`🤚  Pet ${pet.name}`} onPress={() => respond("pet")} />
        <Button label={`📣  Call ${pet.name}`} onPress={() => respond("call")} />
        {toy && <Button label={`🎾  Play with the ${toy}`} onPress={() => respond("play")} />}
      </View>

      <View style={{ marginTop: 14, marginBottom: 2 }}>
        <Text style={s.h2}>Leave something</Text>
        <Text style={{ color: colors.muted, marginTop: -6 }}>
          {garden.flowers.length} {garden.flowers.length === 1 ? "flower" : "flowers"} planted · the tree has {garden.treeRings}{" "}
          {garden.treeRings === 1 ? "ring" : "rings"}
        </Text>
      </View>
      <View style={s.row}>
        <Button label="🕯  Light a candle" kind="soft" onPress={() => visit({ kind: "candle" })} />
        <Button label="🌼  Plant a flower" kind="soft" onPress={() => setPanel(panel === "flower" ? undefined : "flower")} />
        <Button label="🦴  Give a treat" kind="soft" onPress={() => setPanel(panel === "treat" ? undefined : "treat")} />
        <Button label="✉️  Write a letter" kind="soft" onPress={() => setPanel(panel === "letter" ? undefined : "letter")} />
      </View>

      {panel === "flower" && (
        <Card title="Which flower?">
          <View style={s.row}>
            {FLOWER_KINDS.map((f) => (
              <Chip key={f} label={FLOWER_LABEL[f]} on={false} onPress={() => visit({ kind: "flower", flower: f })} />
            ))}
          </View>
        </Card>
      )}

      {panel === "treat" && (
        <Card title="Their favorite">
          <View style={s.row}>
            {treats.map((t) => (
              <Chip
                key={t}
                label={t}
                on={false}
                onPress={() => {
                  visit({ kind: "treat", treat: t });
                  respond("treat", t);
                }}
              />
            ))}
          </View>
        </Card>
      )}

      {panel === "letter" && (
        <Card title={`Dear ${pet.name},`}>
          <Field label="Your letter stays in the garden's mailbox" multiline value={letter} onChangeText={setLetter} placeholder="Today I walked past the park and…" />
          <Button
            label="Put it in the mailbox"
            disabled={!letter.trim()}
            onPress={() => {
              visit({ kind: "letter", text: letter.trim() });
              setLetter("");
            }}
          />
        </Card>
      )}

      {occasion && (
        <Card title={`A note from ${pet.name}`}>
          <Text style={{ fontSize: 15, color: colors.ink, lineHeight: 22, fontStyle: "italic" }}>{imaginedNote(pet, occasion)}</Text>
          <Note>✦ Imagined, from the things you told us about {pet.name}.</Note>
        </Card>
      )}

      {viewing && <PhotoViewer photo={viewing} sounds={state.soundOn ? state.sounds : []} onClose={() => setViewing(undefined)} />}
    </View>
  );
}
