import { Directory, File, Paths } from "expo-file-system";
import type { VideoClip } from "@sinian/core";
import { PetCutout } from "../../modules/pet-cutout";

/** The pet ready to play: its cut-out photo and the skeleton the puppet bends along. */
export interface PlayState {
  pet: { uri: string; width: number; height: number; from: "photo" | "video" };
  rig: Record<string, number[]>;
  /** Optional: a photo of them asleep, for night time (a standing photo can't be bent into lying down). */
  asleep?: { uri: string; width: number; height: number; facesRight: boolean };
  /** The scene it plays in. */
  scene?: string;
}

function playDir(): Directory {
  const d = new Directory(Paths.document, "pet-media", "play");
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/** From a photo: cut the pet out and find its skeleton, on the phone. */
export async function playFromPhoto(photoUri: string): Promise<PlayState> {
  if (!PetCutout) throw new Error("Playing needs the installed app.");
  const out = new File(playDir(), `pet-${Date.now()}.png`);
  const cut = await PetCutout.cutOutPhoto(photoUri, out.uri);
  if (cut.closeUp) {
    out.delete();
    throw new Error("That photo is a close-up. Choose one from the side that shows them standing, nose to tail.");
  }
  try {
    return { pet: { uri: cut.uri, width: cut.width, height: cut.height, from: "photo" }, rig: await PetCutout.petRig(cut.uri) };
  } catch (e) {
    out.delete();
    throw e;
  }
}

/** From one of their videos: a whole-body frame, already cut out. */
export async function playFromClip(clips: readonly VideoClip[]): Promise<PlayState | undefined> {
  if (!PetCutout) throw new Error("Playing needs the installed app.");
  const clip = clips.find((c) => c.cutout && !c.closeUp && (c.action === "walk" || c.action === "sit")) ?? clips.find((c) => c.cutout && !c.closeUp);
  if (!clip) return undefined;
  return { pet: { uri: clip.posterUri, width: clip.width, height: clip.height, from: "video" }, rig: await PetCutout.petRig(clip.posterUri) };
}

/** A photo of them asleep, cut out; which way it faces comes from its skeleton when that can be found. */
export async function asleepFromPhoto(photoUri: string): Promise<NonNullable<PlayState["asleep"]>> {
  if (!PetCutout) throw new Error("Playing needs the installed app.");
  const out = new File(playDir(), `asleep-${Date.now()}.png`);
  const cut = await PetCutout.cutOutPhoto(photoUri, out.uri);
  let facesRight = true;
  try {
    const rig = await PetCutout.petRig(cut.uri);
    const nose = rig.nose?.[0], tail = (rig.tail_bottom ?? rig.left_back_paw ?? rig.right_back_paw)?.[0];
    if (nose !== undefined && tail !== undefined) facesRight = nose > tail;
  } catch {
    // a curled-up pet often hides its skeleton; keep it as it is
  }
  return { uri: cut.uri, width: cut.width, height: cut.height, facesRight };
}
