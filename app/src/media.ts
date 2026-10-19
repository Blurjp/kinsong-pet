import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Directory, File, Paths } from "expo-file-system";
import { createAudioPlayer } from "expo-audio";
import { decode as decodeJpeg } from "jpeg-js";
import { base64ToBytes, coatColorsFromImage, type VideoClip } from "@sinian/core";
import { PetCutout } from "../modules/pet-cutout";

/**
 * Photos, recordings and video clips of the pet. Everything stays on the device:
 * native builds copy files into the app's private documents folder; the
 * web preview keeps small data URIs in local storage.
 */

const isWeb = Platform.OS === "web";
const MAX_WEB_AUDIO_BYTES = 1_500_000;
/** Longest clip the cut-out keeps, at the video's own frame rate (up to 30 fps). */
const CLIP_SECONDS = 8;

function mediaDir(): Directory {
  const d = new Directory(Paths.document, "pet-media");
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

function keepNative(srcUri: string, name: string): string {
  const dest = new File(mediaDir(), name);
  if (dest.exists) dest.delete();
  new File(srcUri).copy(dest);
  return dest.uri;
}

/** Let the owner choose photos; returns stored URIs (downscaled to 900 px wide). */
export async function pickPhotos(): Promise<string[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.9 });
  if (r.canceled) return [];
  const out: string[] = [];
  for (const [i, a] of r.assets.entries()) {
    const small = await manipulateAsync(a.uri, [{ resize: { width: 900 } }], { compress: 0.82, format: SaveFormat.JPEG, base64: isWeb });
    out.push(isWeb ? `data:image/jpeg;base64,${small.base64}` : keepNative(small.uri, `photo-${Date.now()}-${i}.jpg`));
  }
  return out;
}

async function blobToDataUri(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  if (blob.size > MAX_WEB_AUDIO_BYTES) throw new Error("That recording is too long for the web preview. Try a clip under about 30 seconds.");
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** Let the owner choose an audio recording of their pet; returns a stored URI. */
export async function pickRecording(): Promise<string | undefined> {
  const r = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
  const a = r.canceled ? undefined : r.assets[0];
  if (!a) return undefined;
  if (isWeb) return blobToDataUri(a.uri);
  const ext = a.name.split(".").pop() ?? "m4a";
  return keepNative(a.uri, `sound-${Date.now()}.${ext}`);
}

/** Remove a stored file or clip folder (no-op for web data URIs). */
export function forget(uri: string): void {
  if (isWeb || !uri.startsWith("file:")) return;
  try {
    const f = uri.endsWith("/") ? new Directory(uri) : new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

/**
 * Let the owner choose a short video of their pet (trimmed in the picker), and
 * cut the pet out of it on the phone. The garden then shows these real frames.
 */
export async function importVideoClip(onProgress?: (fraction: number) => void): Promise<Omit<VideoClip, "id" | "action"> | undefined> {
  if (!PetCutout) throw new Error("Video clips need the installed app. They don't work in the web preview or Expo Go.");
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsEditing: true, videoMaxDuration: CLIP_SECONDS });
  const a = r.canceled ? undefined : r.assets[0];
  if (!a) return undefined;
  const dir = new Directory(mediaDir(), `clip-${Date.now()}`);
  dir.create();
  const sub = onProgress ? PetCutout.addListener("onProgress", (e) => onProgress(e.progress)) : undefined;
  try {
    const out = await PetCutout.cutOut(a.uri, dir.uri, { maxSeconds: CLIP_SECONDS, maxFps: 30, size: 720 });
    // A trailing slash marks it as a folder for forget().
    return { dir: dir.uri.endsWith("/") ? dir.uri : `${dir.uri}/`, ...out };
  } catch (e) {
    dir.delete();
    throw e;
  } finally {
    sub?.remove();
  }
}

/** Coat and marking colours for the storybook pet, read from a photo. */
export async function coatFromPhoto(uri: string): Promise<{ coat: string; accent: string } | undefined> {
  const tiny = await manipulateAsync(uri, [{ resize: { width: 96 } }], { compress: 0.9, format: SaveFormat.JPEG, base64: true });
  if (!tiny.base64) return undefined;
  const img = decodeJpeg(base64ToBytes(tiny.base64), { useTArray: true, formatAsRGBA: true });
  return coatColorsFromImage(img);
}

/** Play one of the owner's recordings once. Failures are silent: sound is a bonus, never required. */
export function play(uri: string): void {
  try {
    const player = createAudioPlayer(uri);
    const sub = player.addListener("playbackStatusUpdate", (s) => {
      if (s.didJustFinish) {
        sub.remove();
        player.remove();
      }
    });
    player.play();
  } catch {
    // ignore
  }
}
