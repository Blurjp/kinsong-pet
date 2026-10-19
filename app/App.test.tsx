import { act, fireEvent, render, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PetsApp } from "./App";
import { GardenScreen } from "./src/screens/GardenScreen";
import { StoreProvider, today, type PetState } from "./src/state/store";
import * as media from "./src/media";

jest.mock("./src/media", () => ({
  pickPhotos: jest.fn(async () => ["file:///photos/max-1.jpg"]),
  pickRecording: jest.fn(async () => "file:///sounds/bark.m4a"),
  pickPlacePhoto: jest.fn(async () => "file:///places/backyard.jpg"),
  importVideoClip: jest.fn(async () => ({
    dir: "file:///clips/new/",
    videoUri: "file:///clips/new/clip.mov",
    posterUri: "file:///clips/new/poster.png",
    width: 600,
    height: 540,
    seconds: 6,
    cutout: true,
    closeUp: false,
    facing: "right",
  })),
  coatFromPhoto: jest.fn(async () => ({ coat: "#d6a866", accent: "#5c3a22" })),
  play: jest.fn(),
  forget: jest.fn(),
}));

const barkClip = {
  id: "c1",
  action: "bark" as const,
  dir: "file:///clips/c1/",
  videoUri: "file:///clips/c1/clip.mov",
  posterUri: "file:///clips/c1/poster.png",
  width: 600,
  height: 540,
  seconds: 6,
  cutout: true,
  closeUp: false,
  facing: "right" as const,
  audioUri: "file:///clips/c1/sound.m4a",
};

const played = media.play as jest.Mock;
const t = today();
const oneYearAgo = `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`;

const seeded = (extra: Partial<PetState> = {}): Partial<PetState> => ({
  pet: {
    name: "Max",
    species: "dog",
    coat: "#e0b67a",
    passed: oneYearAgo,
    favorites: { toys: ["squeaky duck"], treats: ["peanut butter"], spots: ["the back porch"] },
    traits: ["goofy"],
    wishes: [{ id: "w1", text: "Chase the seagulls at the beach" }],
  },
  visits: [],
  sounds: [
    { id: "s1", uri: "file:///bark.m4a", tag: "bark" },
    { id: "s2", uri: "file:///whine.m4a", tag: "whine" },
  ],
  ...extra,
});

/** The pet layer appears once the scene knows its size. */
async function layout(name = "Max") {
  await fireEvent(screen.getByLabelText(new RegExp(`^${name}'s garden`)), "layout", { nativeEvent: { layout: { width: 400, height: 300 } } });
}

beforeEach(() => played.mockClear());

