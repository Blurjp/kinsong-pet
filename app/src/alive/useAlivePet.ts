import { useEffect, useRef, useState } from "react";
import type { Species } from "@sinian/core";
import type { AliveAction, AliveSceneState } from "./types";

const VOICE: Record<Species, string> = { dog: "barks hello", cat: "meows hello", rabbit: "thumps a hello", bird: "chirps hello", other: "calls hello" };

function captionFor(action: AliveAction | "rest", name: string, species: Species, place: string, night: boolean): string {
  switch (action) {
    case "rest":
    case "idle":
      return night ? `${name} is resting under the stars.` : `${name} is resting in the ${place}.`;
    case "bark":
      return `${name} ${VOICE[species]}!`;
    case "walk":
      return `${name} wanders off for a sniff, then comes back.`;
    case "play":
      return `${name} is in a playful mood.`;
    case "happy":
      return `${name} leans into your hand.`;
    case "eat":
      return `${name} noses at something on the ground.`;
    case "lieDown":
      return `${name} curls up for a nap.`;
    case "sleep":
      return `${name} is fast asleep.`;
    case "getUp":
      return `${name} wakes up and stretches.`;
  }
}

/**
 * The life of a pet brought to life in a scene: it rests on a loop, now and
 * then wanders off and comes back, plays or noses at the ground, lies down to
 * sleep at night and gets up in the morning, and reacts when the family calls
 * or pets it. One action at a time; every action starts and ends on the
 * scene's key frame, so the player can join them seamlessly.
 */
export function useAlivePet({
  name,
  species,
  place,
  scene,
  night,
  autoplay,
}: {
  name: string;
  species: Species;
  place: string;
  scene: AliveSceneState | undefined;
  night: boolean;
  autoplay: boolean;
}) {
  const clips = scene?.clips ?? {};
  const [asleep, setAsleep] = useState(night && !!clips.sleep);
  const [action, setAction] = useState<{ uri: string; key: number; then?: string }>();
  const [caption, setCaption] = useState(() => captionFor(night && clips.sleep ? "sleep" : "rest", name, species, place, night));
  const playing = useRef(false);
  const count = useRef(0);
  // Asleep or awake changes only once lying down / getting up has finished, so the loop under it never jumps.
  const after = useRef<boolean | undefined>(undefined);

  const run = (wanted: AliveAction): boolean => {
    if (playing.current) return false;
    const a: AliveAction = asleep && wanted !== "getUp" ? "getUp" : wanted;
    const uri = clips[a];
    if (!uri) return false;
    after.current = a === "lieDown" ? true : a === "getUp" ? false : undefined;
    const then = a === "lieDown" ? clips.sleep : a === "getUp" ? clips.idle : undefined;
    playing.current = true;
    setAction({ uri, key: ++count.current, then });
    setCaption(captionFor(a, name, species, place, night));
    return true;
  };

  const onActionEnd = () => {
    playing.current = false;
    if (after.current !== undefined) {
      const sleeping = after.current;
      setAsleep(sleeping);
      setCaption(captionFor(sleeping ? "sleep" : "rest", name, species, place, night));
      after.current = undefined;
    }
  };

  // Life on its own: something every ten seconds or so, and sleep after dark.
  useEffect(() => {
    if (!autoplay || !scene) return;
    const t = setInterval(() => {
      if (playing.current) return;
      if (night && !asleep) return void run("lieDown");
      if (!night && asleep) return void run("getUp");
      if (asleep) return;
      const r = Math.random();
      if (r < 0.3) run("walk");
      else if (r < 0.5) run("play");
      else if (r < 0.7) run("eat");
      else setCaption(captionFor("rest", name, species, place, night));
    }, 10_000);
    return () => clearInterval(t);
    // run reads the latest clips and state through this render's closure; restart with them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, scene, night, asleep]);

  return { loopUri: (asleep ? clips.sleep : clips.idle) ?? "", action, caption, run, onActionEnd };
}
