import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import {
  FLOWER_KINDS,
  canTravel,
  clipActionsFor,
  clipCaption,
  gardenState,
  gentleNudge,
  imaginedNote,
  isNight,
  nextMoment,
  occasionsOn,
  pickSound,
  pickVideoClip,
  react,
  type ClipAction,
  type FlowerKind,
  type Interaction,
  type PetPhoto,
  type PetProfile,
  type Pose,
  type Reaction,
  type Spot,
  type Visit,
} from "@sinian/core";
import { newId, today, useStore } from "../state/store";
import { GardenScene, walkMs } from "../components/GardenScene";
import { AliveStage } from "../components/AliveStage";
import { SCENES, sceneById } from "../alive/scenes";
import { PlayStage, type PlayCommand } from "../components/PlayStage";
import { sceneProgress, type AliveAction } from "../alive/types";
import { useAlivePet } from "../alive/useAlivePet";
import { PhotoViewer } from "../components/PhotoViewer";
import { play as play_ } from "../media";
import { Button, Card, Chip, Field, Note, colors, s } from "../ui";

const FLOWER_LABEL: Record<FlowerKind, string> = {
  daisy: "Daisy",
  tulip: "Tulip",
  sunflower: "Sunflower",
  "forget-me-not": "Forget-me-not",
  lavender: "Lavender",
};

type Panel = "flower" | "treat" | "letter" | undefined;

/** Where the real pet stays when there's no footage of it walking: a real animal can't glide. */
const REAL_HOME: Spot = { x: 0.58, depth: 0.62 };
/** Omit applied to each member of the Visit union, so kind-specific fields survive. */
type NewVisit = Visit extends infer V ? (V extends Visit ? Omit<V, "id" | "on"> : never) : never;

interface Live {
  at: Spot;
  pose: Pose;
  caption: string;
  /** Which video clips suit a reaction; otherwise they follow the pose. */
  clips?: ClipAction[];
  /** The real pet couldn't go where the caption says, so describe the footage instead. */
  stayed?: boolean;
  seed: number;
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
  // With footage, the garden shows the real pet, which only changes place when it can be seen walking.
  const real = state.clips.length > 0;
  const travel = canTravel(state.clips);
  const place = (at: Spot) => (real && !travel ? REAL_HOME : at);
  const stayed = (at: Spot) => place(at) !== at;
  const walkTime = (from: Spot, to: Spot) => (real ? walkMs(from, to) : 700 + Math.hypot(to.x - from.x, to.depth - from.depth) * 3200);

  const [live, setLive] = useState<Live>(() => {
    const m = nextMoment({ ...ctx, seed: seed0 });
    return { at: place(m.at), pose: m.pose === "walk" ? "sit" : m.pose, caption: m.caption, stayed: stayed(m.at), seed: seed0 };
  });
  const wanted = live.clips ?? clipActionsFor(live.pose);
  const clip = pickVideoClip(state.clips, wanted, live.seed);
  // The real pet's caption says what the footage shows: on its way somewhere, it's walking.
  const literal = clip && (live.stayed || live.pose === "walk" || !wanted.includes(clip.action));
  const caption = clip && literal ? clipCaption(pet.name, clip.action, night) : live.caption;
  // Brought to life: generated clips of the pet in a photographed scene, once the family has made one.
  const aliveScene = sceneById(state.alive?.scene);
  const aliveState = aliveScene && state.alive?.scenes[aliveScene.id];
  const alive = !!(state.alive?.consent && aliveScene && aliveState && sceneProgress(aliveState).ready);
  const alivePet = useAlivePet({
    name: pet.name,
    species: pet.species,
    place: aliveScene?.title.toLowerCase() ?? "garden",
    scene: alive ? aliveState : undefined,
    night,
    autoplay,
  });

