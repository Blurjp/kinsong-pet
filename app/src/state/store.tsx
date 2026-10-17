import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PetPhoto, PetProfile, SoundClip, Visit } from "@sinian/core";

/** Everything stays on the device. One pet per install for the prototype. */
export interface PetState {
  pet?: PetProfile;
  visits: Visit[];
  /** The family's own photos of the pet. */
  photos: PetPhoto[];
  /** The family's own recordings of the pet: barks, purrs, chirps. */
  sounds: SoundClip[];
  /** Play recordings when the pet reacts. */
  soundOn: boolean;
}

const KEY = "kinsong-pets/v1";
const EMPTY: PetState = { visits: [], photos: [], sounds: [], soundOn: true };

export async function loadState(): Promise<PetState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as PetState) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function saveState(s: PetState): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

export async function clearState(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/** Local calendar day, so remembrance days follow the owner's midnight. */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Ctx {
  state: PetState;
  ready: boolean;
  update: (fn: (draft: PetState) => PetState) => void;
  reset: () => void;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children, initial }: { children: ReactNode; initial?: Partial<PetState> }) {
  const [state, setState] = useState<PetState>(initial ? { ...EMPTY, ...initial } : EMPTY);
  const [ready, setReady] = useState(!!initial);

  useEffect(() => {
    if (initial) return;
    let live = true;
    loadState().then((s) => {
      if (!live) return;
      setState(s);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [initial]);

  const update = useCallback((fn: (draft: PetState) => PetState) => {
    setState((prev) => {
      const next = fn(prev);
      void saveState(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    void clearState();
    setState(EMPTY);
  }, []);

  return <StoreContext.Provider value={{ state, ready, update, reset }}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreContext);
  if (!c) throw new Error("useStore outside StoreProvider");
  return c;
}
