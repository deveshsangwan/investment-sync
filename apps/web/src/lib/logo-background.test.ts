import { describe, expect, it } from "vitest";
import { logoBackground } from "./logo-background";

function pixels(colors: number[][]): ImageData {
  return {
    data: new Uint8ClampedArray(colors.flat()),
    width: 3,
    height: 3,
    colorSpace: "srgb",
  };
}

describe("logoBackground", () => {
  it("keeps a dark transparent mark visible even when the provider ignores the requested theme", () => {
    const transparent = [0, 0, 0, 0];
    const image = pixels(Array.from({ length: 9 }, () => transparent));
    image.data.set([32, 35, 38, 255], 4 * 4);

    expect(logoBackground(image)).toBe("#ffffff");
  });

  it("gives a light transparent mark a dark backing", () => {
    const image = pixels(Array.from({ length: 9 }, () => [0, 0, 0, 0]));
    image.data.set([250, 250, 250, 255], 4 * 4);

    expect(logoBackground(image)).toBe("#000000");
  });

  it.each([
    [255, 255, 255],
    [36, 62, 144],
  ])(
    "extends the source background to the edge of the badge: %s %s %s",
    (r, g, b) => {
      const image = pixels(Array.from({ length: 9 }, () => [r, g, b, 255]));
      image.data.set([0, 0, 0, 255], 4 * 4);

      expect(logoBackground(image)).toBe(`rgb(${r}, ${g}, ${b})`);
    },
  );

  it("does not treat differently colored corners as a uniform background", () => {
    const image = pixels(Array.from({ length: 9 }, () => [20, 20, 20, 255]));
    image.data.set([80, 80, 80, 255], 8 * 4);

    expect(logoBackground(image)).toBe("#ffffff");
  });
});
