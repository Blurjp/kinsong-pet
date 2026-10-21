import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import type { Species, VideoClip } from "@sinian/core";
import { PetCutout } from "../../modules/pet-cutout";
import { clipStatus, requestClip } from "./client";
import { FIRST_ROUND, type AliveAction, type AliveSceneState, type AliveState } from "./types";
import type { AliveScene } from "./scenes";

/**
 * Making a scene, one step at a time. `advance` is safe to call again and
 * again (the app does, every few seconds, while a scene is being made, and on
 * the next launch if it was closed half way): each call moves the scene on by
 * whatever is ready and returns the new state to save. A failed clip stops
 * the scene with an error instead of quietly retrying and spending more.
 */

function aliveDir(...parts: string[]): Directory {
  const d = new Directory(Paths.document, "pet-media", "alive", ...parts);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/** The pet cut out of a still photo. Needs the whole pet in view, to stand it in a scene. */
export async function petFromPhoto(photoUri: string): Promise<NonNullable<AliveState["pet"]>> {
  if (!PetCutout) throw new Error("Bringing to life needs the installed app.");
  const out = new File(aliveDir(), `pet-${Date.now()}.png`);
  const cut = await PetCutout.cutOutPhoto(photoUri, out.uri);
  if (cut.closeUp) {
    out.delete();
    throw new Error("That photo is a close-up. Choose one that shows them from head to paws, so they can stand in the scene.");
  }
  return { uri: cut.uri, width: cut.width, height: cut.height, from: "photo" };
}

/** The pet from one of their video clips: its first frame, already cut out. */
export function petFromClip(clips: readonly VideoClip[]): NonNullable<AliveState["pet"]> | undefined {
  const clip = clips.find((c) => c.cutout && !c.closeUp && c.action !== "walk") ?? clips.find((c) => c.cutout && !c.closeUp);
  return clip && { uri: clip.posterUri, width: clip.width, height: clip.height, from: "video" };
}

async function dataUri(uri: string): Promise<string> {
  return `data:image/jpeg;base64,${await new File(uri).base64()}`;
}

async function sceneFile(scene: AliveScene): Promise<string> {
  const a = Asset.fromModule(scene.image);
  await a.downloadAsync();
  if (!a.localUri) throw new Error("Couldn't open that scene.");
  return a.localUri;
}

/** Move a scene on by one round. */
export async function advance(species: Species, pet: NonNullable<AliveState["pet"]>, scene: AliveScene, s: AliveSceneState): Promise<AliveSceneState> {
  if (!PetCutout) throw new Error("Bringing to life needs the installed app.");
  if (s.error) return s;
  const dir = aliveDir(scene.id);
  const next: AliveSceneState = { ...s, clips: { ...s.clips }, tasks: { ...s.tasks } };

  try {
    if (!next.key) {
      next.key = await PetCutout.composeKeyframe(pet.uri, await sceneFile(scene), new File(dir, `key-${Date.now()}.jpg`).uri, scene.feet.x, scene.feet.y, scene.height);
      return next;
    }

    const ask = async (action: AliveAction, first: string, last?: string) => {
      next.tasks[action] = await requestClip(action, species, await dataUri(first), last && (await dataUri(last)));
    };
    for (const action of FIRST_ROUND) {
      if (!next.clips[action] && !next.tasks[action]) await ask(action, next.key);
    }
    if (next.clips.lieDown && !next.sleepKey) {
      next.sleepKey = await PetCutout.lastFrame(next.clips.lieDown, new File(dir, "sleep-key.jpg").uri);
    }
    if (next.sleepKey) {
      if (!next.clips.sleep && !next.tasks.sleep) await ask("sleep", next.sleepKey);
      if (!next.clips.getUp && !next.tasks.getUp) await ask("getUp", next.sleepKey, next.key);
    }

    for (const [action, id] of Object.entries(next.tasks) as [AliveAction, string][]) {
      const status = await clipStatus(id);
      if (status.status === "processing") continue;
      delete next.tasks[action];
      if (status.status === "error") {
        next.error = `Couldn't make the ${action} clip: ${status.message}`;
        return next;
      }
      next.cost = (next.cost ?? 0) + (status.cost ?? 0);
      const file = new File(dir, `${action}-${Date.now()}.mp4`);
      next.clips[action] = (await File.downloadFileAsync(status.videoURL, file)).uri;
    }
  } catch (e) {
    next.error = e instanceof Error ? e.message : String(e);
  }
  return next;
}

/** Forget a scene's clips and key frame, to make it again (or because the pet changed). */
export function forgetScene(sceneId: string): void {
  try {
    const d = new Directory(Paths.document, "pet-media", "alive", sceneId);
    if (d.exists) d.delete();
  } catch {
    // already gone
  }
}
