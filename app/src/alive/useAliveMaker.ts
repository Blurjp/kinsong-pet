import { useEffect } from "react";
import { useStore } from "../state/store";
import { advance } from "./make";
import { sceneById } from "./scenes";
import { sceneProgress } from "./types";

/**
 * Keeps any scene the family asked for moving along while the app is open, and
 * picks up where it left off on the next launch. Saves only when something
 * actually changed, so waiting on the video model is a quiet poll, not a loop.
 */
export function useAliveMaker(): void {
  const { state, ready, update } = useStore();
  const alive = state.alive;
  const species = state.pet?.species;

  useEffect(() => {
    if (!ready || !alive?.consent || !alive.pet || !species) return;
    const pet = alive.pet;
    const waiting = Object.entries(alive.scenes).filter(([, s]) => !s.error && !sceneProgress(s).ready);
    if (!waiting.length) return;
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      for (const [id, s] of waiting) {
        const scene = sceneById(id);
        if (!scene) continue;
        const next = await advance(species, pet, scene, s);
        if (stopped) break;
        if (JSON.stringify(next) === JSON.stringify(s)) continue;
        update((st) => (st.alive ? { ...st, alive: { ...st.alive, scenes: { ...st.alive.scenes, [id]: next } } } : st));
        break; // the saved change restarts this effect with fresh state
      }
      busy = false;
    };
    void tick();
    const timer = setInterval(() => void tick(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [ready, alive, species, update]);
}
