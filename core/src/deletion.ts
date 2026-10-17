import type { Modality } from "./types";

/**
 * Every artifact derived from the deceased is registered here when created, so
 * revocation can wipe all of it. Nothing is "soft deleted".
 */
export type AssetKind =
  | "raw-chat"
  | "raw-audio"
  | "raw-image"
  | "raw-video"
  | "memory-index"
  | "voice-model"
  | "face-model"
  | "text-adapter"
  | "conversation-log";

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  /** Local file path, or a remote id when an optional server step was used. */
  location: string;
  remote: boolean;
}

const KIND_MODALITY: Record<AssetKind, Modality | "all"> = {
  "raw-chat": "text",
  "memory-index": "text",
  "text-adapter": "text",
  "conversation-log": "text",
  "raw-audio": "voice",
  "voice-model": "voice",
  "raw-image": "image",
  "face-model": "image",
  "raw-video": "video",
};

/** Assets to destroy when the given modalities are withdrawn. Withdrawing text removes everything. */
export function deletionPlan(assets: AssetRecord[], withdrawn: Modality[]): AssetRecord[] {
  if (withdrawn.includes("text")) return [...assets];
  return assets.filter((a) => {
    const m = KIND_MODALITY[a.kind];
    // Face models are driven by video too; withdrawing video takes them with it.
    if (a.kind === "face-model" && withdrawn.includes("video")) return true;
    return m !== "all" && withdrawn.includes(m);
  });
}
