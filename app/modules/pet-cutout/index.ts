import type { ComponentType } from "react";
import type { ViewProps } from "react-native";
import { requireNativeViewManager, requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/** What `cutOut` wrote into the output folder. */
export interface CutOutResult {
  /** HEVC with alpha when `cutout`, so the garden shows through around the pet. */
  videoUri: string;
  /** The first frame, for places that don't play video. */
  posterUri: string;
  width: number;
  height: number;
  seconds: number;
  /** False when no pet could be separated from the background, so the footage keeps it. */
  cutout: boolean;
  /** The pet runs off the bottom of the frame. */
  closeUp: boolean;
  facing: "left" | "right";
  audioUri?: string;
}

export interface WidgetInfo {
  name: string;
  days: { date: string; title: string }[];
}

export interface CutOutOptions {
  maxSeconds?: number;
  maxFps?: number;
  /** Longest side of the output, in pixels. */
  size?: number;
}

interface PetCutoutNative {
  cutOut(videoUri: string, outDir: string, options: CutOutOptions): Promise<CutOutResult>;
  addListener(event: "onProgress", listener: (e: { progress: number }) => void): EventSubscription;
  /** Share the widget's picture (pet cut-out on its place) and remembrance days with the home-screen widget. */
  updateWidget(info: WidgetInfo, background: string | null, pet: string | null, closeUp: boolean): Promise<void>;
}

export interface PetClipViewProps extends ViewProps {
  uri: string;
  flip?: boolean;
  /** Changing it plays the clip from the start. */
  restartKey?: number;
  /** Light it like the night-time garden. */
  night?: boolean;
}

/** Undefined on web and in Expo Go, where the native module isn't built in. */
export const PetCutout = requireOptionalNativeModule<PetCutoutNative>("PetCutout") ?? undefined;

/** The see-through, looping clip view; undefined wherever PetCutout is. */
export const PetClipView: ComponentType<PetClipViewProps> | undefined = PetCutout ? requireNativeViewManager<PetClipViewProps>("PetCutout") : undefined;
