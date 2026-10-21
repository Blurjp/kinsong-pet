import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { framesFor, prompt, type Env } from "../src/index";

const env: Env = { RUNWARE_API_KEY: "rw-key", APP_TOKEN: "app-token-123", VIDEO_MODEL: "bytedance:seedance@2.5", VIDEO_RESOLUTION: "720p" };
const jpeg = "data:image/jpeg;base64,/9j/AAAA";
const call = (path: string, init: RequestInit = {}, e: Env = env) =>
  worker.fetch(new Request(`https://alive.test${path}`, { ...init, headers: { authorization: "Bearer app-token-123", "content-type": "application/json", ...init.headers } }), e);
const post = (body: unknown, e?: Env) => call("/v1/clips", { method: "POST", body: JSON.stringify(body) }, e);

/** A fake Runware: records the tasks it was sent and answers like the real API. */
function fakeRunware(answer: (task: Record<string, unknown>) => Record<string, unknown> | { error: string }) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.runware.ai/v1");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer rw-key");
    const tasks = JSON.parse(String(init.body)) as Record<string, unknown>[];
    sent.push(...tasks);
    const results = tasks.map((t) => ({ t, r: answer(t) }));
    return new Response(JSON.stringify({
      data: results.filter((x) => !("error" in x.r)).map((x) => ({ taskType: x.t.taskType, taskUUID: x.t.taskUUID, ...x.r })),
      errors: results.filter((x) => "error" in x.r).map((x) => ({ taskUUID: x.t.taskUUID, status: "error", message: (x.r as { error: string }).error })),
    }));
  }));
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("who can use it", () => {
  it("turns away requests without the app's token, and paths it doesn't serve", async () => {
    const res = await worker.fetch(new Request("https://alive.test/v1/clips", { method: "POST", body: "{}" }), env);
    expect(res.status).toBe(401);
    expect((await call("/v1/clips", { method: "POST", body: "{}", headers: { authorization: "Bearer app-token-12X" } })).status).toBe(401);
    expect((await call("/elsewhere")).status).toBe(404);
  });

  it("only animates pet actions it knows, from an image", async () => {
    fakeRunware(() => ({}));
    expect((await post({ action: "rob a bank", species: "dog", first: jpeg })).status).toBe(400);
    expect((await post({ action: "bark", species: "dog", first: "https://example.com/x.jpg" })).status).toBe(400);
    expect((await post({ action: "getUp", species: "dog", first: jpeg })).status).toBe(400); // needs where it ends up
  });
});

describe("making a clip", () => {
  it("uploads the key frame and asks for a clip that starts and ends on it, with a prompt written here", async () => {
    const sent = fakeRunware((t) => (t.taskType === "mediaStorage" ? { mediaUUID: "media-1" } : { status: "processing" }));
    const res = await post({ action: "bark", species: "dog", first: jpeg, positivePrompt: "ignored" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const upload = sent.find((t) => t.taskType === "mediaStorage")!;
    expect(upload).toMatchObject({ operation: "upload", media: jpeg });
    const video = sent.find((t) => t.taskType === "videoInference")!;
    expect(video).toMatchObject({
      taskUUID: id,
      model: "bytedance:seedance@2.5",
      resolution: "720p",
      duration: 5,
      deliveryMethod: "async",
      includeCost: true,
      inputs: { frameImages: [{ image: "media-1", frame: "first" }, { image: "media-1", frame: "last" }] },
    });
    expect(video.positivePrompt).toBe(prompt("bark", "dog"));
    expect(String(video.positivePrompt)).toMatch(/barks twice happily/);
    expect(String(video.positivePrompt)).toMatch(/exactly the same pose/);
  });

  it("lets lying down end where it ends, and getting up end on the given frame", async () => {
    let n = 0;
    const sent = fakeRunware((t) => (t.taskType === "mediaStorage" ? { mediaUUID: `media-${++n}` } : { status: "processing" }));
    await post({ action: "lieDown", species: "cat", first: jpeg });
    await post({ action: "getUp", species: "cat", first: jpeg, last: "data:image/jpeg;base64,/9j/BBBB" });
    const [lie, up] = sent.filter((t) => t.taskType === "videoInference") as { inputs: { frameImages: unknown[] } }[];
    expect(lie!.inputs.frameImages).toEqual([{ image: "media-1", frame: "first" }]);
    expect(up!.inputs.frameImages).toEqual([{ image: "media-2", frame: "first" }, { image: "media-3", frame: "last" }]);
    expect(framesFor("idle")).toBe("loop");
  });

  it("passes on Runware's refusal", async () => {
    fakeRunware((t) => (t.taskType === "mediaStorage" ? { mediaUUID: "m" } : { error: "Insufficient credits" }));
    const res = await post({ action: "idle", species: "dog", first: jpeg });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ message: "Insufficient credits" });
  });
});

describe("waiting for a clip", () => {
  const id = "24cd5dff-cb81-4db5-8506-b72a9425f9d1";

  it("reports progress, then the video", async () => {
    fakeRunware(() => ({ status: "processing", progress: 47 }));
    expect(await (await call(`/v1/clips/${id}`)).json()).toEqual({ status: "processing", progress: 47 });
    fakeRunware(() => ({ status: "success", videoURL: "https://vm.runware.ai/v.mp4", cost: 0.18 }));
    expect(await (await call(`/v1/clips/${id}`)).json()).toEqual({ status: "success", videoURL: "https://vm.runware.ai/v.mp4", cost: 0.18 });
  });

  it("reports a failed generation, and refuses ids that aren't task ids", async () => {
    fakeRunware(() => ({ error: "The external provider did not respond" }));
    expect(await (await call(`/v1/clips/${id}`)).json()).toEqual({ status: "error", message: "The external provider did not respond" });
    expect((await call("/v1/clips/../../admin")).status).toBe(404);
  });

  it("can stand in for Runware entirely while the app is being built", async () => {
    const mock = { ...env, RUNWARE_API_KEY: undefined, MOCK: "1", MOCK_VIDEO_URL: "https://example.com/sample.mp4" };
    const { id: mid } = (await (await post({ action: "walk", species: "dog", first: jpeg }, mock)).json()) as { id: string };
    expect(await (await call(`/v1/clips/${mid}`, {}, mock)).json()).toEqual({ status: "success", videoURL: "https://example.com/sample.mp4", cost: 0 });
  });
});