describe("Kinsong Pets", () => {
  it("starts with setup, and only saves once name and the passing day are valid", async () => {
    await render(<PetsApp initial={{ visits: [] }} />);
    expect(screen.getByText("A garden for your friend")).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText("Max"), "Luna");
    await fireEvent.changeText(screen.getByPlaceholderText("2025-10-20"), "2025-13");
    expect(screen.getByText("Please use the format YYYY-MM-DD.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Plant their garden"));
    expect(screen.queryByText("Pet Luna")).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText("2025-10-20"), "2025-10-20");
    await fireEvent.press(screen.getByText("Plant their garden"));
    expect(screen.getByText("🤚  Pet Luna")).toBeTruthy();
  });

  it("shows the anniversary nudge and an imagined note on the day", async () => {
    await render(<PetsApp initial={seeded()} />);
    expect(screen.getByText("One year since Max crossed the bridge. Would you like to stop by the garden?")).toBeTruthy();
    expect(screen.getByText(/Imagined, from the things you told us/)).toBeTruthy();
    expect(screen.getByText(/A simulation of Max, with your own recordings of their voice/)).toBeTruthy();
  });

  it("comes running when called, in their own voice", async () => {
    await render(<PetsApp initial={seeded()} />);
    await fireEvent.press(screen.getByText("📣  Call Max"));
    expect(screen.getByText("Max hears your voice and comes running!")).toBeTruthy();
    expect(played).toHaveBeenCalledWith("file:///bark.m4a");
  });

  it("barks with the sound from their own video when called", async () => {
    await render(<PetsApp initial={seeded({ clips: [barkClip] })} />);
    await layout();
    await fireEvent.press(screen.getByText("📣  Call Max"));
    expect(played).toHaveBeenCalledWith("file:///clips/c1/sound.m4a");
    expect(screen.getByText(/A simulation of Max, made from your own video/)).toBeTruthy();
  });

  it("lives in the photographed meadow once there's footage, with the family's photos laid out below", async () => {
    await render(<PetsApp initial={seeded({ clips: [barkClip], photos: [{ id: "p1", uri: "file:///photos/max-1.jpg", addedOn: t }] })} />);
    await layout();
    await fireEvent.press(screen.getByLabelText("Open photo"));
    expect(played).toHaveBeenCalled(); // the photo viewer plays one of their sounds
  });

  it("walks over at a real pace before barking, when there's footage of it walking", async () => {
    jest.useFakeTimers();
    try {
      const walkClip = { ...barkClip, id: "c2", action: "walk" as const, audioUri: undefined };
      const s = seeded({ clips: [barkClip, walkClip] });
      await render(
        <StoreProvider initial={s}>
          <GardenScreen pet={s.pet!} hour={14} autoplay={false} />
        </StoreProvider>,
      );
      await fireEvent.press(screen.getByText("📣  Call Max"));
      expect(played).not.toHaveBeenCalled(); // still on its way
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      expect(played).toHaveBeenCalledWith("file:///clips/c1/sound.m4a");
    } finally {
      jest.useRealTimers();
    }
  });

  it("can be petted by tapping them in the garden", async () => {
    await render(<PetsApp initial={seeded()} />);
    await layout();
    await fireEvent.press(screen.getByLabelText("Pet Max"));
    expect(screen.getByText("Max leans into your hand, tail going a mile a minute.")).toBeTruthy();
    expect(played).toHaveBeenCalledWith("file:///whine.m4a"); // no "happy" clip, so the next preference
  });

  it("fetches their toy, and eats the treat you give", async () => {
    await render(<PetsApp initial={seeded()} />);
    await fireEvent.press(screen.getByText("🎾  Play with the squeaky duck"));
    expect(screen.getByText("Max chases the squeaky duck and brings it right back to you.")).toBeTruthy();
    await fireEvent.press(screen.getByText("🦴  Give a treat"));
    await fireEvent.press(screen.getByText("peanut butter"));
    expect(screen.getByText("Max happily munches the peanut butter.")).toBeTruthy();
    const saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.visits).toMatchObject([{ kind: "treat", treat: "peanut butter", on: t }]);
  });

  it("stays quiet when sounds are off", async () => {
    await render(<PetsApp initial={seeded({ soundOn: false })} />);
    await fireEvent.press(screen.getByText("📣  Call Max"));
    expect(played).not.toHaveBeenCalled();
  });

  it("sleeps under the stars at night", async () => {
    const s = seeded();
    await render(
      <StoreProvider initial={s}>
        <GardenScreen pet={s.pet!} hour={23} autoplay={false} />
      </StoreProvider>,
    );
    expect(screen.getByLabelText("Max's garden at night")).toBeTruthy();
    expect(screen.getByText("Max is fast asleep under the stars, curled up by the memory tree.")).toBeTruthy();
  });

  it("plants a flower and keeps it, saved on the device", async () => {
    await render(<PetsApp initial={seeded()} />);
    expect(screen.getByText(/0 flowers planted/)).toBeTruthy();
    await fireEvent.press(screen.getByText("🌼  Plant a flower"));
    await fireEvent.press(screen.getByText("Sunflower"));
    expect(screen.getByText(/1 flower planted/)).toBeTruthy();
    const saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.visits).toMatchObject([{ kind: "flower", flower: "sunflower", on: t }]);
  });

  it("writes a letter into the mailbox and the journal", async () => {
    await render(<PetsApp initial={seeded()} />);
    await fireEvent.press(screen.getByText("✉️  Write a letter"));
    await fireEvent.changeText(screen.getByPlaceholderText("Today I walked past the park and…"), "Miss you buddy");
    await fireEvent.press(screen.getByText("Put it in the mailbox"));
    await fireEvent.press(screen.getByText("Days"));
    expect(screen.getByText("✉️ “Miss you buddy”")).toBeTruthy();
  });

  it("labels wish postcards as imagined and lets the family mark them done in real life", async () => {
    await render(<PetsApp initial={seeded()} />);
    await fireEvent.press(screen.getByText("Wishes"));
    expect(screen.getByText("Today Max finally got to chase the seagulls at the beach.")).toBeTruthy();
    expect(screen.getByText(/Imagined postcard/)).toBeTruthy();
    await fireEvent.press(screen.getByText("We did this for Max in real life"));
    expect(screen.getByText(`You did this for Max on ${t}.`)).toBeTruthy();
  });
});

