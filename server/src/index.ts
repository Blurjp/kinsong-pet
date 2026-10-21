/**
 * Kinsong "alive" server: holds the Runware key, so the app never does.
 *
 * The app sends a key frame (the family's pet, cut out on the phone and placed
 * in a scene) and names one of a fixed set of actions. The server writes the
 * prompt itself, so this can't be used as an open video generator: it only
 * ever animates a pet doing an ordinary pet thing, starting and ending on the
 * frame it was given so the clips join up seamlessly in the app.
 *
 *   POST /v1/clips      { action, species, first, last? }  →  { id }
 *   GET  /v1/clips/:id                                      →  { status, progress?, videoURL?, cost?, message? }
 */

export interface Env {
  RUNWARE_API_KEY?: string;
  APP_TOKEN?: string;
  VIDEO_MODEL: string;
  VIDEO_RESOLUTION: string;
  MOCK?: string;
  MOCK_VIDEO_URL?: string;
}

const RUNWARE = "https://api.runware.ai/v1";
/** Largest key frame accepted, as a data URI. A 720p JPEG is well under this. */
const MAX_IMAGE_CHARS = 6_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ACTIONS = ["idle", "bark", "walk", "play", "happy", "eat", "lieDown", "sleep", "getUp"] as const;
export type Action = (typeof ACTIONS)[number];
export const SPECIES = ["dog", "cat", "rabbit", "bird", "other"] as const;
type Species = (typeof SPECIES)[number];

const ANIMAL: Record<Species, string> = { dog: "dog", cat: "cat", rabbit: "rabbit", bird: "bird", other: "pet" };
const VOICE: Record<Species, string> = { dog: "barks twice happily", cat: "meows softly", rabbit: "twitches its nose and thumps a foot", bird: "chirps", other: "calls out happily" };

/** Ends where it started, so the clip loops and joins the next one without a seam. */
const BACK = "then settles back into exactly the same pose and position as at the start";

const MOTION: Record<Action, (s: Species) => string> = {
  idle: () => `The {a} rests calmly in place, breathing softly, blinking, its ears and head moving a little as it looks around, ${BACK}.`,
  bark: (s) => `The {a} lifts its head, looks toward the camera and ${VOICE[s]}, ${BACK}.`,
  walk: () => `The {a} gets up, walks a few steps across the ground sniffing around, turns, walks back to the same spot and ${BACK.replace("then ", "")}.`,
  play: () => `The {a} gets playful: it bounces, pounces and spins on the spot, ${BACK}.`,
  happy: () => `The {a} leans forward happily as if someone is stroking it, eyes half closed with pleasure, ${BACK}.`,
  eat: () => `The {a} lowers its head and sniffs and nibbles at the ground in front of it, lifts its head again and ${BACK.replace("then ", "")}.`,
  lieDown: () => `The {a} slowly lies down where it is, rests its chin on its front paws and closes its eyes, falling asleep.`,
  sleep: () => `The {a} sleeps peacefully, lying still with slow, gentle breathing, an ear twitching once, ${BACK}.`,
  getUp: () => `The {a} wakes, lifts its head, stretches and gets up into the pose of the final frame.`,
};

const STYLE =
  "Static camera, locked off: no camera movement, no zoom, no cuts. Photorealistic, natural light that matches the scene, " +
  "the same animal with the same markings throughout, natural anatomy and movement. The background does not change.";
const NEGATIVE = "camera movement, zoom, cut, text, watermark, people, extra animals, extra legs, deformed, morphing, cartoon";

/** The prompt for an action, written here rather than by the app. */
export function prompt(action: Action, species: Species): string {
  return `${MOTION[action](species).replaceAll("{a}", ANIMAL[species])} ${STYLE}`;
}

