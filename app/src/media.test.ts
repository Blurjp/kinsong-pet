import { encode as encodeJpeg } from "jpeg-js";
import { manipulateAsync } from "expo-image-manipulator";
import { coatFromPhoto } from "./media";

jest.mock("expo-image-manipulator", () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: "jpeg" } }));
jest.mock("expo-audio", () => ({ createAudioPlayer: jest.fn() }));

/** A real JPEG: a golden dog with a dark ear patch on a green lawn. */
function dogPhotoBase64(): string {
  const w = 64, h = 64, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dog = x > 16 && x < 48 && y > 12 && y < 56;
      const patch = dog && x > 32 && y < 28;
      const [r, g, b] = patch ? [90, 56, 32] : dog ? [214, 168, 102] : [70, 150, 60];
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  const bytes = encodeJpeg({ data, width: w, height: h }, 95).data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

it("reads the coat and marking colours from a photo on the device", async () => {
  (manipulateAsync as jest.Mock).mockResolvedValue({ uri: "file:///tmp/tiny.jpg", base64: dogPhotoBase64() });
  const c = await coatFromPhoto("file:///photos/max.jpg");
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const near = (hex: string, want: number[]) => rgb(hex).every((v, i) => Math.abs(v - want[i]!) < 24);
  expect(near(c!.coat, [214, 168, 102])).toBe(true);
  expect(near(c!.accent, [90, 56, 32])).toBe(true);
});
