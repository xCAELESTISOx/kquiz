import { useState, type CSSProperties, type SyntheticEvent } from "react";
import "./card-image.css";
import type { Card, CardPicture } from "../lib/types";

/** Frame shapes: the intro gets a tall hero, a task prompt a short strip that leaves room for answers. */
const FRAME = { hero: 16 / 10, prompt: 2 / 1 } as const;

/**
 * How a picture of any shape goes into a fixed frame. Close to the frame's shape it simply fills it
 * (a sliver cropped off the edges); otherwise it is shown whole, the rest of the frame in its edge colour.
 */
export function pictureFit(
  picture: Pick<CardPicture, "width" | "height">,
  frame: number,
): "cover" | "contain" {
  const ratio = picture.width / picture.height;
  return Math.abs(Math.log(ratio / frame)) < 0.25 ? "cover" : "contain";
}

/**
 * Whether the picture may show while the Korean is still to be recalled: one with the word written
 * on it (a station sign, a price tag) would give the answer away.
 */
export function pictureHelps(card: Card): boolean {
  return !!card.picture && !card.picture.hasText;
}

/**
 * The colour of a picture's edges where they meet the empty part of the frame (the sides of a narrow
 * picture, the top and bottom of a wide one), when those edges are one plain colour: most pictures are
 * drawings on white. The frame is filled with it, so the picture has no seams. Edges the drawing runs
 * into give null, and the picture sits on the frame's own dark surface instead.
 */
export function edgeColor(img: HTMLImageElement, frame: number): string | null {
  const sides = img.naturalWidth / Math.max(1, img.naturalHeight) < frame;
  const w = 24;
  const h = Math.max(
    2,
    Math.round((w * img.naturalHeight) / Math.max(1, img.naturalWidth)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const px: Rgb[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (sides ? x === 0 || x === w - 1 : y === 0 || y === h - 1) {
          const i = (y * w + x) * 4;
          px.push([data[i]!, data[i + 1]!, data[i + 2]!]);
        }
    return plainEdge(px);
  } catch {
    return null;
  }
}

type Rgb = [number, number, number];

/** The edge's colour when nearly all of it is close to its median colour, else null. */
export function plainEdge(px: readonly Rgb[]): string | null {
  if (!px.length) return null;
  const median = [0, 1, 2].map((c) => {
    const v = px.map((p) => p[c]!).sort((a, b) => a - b);
    return v[v.length >> 1]!;
  });
  const near = px.filter((p) =>
    p.every((v, c) => Math.abs(v - median[c]!) <= 20),
  ).length;
  return near / px.length >= 0.9 ? `rgb(${median.join(" ")})` : null;
}

export function CardImage({
  card,
  size = "hero",
  className,
}: {
  card: Card;
  size?: keyof typeof FRAME;
  className?: string;
}) {
  const picture = card.picture;
  const [loaded, setLoaded] = useState(false);
  const [edge, setEdge] = useState<string | null>(null);
  if (!picture) return null;
  const frame = FRAME[size];
  const fit = pictureFit(picture, frame);
  return (
    <figure
      className={`card-image is-${size}${className ? ` ${className}` : ""}`}
      data-fit={fit}
      data-loaded={loaded || undefined}
      style={{ "--frame": frame, "--edge": edge ?? undefined } as CSSProperties}
      data-edge={edge ? "" : undefined}
    >
      <img
        src={picture.url}
        alt=""
        decoding="async"
        draggable={false}
        onLoad={(e: SyntheticEvent<HTMLImageElement>) => {
          if (fit === "contain") setEdge(edgeColor(e.currentTarget, frame));
          setLoaded(true);
        }}
      />
    </figure>
  );
}