describe("Memories", () => {
  it("lets the real pet live somewhere it loved, and go back to the meadow", async () => {
    await render(<PetsApp initial={seeded({ clips: [barkClip] })} />);
    await fireEvent.press(screen.getByText("Memories"));
    await fireEvent.press(screen.getByText("Choose a photo"));
    expect(await screen.findByText(/Drag the line to where the ground meets the distance, so Max/)).toBeTruthy();
    let saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.place).toEqual({ uri: "file:///places/backyard.jpg", horizon: 0.55 });
    expect(screen.getByLabelText(/Their place/)).toBeTruthy();
    await fireEvent.press(screen.getByText("Back to the meadow"));
    saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.place).toBeUndefined();
    expect(media.forget).toHaveBeenCalledWith("file:///places/backyard.jpg");
  });

  it("adds a video clip and lets you tag what they're doing and which way they face", async () => {
    await render(<PetsApp initial={seeded()} />);
    await fireEvent.press(screen.getByText("Memories"));
    await fireEvent.press(screen.getByText("Add a video"));
    expect(await screen.findByText(/Max is in the garden now, just as in your video/)).toBeTruthy();
    let saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.clips).toMatchObject([{ action: "sit", videoUri: "file:///clips/new/clip.mov" }]);
    await fireEvent.press(screen.getByText("Playing"));
    saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.clips[0]!.action).toBe("play");
    await fireEvent.press(screen.getByText("Facing right →"));
    saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.clips[0]!.facing).toBe("left");
    await fireEvent.press(screen.getAllByText("Remove")[0]!); // the video card comes before the recordings
    expect(media.forget).toHaveBeenCalledWith("file:///clips/new/");
  });

  it("adds photos, takes the pet's colours from the first one, and hangs it in the garden", async () => {
    await render(<PetsApp initial={seeded({ sounds: [] })} />);
    await fireEvent.press(screen.getByText("Memories"));
    await fireEvent.press(screen.getByText("Add photos"));
    expect(await screen.findByText(/colours now come from your photo/)).toBeTruthy();
    const saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.photos).toMatchObject([{ uri: "file:///photos/max-1.jpg" }]);
    expect(saved.pet).toMatchObject({ coat: "#d6a866", accent: "#5c3a22" });
  });

  it("adds a recording tagged for the species, lets you re-tag it, and uses it in the garden", async () => {
    await render(<PetsApp initial={seeded({ sounds: [] })} />);
    await fireEvent.press(screen.getByText("Memories"));
    await fireEvent.press(screen.getByText("Add a recording"));
    expect(await screen.findByText("Recording 1")).toBeTruthy();
    let saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.sounds).toMatchObject([{ uri: "file:///sounds/bark.m4a", tag: "bark" }]);
    await fireEvent.press(screen.getByText("Happy noise"));
    saved = JSON.parse((await AsyncStorage.getItem("kinsong-pets/v1"))!) as PetState;
    expect(saved.sounds[0]!.tag).toBe("happy");
    await fireEvent.press(screen.getByText("Garden"));
    await fireEvent.press(screen.getByText("🤚  Pet Max"));
    expect(played).toHaveBeenCalledWith("file:///sounds/bark.m4a");
  });
});
