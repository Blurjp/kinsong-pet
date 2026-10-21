import { Paths } from "expo-file-system";
import type { PetState } from "./store";

/**
 * iOS can move an app's folder when it is reinstalled or updated, so a stored
 * file:// URI may point at a folder that no longer exists. Media lives under
 * Documents, so on load every stored URI is re-pointed at the current one.
 */
export function relocate(uri: string, documents = currentDocuments()): string {
  const at = uri.indexOf("/Documents/");
  if (!documents || !uri.startsWith("file://") || at < 0) return uri;
  return documents.replace(/\/?$/, "/") + uri.slice(at + "/Documents/".length);
}

function currentDocuments(): string | undefined {
  try {
    return Paths.document.uri;
  } catch {
    return undefined; // web, tests
  }
}

export function relocateState(s: PetState, documents = currentDocuments()): PetState {
  if (!documents) return s;
  const r = (uri: string) => relocate(uri, documents);
  return {
    ...s,
    photos: s.photos.map((p) => ({ ...p, uri: r(p.uri) })),
    sounds: s.sounds.map((c) => ({ ...c, uri: r(c.uri) })),
    clips: s.clips.map((c) => ({ ...c, dir: r(c.dir), videoUri: r(c.videoUri), posterUri: r(c.posterUri), audioUri: c.audioUri && r(c.audioUri) })),
    place: s.place && { ...s.place, uri: r(s.place.uri) },
    alive: s.alive && {
      ...s.alive,
      pet: s.alive.pet && { ...s.alive.pet, uri: r(s.alive.pet.uri) },
      scenes: Object.fromEntries(
        Object.entries(s.alive.scenes).map(([id, sc]) => [
          id,
          {
            ...sc,
            key: sc.key && r(sc.key),
            sleepKey: sc.sleepKey && r(sc.sleepKey),
            clips: Object.fromEntries(Object.entries(sc.clips).map(([a, uri]) => [a, uri && r(uri)])),
          },
        ]),
      ),
    },
  };
}
