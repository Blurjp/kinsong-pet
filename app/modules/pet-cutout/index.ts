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
  /** The pet from a still photo, on transparency. */
  cutOutPhoto(photo: string, out: string): Promise<{ uri: string; width: number; height: number; closeUp: boolean }>;
  /** The pet standing in a scene, light-matched with a contact shadow: the key frame clips start and end on. */
  composeKeyframe(pet: string, scene: string, out: string, feetX: number, feetY: number, height: number): Promise<string>;
  /** A clip's last frame as a JPEG. */
  lastFrame(video: string, out: string): Promise<string>;
  /** The pet's skeleton in a cut-out photo: joint name → [x, y, confidence], fractions from the top left. */
  petRig(cutout: string): Promise<Record<string, number[]>>;
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

export interface AliveViewProps extends ViewProps {
  /** Plays on repeat: resting, or asleep. */
  loopUri?: string;
  /** A new `key` plays `uri` over the loop; `then` replaces the loop when it ends. */
  action?: { uri: string; key: number; then?: string };
  night?: boolean;
  onActionEnd?: (e: { nativeEvent: { key: number } }) => void;
}

/** Undefined on web and in Expo Go, where the native module isn't built in. */
export const PetCutout = requireOptionalNativeModule<PetCutoutNative>("PetCutout") ?? undefined;

/** The see-through, looping clip view; undefined wherever PetCutout is. */
export const PetClipView: ComponentType<PetClipViewProps> | undefined = PetCutout ? requireNativeViewManager<PetClipViewProps>("PetCutout", "PetClipView") : undefined;

/** The brought-to-life player; undefined wherever PetCutout is. */
export const AliveView: ComponentType<AliveViewProps> | undefined = PetCutout ? requireNativeViewManager<AliveViewProps>("PetCutout", "AliveView") : undefined;

export interface PlayViewProps extends ViewProps {
  /** The pet cut out of a photo, and its skeleton from petRig. */
  pet?: { uri: string; rig: Record<string, number[]>; asleep?: { uri: string; facesRight: boolean } };
  background?: string;
  ball?: string;
  horizon?: number;
  cameraMetres?: number;
  night?: boolean;
  /** A new `key` sends the command. */
  command?: { kind: "call" | "play" | "pet" | "treat"; key: number };
  onPlayEvent?: (e: { nativeEvent: { type: string } }) => void;
}

/** The real-time play scene; undefined wherever PetCutout is. */
export const PlayView: ComponentType<PlayViewProps> | undefined = PetCutout ? requireNativeViewManager<PlayViewProps>("PetCutout", "PlayView") : undefined;

export interface ARPlayViewProps extends ViewProps {
  pet?: { uri: string; rig: Record<string, number[]> };
  ball?: string;
  command?: { kind: "call" | "play" | "pet" | "treat"; key: number };
  /** Play events, plus "ar-unsupported", "ar-find-floor" and "ar-placed". */
  onPlayEvent?: (e: { nativeEvent: { type: string } }) => void;
}

/** The pet in your home through the camera; undefined wherever PetCutout is. */
export const ARPlayView: ComponentType<ARPlayViewProps> | undefined = PetCutout ? requireNativeViewManager<ARPlayViewProps>("PetCutout", "ARPlayView") : undefined;