  // Play: the pet as a real-time puppet from their photo. When it's set up, it's the garden.
  const play = state.play;
  const playScene = sceneById(play?.scene) ?? SCENES[0]!;
  const [command, setCommand] = useState<PlayCommand>();
  const commandKey = useRef(0);
  const lastTreat = useRef<string | undefined>(undefined);
  const [playCaption, setPlayCaption] = useState<string>();
  const sound = (prefer: Parameters<typeof pickSound>[1], bark: boolean) => {
    if (!state.soundOn) return;
    const own = bark ? state.clips.find((c) => c.action === "bark" && c.audioUri)?.audioUri : undefined;
    const uri = own ?? pickSound(state.sounds, prefer, nextSeed())?.uri;
    if (uri) play_(uri);
  };
  const onPlayEvent = (type: string) => {
    const n = pet.name;
    const lines: Record<string, string> = {
      rest: night ? `${n} is resting under the stars.` : `${n} is resting in the ${playScene.title.toLowerCase()}.`,
      wander: `${n} trots off to explore.`,
      run: `${n} runs over.`,
      sniff: `${n} has found an interesting smell.`,
      bow: `${n} wants to play! Flick the ball.`,
      petted: `${n} leans into your hand.`,
      call: `${n} hears you and comes running!`,
      chase: `${n} races after the ball!`,
      carry: `${n} has it! Bringing it back…`,
      fetched: `${n} drops the ball at your feet. Again?`,
      sleep: `${n} is asleep. Stroke them to wake them.`,
      wake: `${n} wakes up, tail already wagging.`,
      treat: `${n} happily munches the ${lastTreat.current ?? "treat"}.`,
    };
    if (lines[type]) setPlayCaption(lines[type]);
    if (type === "call" || type === "fetched") sound(["bark", "happy"], true);
    if (type === "happy" || type === "petted" || type === "treat") sound(pet.species === "cat" ? ["purr", "meow"] : ["happy", "whine"], false);
  };

