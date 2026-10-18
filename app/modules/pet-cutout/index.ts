import { requireOptionalNativeModule } from "expo-modules-core";

/** What `cutOut` wrote into the output folder. */
export interface CutOutResult {
  sheetUri: string;
  frameCount: number;
  cols: number;
  fps: number;
  width: number;
  height: number;
  /** False when no subject could be separated, so frames keep their background. */
  cutout: boolean;
  audioUri?: string;
}

export interface CutOutOptions {
  fps?: number;
  maxSeconds?: number;
  /** Longest side of one frame in the sheet, in pixels. */
  frameSize?: number;
}

interface PetCutoutNative {
  cutOut(videoUri: string, outDir: string, options: CutOutOptions): Promise<CutOutResult>;
}

/** Undefined on web and in Expo Go, where the native module isn't built in. */
export const PetCutout = requireOptionalNativeModule<PetCutoutNative>("PetCutout") ?? undefined;
