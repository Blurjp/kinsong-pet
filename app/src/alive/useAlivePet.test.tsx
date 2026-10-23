import { act, renderHook } from "@testing-library/react-native";
import { useAlivePet } from "./useAlivePet";
import { ALIVE_ACTIONS, type AliveSceneState } from "./types";

const scene: AliveSceneState = { key: "key.jpg", clips: Object.fromEntries(ALIVE_ACTIONS.map((a) => [a, `${a}.mp4`])), tasks: {} };
const setup = async (night = false) =>
  await renderHook((p: { night: boolean }) => useAlivePet({ name: "Max", species: "dog", place: "summer meadow", scene, night: p.night, autoplay: false }), { initialProps: { night } });

it("rests on the idle loop, and barks when called, back to resting after", async () => {
  const { result } = await setup();
  expect(result.current.loopUri).toBe("idle.mp4");
  expect(result.current.caption).toBe("Max is resting in the summer meadow.");
  await act(async () => void result.current.run("bark"));
  expect(result.current.action).toEqual({ uri: "bark.mp4", key: 1, then: undefined });
  expect(result.current.caption).toBe("Max barks hello!");
  // one thing at a time
  await act(async () => void expect(result.current.run("play")).toBe(false));
  await act(async () => result.current.onActionEnd());
  await act(async () => void expect(result.current.run("play")).toBe(true));
});

it("lies down into the sleeping loop, and a call wakes it first", async () => {
  const { result } = await setup();
  await act(async () => void result.current.run("lieDown"));
  expect(result.current.action).toMatchObject({ uri: "lieDown.mp4", then: "sleep.mp4" });
  expect(result.current.loopUri).toBe("idle.mp4"); // unchanged until lying down has finished
  await act(async () => result.current.onActionEnd());
  expect(result.current.loopUri).toBe("sleep.mp4");
  expect(result.current.caption).toBe("Max is fast asleep.");
  await act(async () => void result.current.run("bark"));
  expect(result.current.action).toMatchObject({ uri: "getUp.mp4", then: "idle.mp4" });
  await act(async () => result.current.onActionEnd());
  expect(result.current.loopUri).toBe("idle.mp4");
});

it("is already asleep when the family visits at night", async () => {
  const { result } = await setup(true);
  expect(result.current.loopUri).toBe("sleep.mp4");
  expect(result.current.caption).toBe("Max is fast asleep.");
});
