import type { Species } from "@sinian/core";
import type { AliveAction } from "./types";

/**
 * Talks to our "alive" server (server/), which holds the video model's key.
 * Set EXPO_PUBLIC_ALIVE_URL and EXPO_PUBLIC_ALIVE_TOKEN in app/.env.local.
 */
const BASE = process.env.EXPO_PUBLIC_ALIVE_URL?.replace(/\/$/, "");
const TOKEN = process.env.EXPO_PUBLIC_ALIVE_TOKEN;

export const aliveAvailable = (): boolean => !!BASE && !!TOKEN;

export type ClipStatus = { status: "processing"; progress?: number } | { status: "success"; videoURL: string; cost?: number } | { status: "error"; message: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE || !TOKEN) throw new Error("Bringing to life isn't set up in this build.");
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `The server answered ${res.status}`);
  return body;
}

/** Ask for one clip of the pet doing `action`, starting from `first` (and ending on `last`, for getting up). */
export async function requestClip(action: AliveAction, species: Species, first: string, last?: string): Promise<string> {
  const { id } = await call<{ id: string }>("/v1/clips", { method: "POST", body: JSON.stringify({ action, species, first, last }) });
  return id;
}

export function clipStatus(id: string): Promise<ClipStatus> {
  return call<ClipStatus>(`/v1/clips/${id}`);
}