  const [restartKey, setRestartKey] = useState(0);
  const [holdUntil, setHoldUntil] = useState(0); // pause the life loop while a reaction plays out
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);

  // The life loop: walk to the next spot, then settle into what it's doing.
  useEffect(() => {
    if (!autoplay) return;
    const wait = Math.max(0, holdUntil - Date.now());
    const t = setTimeout(() => {
      const m = nextMoment({ ...ctx, seed: nextSeed() });
      const at = place(m.at);
      const moving = Math.hypot(at.x - live.at.x, at.depth - live.at.depth) > 0.03 && (real || m.pose !== "sleep");
      setLive({ at, pose: moving ? "walk" : m.pose, caption: m.caption, stayed: stayed(m.at), seed: nextSeed() });
      if (moving && m.pose !== "walk") {
        clearTimeout(settle.current);
        settle.current = setTimeout(() => setLive((l) => (l.at === at ? { ...l, pose: m.pose, seed: nextSeed() } : l)), walkTime(live.at, at));
      }
    }, wait + (live.pose === "walk" ? 4000 : 8000));
    return () => clearTimeout(t);
    // nextSeed only touches a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, ctx, live, holdUntil]);

  /** Act out a reaction where the pet is now: its clip from the first frame, with its sound. */
  const perform = (r: Reaction, at: Spot) => {
    const seed = nextSeed();
    setLive({ at, pose: r.pose, caption: r.caption, clips: r.clips, stayed: stayed(r.at), seed });
    setRestartKey((n) => n + 1);
    // Floating hearts suit the storybook pet; the real one just shows how it feels.
    if (r.hearts && !real) setHeartsKey((k) => (k ?? 0) + 1);
    if (!state.soundOn) return;
    // A bark clip brings its own bark; otherwise their recordings, then whatever the footage sounds like.
    const shown = pickVideoClip(state.clips, r.clips, seed);
    const recording = pickSound(state.sounds, r.sounds, nextSeed());
    const uri = shown?.action === "bark" && shown.audioUri ? shown.audioUri : (recording?.uri ?? shown?.audioUri);
    if (uri) play_(uri);
  };

  const respond = useCallback(
    (i: Interaction, treat?: string) => {
      const r = react(i, { name: pet.name, species: pet.species, here: live.at, toy, treat });
      if (play) {
        lastTreat.current = treat;
        setCommand({ kind: i, key: ++commandKey.current });
        return;
      }
      if (alive) {
        const ALIVE: Record<Interaction, AliveAction> = { pet: "happy", call: "bark", play: "play", treat: "eat" };
        if (!alivePet.run(ALIVE[i]) || !state.soundOn) return;
        // Their real voice: a bark from their own video if there is one, otherwise their recordings.
        const bark = i === "call" ? state.clips.find((c) => c.action === "bark" && c.audioUri)?.audioUri : undefined;
        const uri = bark ?? pickSound(state.sounds, r.sounds, nextSeed())?.uri;
        if (uri) play_(uri);
        return;
      }
      const at = place(r.at);
      clearTimeout(settle.current);
      // The real pet walks over first, then reacts; the storybook pet does both at once.
      const walk = real && Math.hypot(at.x - live.at.x, at.depth - live.at.depth) > 0.03 ? walkTime(live.at, at) : 0;
      setHoldUntil(Date.now() + walk + r.seconds * 1000);
      if (!walk) return perform(r, at);
      setLive({ at, pose: "walk", caption: r.caption, seed: nextSeed() });
      settle.current = setTimeout(() => perform(r, at), walk);
    },
    // nextSeed only touches a ref; place, walkTime and perform only read what's listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pet.name, pet.species, live.at, toy, state.soundOn, state.sounds, state.clips, alive, alivePet, play],
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

      {play ? (
        <>
          <PlayStage name={pet.name} play={play} scene={playScene} night={night} command={command} onEvent={onPlayEvent} />
          <View style={[s.row, { marginTop: 8 }]}>
            {SCENES.map((sc) => (
              <Chip key={sc.id} label={sc.title} on={sc.id === playScene.id} onPress={() => update((st) => (st.play ? { ...st, play: { ...st.play, scene: sc.id } } : st))} />
            ))}
          </View>
        </>
      ) : alive && aliveScene && aliveState ? (
        <AliveStage
          name={pet.name}
          scene={aliveScene}
          state={aliveState}
          garden={garden}
          night={night}
          loopUri={alivePet.loopUri}
          action={alivePet.action}
          onActionEnd={alivePet.onActionEnd}
          onPetPress={() => respond("pet")}
        />
      ) : (
        <GardenScene
          pet={pet}
          garden={garden}
          at={live.at}
          pose={live.pose}
          clip={clip}
          restartKey={restartKey}
          place={state.place}
          night={night}
          photos={state.photos}
          heartsKey={heartsKey}
          onPetPress={() => respond("pet")}
          onPhotoPress={setViewing}
        />
      )}
      {(clip || alive) && state.photos.length > 0 && (
        // In the photographed meadow the family's photos sit under the scene, like prints laid out.
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          {state.photos.slice(0, 5).map((p, i) => (
            <Pressable key={p.id} onPress={() => setViewing(p)} accessibilityLabel="Open photo" style={{ transform: [{ rotate: `${[-4, 3, -2, 4, -3][i]}deg` }] }}>
              <View style={{ backgroundColor: "#fffdf8", padding: 3, paddingBottom: 9, borderRadius: 2, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}>
                <Image source={{ uri: p.uri }} style={{ width: 46, height: 46 }} />
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={{ color: colors.ink, fontSize: 15, marginTop: 8, minHeight: 40 }} accessibilityLiveRegion="polite">
        {play ? (playCaption ?? `${pet.name} is here with you.`) : alive ? alivePet.caption : caption}
      </Text>
      {play && <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 2 }}>Stroke {pet.name} · tap the ground to call them over · flick the ball to throw it</Text>}
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        {play ? (
          <>✦ {pet.name}, from your {play.pet.from}, moving as a puppet on your phone. Imagined, not filmed.</>
        ) : alive ? (
          <>
            ✦ Brought to life by AI from your {state.alive?.pet?.from === "video" ? "video" : "photo"} of {pet.name}. Imagined, not filmed
            {state.sounds.length || state.clips.some((c) => c.audioUri) ? "; the voice is their own" : ""}.
          </>
        ) : (
          <>
            ✦ A simulation of {pet.name}
            {clip ? ", made from your own video" : ""}
            {state.sounds.length ? ", with your own recordings of their voice" : ""}.
          </>
        )}
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
