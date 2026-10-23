import { Asset } from "expo-asset";
import { occasionTitle, upcomingOccasions, type ClipAction, type PetProfile, type VideoClip } from "@sinian/core";
import { PetCutout } from "../modules/pet-cutout";

/**
 * Keep the home-screen widget in step with the garden: the pet's first frame
 * from its own video, standing in its place (the meadow, or the family's own
 * photo), and the remembrance days ahead. Only on iOS builds with the native
 * module; failures are silent, since the widget is a bonus.
 */
/** Which clip's first frame to show: a calm, whole pet reads best; a frozen mid-stride walk worst. */
const STILL_ORDER: ClipAction[] = ["sit", "sleep", "play", "bark", "eat", "walk"];
function stillPicture(clips: readonly VideoClip[]): VideoClip | undefined {
  const cut = clips.filter((c) => c.cutout);
  const rank = (c: VideoClip) => (c.closeUp ? 10 : 0) + STILL_ORDER.indexOf(c.action);
  return [...cut].sort((a, b) => rank(a) - rank(b))[0];
}

export async function refreshWidget(pet: PetProfile | undefined, clips: readonly VideoClip[], place: { uri: string } | undefined, today: string): Promise<void> {
  if (!PetCutout || !pet) return;
  try {
    const days = upcomingOccasions(pet, today, 120).map((o) => ({ date: o.on, title: occasionTitle(pet, o) }));
    const clip = stillPicture(clips);
    let background = place?.uri ?? null;
    if (!background) {
      const meadow = Asset.fromModule(require("../assets/garden/meadow-day.jpg"));
      await meadow.downloadAsync();
      background = meadow.localUri ?? null;
    }
    await PetCutout.updateWidget({ name: pet.name, days }, background, clip?.posterUri ?? null, !!clip?.closeUp);
  } catch {
    // ignore
  }
}