/** Which frames pin the clip: most start and end on the same key frame; lying down ends wherever it ends. */
export function framesFor(action: Action): "loop" | "firstOnly" | "firstAndLast" {
  if (action === "lieDown") return "firstOnly";
  if (action === "getUp") return "firstAndLast";
  return "loop";
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function authorised(req: Request, env: Env): boolean {
  const want = env.APP_TOKEN;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function runware(env: Env, tasks: unknown[]): Promise<{ data?: Record<string, unknown>[]; errors?: Record<string, unknown>[] }> {
  const res = await fetch(RUNWARE, {
    method: "POST",
    headers: { authorization: `Bearer ${env.RUNWARE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(tasks),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>[]; errors?: Record<string, unknown>[] };
  if (!res.ok && !body.errors) throw new Error(`Runware answered ${res.status}`);
  return body;
}

async function upload(env: Env, image: string): Promise<string> {
  const taskUUID = crypto.randomUUID();
  const r = await runware(env, [{ taskType: "mediaStorage", taskUUID, operation: "upload", media: image }]);
  const done = r.data?.find((d) => d.taskUUID === taskUUID);
  if (!done?.mediaUUID) throw new Error(String(r.errors?.[0]?.message ?? "Upload failed"));
  return String(done.mediaUUID);
}

const isImage = (v: unknown): v is string => typeof v === "string" && v.startsWith("data:image/") && v.length <= MAX_IMAGE_CHARS;

async function createClip(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => undefined)) as { action?: string; species?: string; first?: unknown; last?: unknown } | undefined;
  const action = ACTIONS.find((a) => a === body?.action);
  const species = SPECIES.find((s) => s === body?.species) ?? "other";
  if (!body || !action) return json({ message: `action must be one of ${ACTIONS.join(", ")}` }, 400);
  if (!isImage(body.first)) return json({ message: "first must be an image data URI" }, 400);
  const frames = framesFor(action);
  if (frames === "firstAndLast" && !isImage(body.last)) return json({ message: `${action} needs a last frame` }, 400);

  if (env.MOCK === "1") return json({ id: crypto.randomUUID() });

  const first = await upload(env, body.first);
  const frameImages = [{ image: first, frame: "first" }];
  if (frames === "loop") frameImages.push({ image: first, frame: "last" });
  if (frames === "firstAndLast") frameImages.push({ image: await upload(env, body.last as string), frame: "last" });

  const taskUUID = crypto.randomUUID();
  const r = await runware(env, [
    {
      taskType: "videoInference",
      taskUUID,
      model: env.VIDEO_MODEL,
      positivePrompt: prompt(action, species),
      negativePrompt: NEGATIVE,
      duration: 5,
      resolution: env.VIDEO_RESOLUTION,
      inputs: { frameImages },
      deliveryMethod: "async",
      includeCost: true,
    },
  ]);
  const error = r.errors?.find((e) => e.taskUUID === taskUUID) ?? r.errors?.[0];
  if (error) return json({ message: String(error.message ?? "Runware refused the request") }, 502);
  return json({ id: taskUUID });
}

async function clipStatus(id: string, env: Env): Promise<Response> {
  if (!UUID.test(id)) return json({ message: "unknown clip" }, 404);
  if (env.MOCK === "1") return json({ status: "success", videoURL: env.MOCK_VIDEO_URL, cost: 0 });
  const r = await runware(env, [{ taskType: "getResponse", taskUUID: id }]);
  const error = r.errors?.find((e) => e.taskUUID === id);
  if (error) return json({ status: "error", message: String(error.message ?? "Generation failed") });
  const entries = (r.data ?? []).filter((d) => d.taskUUID === id);
  const done = entries.find((d) => d.status === "success");
  if (done) return json({ status: "success", videoURL: done.videoURL, cost: done.cost });
  const progress = entries.map((d) => Number(d.progress)).filter(Number.isFinite).pop();
  return json({ status: "processing", progress });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/v1/")) return json({ message: "not found" }, 404);
    if (!authorised(req, env)) return json({ message: "unauthorised" }, 401);
    if (env.MOCK !== "1" && !env.RUNWARE_API_KEY) return json({ message: "server has no Runware key" }, 500);
    try {
      if (req.method === "POST" && url.pathname === "/v1/clips") return await createClip(req, env);
      const m = url.pathname.match(/^\/v1\/clips\/([^/]+)$/);
      if (req.method === "GET" && m) return await clipStatus(m[1]!, env);
      return json({ message: "not found" }, 404);
    } catch (e) {
      return json({ message: e instanceof Error ? e.message : "server error" }, 502);
    }
  },
};
