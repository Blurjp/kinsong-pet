import { advance } from "./make";
import { SCENES } from "./scenes";
import { ALIVE_ACTIONS, sceneProgress, type AliveSceneState } from "./types";
import { clipStatus, requestClip } from "./client";
import { PetCutout } from "../../modules/pet-cutout";

jest.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ downloadAsync: async () => undefined, localUri: "file:///bundle/meadow.jpg" }) } }));
jest.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === "string" ? p : p.uri.replace(/\/$/, ""))).join("/") + "/";
    }
    create() {}
    delete() {}
  }
  class File {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = dir.uri + name;
    }
    async base64() {
      return "QUJD";
    }
    delete() {}
    static downloadFileAsync = jest.fn(async (url: string, to: { uri: string }) => ({ uri: to.uri }));
  }
  return { Directory, File, Paths: { document: { uri: "file:///docs/" } } };
});
jest.mock("../../modules/pet-cutout", () => ({
  PetCutout: {
    composeKeyframe: jest.fn(async (_pet: string, _scene: string, out: string) => out),
    lastFrame: jest.fn(async (_v: string, out: string) => out),
  },
}));
jest.mock("./client", () => ({ requestClip: jest.fn(), clipStatus: jest.fn() }));

const requested = requestClip as jest.Mock;
const status = clipStatus as jest.Mock;
const pet = { uri: "file:///docs/pet.png", width: 400, height: 300, from: "photo" as const };
const meadow = SCENES[0]!;

beforeEach(() => {
  requested.mockReset().mockImplementation(async (action: string) => `task-${action}`);
  status.mockReset().mockResolvedValue({ status: "processing", progress: 10 });
});

/** Run advance until nothing changes, as the app's worker does. */
async function settle(s: AliveSceneState): Promise<AliveSceneState> {
  for (let i = 0; i < 20; i++) {
    const next = await advance("dog", pet, meadow, s);
    if (JSON.stringify(next) === JSON.stringify(s)) return next;
    s = next;
  }
  return s;
}

it("makes a whole scene: key frame, seven clips from it, then sleeping from where lying down ended", async () => {
  let s = await advance("dog", pet, meadow, { clips: {}, tasks: {} });
  expect(s.key).toMatch(/^file:\/\/\/docs\/pet-media\/alive\/meadow\/key-\d+\.jpg$/);
  expect(PetCutout!.composeKeyframe).toHaveBeenCalledWith(pet.uri, "file:///bundle/meadow.jpg", s.key, meadow.feet.x, meadow.feet.y, meadow.height);

  s = await settle(s); // everything is still being made
  expect(Object.keys(s.tasks).sort()).toEqual(["bark", "eat", "happy", "idle", "lieDown", "play", "walk"]);
  expect(requested).toHaveBeenCalledWith("walk", "dog", "data:image/jpeg;base64,QUJD", undefined);

  status.mockImplementation(async (id: string) => ({ status: "success", videoURL: `https://vm.runware.ai/${id}.mp4`, cost: 0.5 }));
  s = await settle(s);
  expect(s.sleepKey).toBe("file:///docs/pet-media/alive/meadow/sleep-key.jpg");
  expect(requested).toHaveBeenCalledWith("getUp", "dog", "data:image/jpeg;base64,QUJD", "data:image/jpeg;base64,QUJD");
  expect(sceneProgress(s)).toEqual({ done: ALIVE_ACTIONS.length, total: ALIVE_ACTIONS.length, ready: true });
  expect(s.tasks).toEqual({});
  expect(s.cost).toBeCloseTo(0.5 * ALIVE_ACTIONS.length);
});

it("stops on a failed clip instead of trying again and spending more", async () => {
  status.mockResolvedValue({ status: "error", message: "Insufficient credits" });
  const s = await settle({ key: "file:///docs/key.jpg", clips: {}, tasks: {} });
  expect(s.error).toBe("Couldn't make the idle clip: Insufficient credits");
  const calls = requested.mock.calls.length;
  await advance("dog", pet, meadow, s);
  expect(requested.mock.calls.length).toBe(calls);
});
