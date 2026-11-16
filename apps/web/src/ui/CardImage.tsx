import { useState, type CSSProperties } from "react";
import "./card-image.css";
import type { Card, CardPicture } from "../lib/types";

/** Frame shapes: the intro gets a tall hero, a task prompt a short strip that leaves room for answers. */
const FRAME = { hero: 16 / 10, prompt: 2 / 1 } as const;

/**
 * How a picture of any shape goes into a fixed frame. Close to the frame's shape it simply fills it
 * (a sliver cropped off the edges); otherwise it is shown whole, over a blurred, dimmed copy of itself.
 */
export function pictureFit(picture: Pick<CardPicture, "width" | "height">, frame: number): "cover" | "contain" {
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

export function CardImage({ card, size = "hero", className }: { card: Card; size?: keyof typeof FRAME; className?: string }) {
  const picture = card.picture;
  const [loaded, setLoaded] = useState(false);
  if (!picture) return null;
  const frame = FRAME[size];
  const fit = pictureFit(picture, frame);
  return (
    <figure
      className={`card-image is-${size}${className ? ` ${className}` : ""}`}
      data-fit={fit}
      data-loaded={loaded || undefined}
      style={{ "--frame": frame, "--src": `url("${picture.url}")` } as CSSProperties}
    >
      {fit === "contain" && <span className="card-image-backdrop" aria-hidden="true" />}
      <img src={picture.url} alt="" decoding="async" draggable={false} onLoad={() => setLoaded(true)} />
    </figure>
  );
}
