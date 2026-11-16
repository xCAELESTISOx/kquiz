import { describe, expect, it } from "vitest";
import { pictureFit, plainEdge } from "./CardImage";

type Rgb = [number, number, number];

describe("a picture's frame", () => {
  it("fills the frame with a plain edge's colour, and leaves a busy edge on the dark surface", () => {
    const white = Array.from({ length: 40 }, (): Rgb => [250, 251, 249]);
    expect(plainEdge(white)).toBe("rgb(250 251 249)");
    // A line of the drawing touching the edge doesn't spoil it.
    expect(plainEdge([...white, [20, 20, 20], [30, 25, 20]])).toBe(
      "rgb(250 251 249)",
    );
    // A figure cut by the edge does.
    expect(
      plainEdge([
        ...white.slice(0, 25),
        ...Array.from({ length: 15 }, (): Rgb => [90, 90, 100]),
      ]),
    ).toBeNull();
    expect(plainEdge([])).toBeNull();
  });

  it("covers the frame only when the picture is near its shape", () => {
    expect(pictureFit({ width: 200, height: 100 }, 2)).toBe("cover");
    expect(pictureFit({ width: 140, height: 151 }, 2)).toBe("contain");
  });
});
