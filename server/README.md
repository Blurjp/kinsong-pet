# kinsong-alive

A small Cloudflare Worker that holds the [Runware](https://runware.ai) key, so the app never contains it. The app sends a key frame (the family's pet, cut out on the phone and placed in a scene) and names one of a fixed set of actions; the server writes the prompt and asks Runware for a 5-second clip that starts and ends on that frame, so the clips join up seamlessly in the app.

It is deliberately not an open video generator: only `idle`, `bark`, `walk`, `play`, `happy`, `eat`, `lieDown`, `sleep` and `getUp`, for a dog, cat, rabbit, bird or other pet, and the prompt is always written here.

```
POST /v1/clips      { action, species, first, last? }  →  { id }
GET  /v1/clips/:id                                      →  { status: "processing" | "success" | "error", progress?, videoURL?, cost?, message? }
```

Every request needs `Authorization: Bearer <APP_TOKEN>`.

## Run it locally

```sh
npm install
cp .dev.vars.example .dev.vars   # put your Runware key and an app token in it (never committed)
npm run dev                      # http://127.0.0.1:8787
npm test
```

`MOCK=1` in `.dev.vars` answers every clip with `MOCK_VIDEO_URL` instead of calling Runware, for working on the app without spending anything.

Point the app at it in `app/.env.local` (never committed):

```
EXPO_PUBLIC_ALIVE_URL=http://127.0.0.1:8787
EXPO_PUBLIC_ALIVE_TOKEN=<the same APP_TOKEN>
```

## Deploy

```sh
npx wrangler login
npx wrangler secret put RUNWARE_API_KEY
npx wrangler secret put APP_TOKEN
npm run deploy
```

Then set `EXPO_PUBLIC_ALIVE_URL` to the deployed URL for app builds.

## Choosing the model

`VIDEO_MODEL` in `wrangler.toml` is any Runware video model that takes a first and last frame (default `bytedance:seedance@2.5`, at `VIDEO_RESOLUTION` 720p). Changing it needs no app release.

## Before real users

The app token ships inside the app, so treat it as a speed bump, not a lock: add rate limiting (per device and overall, e.g. Cloudflare rate-limiting rules or a Durable Object counter) and a spending cap on the Runware account before inviting people in.
