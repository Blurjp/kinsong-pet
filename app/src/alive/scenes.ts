import type { Place } from "../components/PhotoGarden";

/**
 * Photographed places the pet can be brought to life in (credits in
 * assets/scenes/CREDITS.md). For each, where the pet stands in the key frame
 * (its feet, as fractions of the picture from the top left), how tall it is
 * there, and where the ground meets the distance, so the family's candles and
 * flowers can stand in the same perspective.
 */
export interface AliveScene {
  id: string;
  title: string;
  image: number;
  feet: { x: number; y: number };
  /** The pet's height as a fraction of the picture's. */
  height: number;
  horizon: number;
}

export const SCENES: readonly AliveScene[] = [
  { id: "meadow", title: "Summer meadow", image: require("../../assets/scenes/meadow.jpg"), feet: { x: 0.5, y: 0.9 }, height: 0.3, horizon: 640 / 1080 },
  { id: "beach", title: "Beach at sunset", image: require("../../assets/scenes/beach.jpg"), feet: { x: 0.66, y: 0.9 }, height: 0.3, horizon: 0.5 },
  { id: "autumn", title: "Autumn woods", image: require("../../assets/scenes/autumn.jpg"), feet: { x: 0.45, y: 0.93 }, height: 0.36, horizon: 0.74 },
  { id: "flowers", title: "Lupine meadow", image: require("../../assets/scenes/flowers.jpg"), feet: { x: 0.5, y: 0.9 }, height: 0.32, horizon: 0.38 },
  { id: "lake", title: "Mountain lake", image: require("../../assets/scenes/lake.jpg"), feet: { x: 0.38, y: 0.92 }, height: 0.32, horizon: 0.42 },
  { id: "snow", title: "First snow", image: require("../../assets/scenes/snow.jpg"), feet: { x: 0.45, y: 0.95 }, height: 0.3, horizon: 0.8 },
];

export function sceneById(id: string | undefined): AliveScene | undefined {
  return SCENES.find((s) => s.id === id);
}

/** The scene as a photographed place, with a camera height that makes the pet its key-frame size. */
export function placeOf(scene: AliveScene, dogMetres = 0.6): Place {
  return { horizon: scene.horizon, cameraMetres: (dogMetres * (scene.feet.y - scene.horizon)) / scene.height };
}
