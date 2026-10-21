/**
 * What "bring to life" keeps for a pet. Everything here is on the phone: the
 * cut-out, the key frame per scene, and the generated clips once downloaded.
 * Only the key frames are ever sent off (to our server, then the video model),
 * and only after the family has agreed.
 */

/** The clips each scene gets. All but lying down start and end on the scene's key frame. */
export const ALIVE_ACTIONS = ["idle", "bark", "walk", "play", "happy", "eat", "lieDown", "sleep", "getUp"] as const;
export type AliveAction = (typeof ALIVE_ACTIONS)[number];
/** Made straight from the key frame; sleeping and getting up wait for lying down's last frame. */
export const FIRST_ROUND: readonly AliveAction[] = ["idle", "bark", "walk", "play", "happy", "eat", "lieDown"];

export interface AliveSceneState {
  /** The pet standing in the scene: where every clip starts and ends. */
  key?: string;
  /** Lying down's last frame: where sleeping starts and ends. */
  sleepKey?: string;
  /** Downloaded clips. */
  clips: Partial<Record<AliveAction, string>>;
  /** Clips still being made, by server task id. */
  tasks: Partial<Record<AliveAction, string>>;
  error?: string;
  /** What the clips have cost so far, in US dollars, as the video service reported it. */
  cost?: number;
}

export interface AliveState {
  /** The family agreed to send the pet's picture to be brought to life. */
  consent: boolean;
  /** The pet cut out of their photo (or a frame of their video), on transparency. */
  pet?: { uri: string; width: number; height: number; from: "photo" | "video" };
  /** The scene shown in the garden. */
  scene?: string;
  scenes: Record<string, AliveSceneState>;
}

export const NO_ALIVE: AliveState = { consent: false, scenes: {} };

export function sceneProgress(s: AliveSceneState | undefined): { done: number; total: number; ready: boolean } {
  const done = s ? ALIVE_ACTIONS.filter((a) => s.clips[a]).length : 0;
  return { done, total: ALIVE_ACTIONS.length, ready: done === ALIVE_ACTIONS.length };
}
