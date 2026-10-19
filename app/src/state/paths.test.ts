import { relocate, relocateState } from "./paths";
import type { PetState } from "./store";

const now = "file:///var/mobile/Containers/Data/Application/NEW-ID/Documents/";
const old = (path: string) => `file:///var/mobile/Containers/Data/Application/OLD-ID/Documents/${path}`;

it("re-points stored media at the app's current Documents folder after iOS moves it", () => {
  expect(relocate(old("pet-media/photo-1.jpg"), now)).toBe(`${now}pet-media/photo-1.jpg`);
  expect(relocate("data:image/jpeg;base64,xyz", now)).toBe("data:image/jpeg;base64,xyz");
  expect(relocate(old("pet-media/x.jpg"), "")).toBe(old("pet-media/x.jpg")); // nowhere to move it to
});

it("moves every kind of media the family added", () => {
  const s: PetState = {
    visits: [],
    soundOn: true,
    photos: [{ id: "p", uri: old("pet-media/p.jpg"), addedOn: "2026-01-01" }],
    sounds: [{ id: "s", uri: old("pet-media/s.m4a"), tag: "bark" }],
    clips: [
      {
        id: "c",
        action: "bark",
        dir: old("pet-media/clip-1/"),
        videoUri: old("pet-media/clip-1/clip.mov"),
        posterUri: old("pet-media/clip-1/poster.png"),
        audioUri: old("pet-media/clip-1/sound.m4a"),
        width: 1,
        height: 1,
        seconds: 1,
        cutout: true,
        closeUp: false,
        facing: "right",
      },
    ],
    place: { uri: old("pet-media/place.jpg"), horizon: 0.5 },
  };
  const moved = JSON.stringify(relocateState(s, now));
  expect(moved).not.toContain("OLD-ID");
  expect(moved.match(/NEW-ID/g)).toHaveLength(7);
});
