import { PhotonImage, Rgba, draw_text_with_color } from "@cf-wasm/photon";

export const diffstatName = "diffstat.png";

export type Block = "added" | "removed" | "empty";

const blockCount = 5;

/** GitHub's own palette, read off the widget it draws beside a diff. */
const palette = {
  added: [35, 135, 54, 255],
  removed: [218, 54, 51, 255],
  empty: [31, 36, 43, 255],
  border: [60, 67, 77, 255],
  addedText: [63, 185, 80, 255],
  removedText: [248, 81, 73, 255],
} satisfies Record<string, [number, number, number, number]>;

/** Whole blocks for the share each side earns; a side too small for one is left to the empties. */
export function diffstatBlocks(additions: number, deletions: number): Block[] {
  const total = additions + deletions;
  if (total === 0) return Array.from({ length: blockCount }, () => "empty");

  const whole = (count: number) => Math.floor((count / total) * blockCount);

  const added = whole(additions);
  const removed = whole(deletions);

  return Array.from({ length: blockCount }, (_, index) =>
    index < added ? "added" : index < added + removed ? "removed" : "empty",
  );
}

const scale = 3;

const blockSize = 8 * scale;
const blockGap = 3 * scale;
const fontSize = 13 * scale;
const rowGap = 5 * scale;
const padding = 6 * scale;

/** The widget rounds its blocks by an eighth of their size. */
const radius = blockSize / 8;

/** Coverage from a grid of samples, so a corner lands antialiased rather than stepped. */
function coverage(x: number, y: number, w: number, h: number, radius: number): number {
  const samples = 4;
  let inside = 0;

  for (let sy = 0; sy < samples; sy += 1) {
    for (let sx = 0; sx < samples; sx += 1) {
      const px = x + (sx + 0.5) / samples;
      const py = y + (sy + 0.5) / samples;

      const dx = Math.max(radius - px, px - (w - radius), 0);
      const dy = Math.max(radius - py, py - (h - radius), 0);

      if (Math.hypot(dx, dy) <= radius) inside += 1;
    }
  }

  return inside / (samples * samples);
}

function roundedRect(
  pixels: Uint8Array,
  width: number,
  left: number,
  top: number,
  w: number,
  h: number,
  radius: number,
  colour: readonly number[],
) {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const alpha = coverage(x, y, w, h, radius) * (colour[3]! / 255);
      if (alpha === 0) continue;

      const index = ((top + y) * width + left + x) * 4;
      const under = pixels[index + 3]! / 255;
      const over = alpha + under * (1 - alpha);

      for (const channel of [0, 1, 2])
        pixels[index + channel] = Math.round(
          (colour[channel]! * alpha + pixels[index + channel]! * under * (1 - alpha)) / over,
        );

      pixels[index + 3] = Math.round(over * 255);
    }
  }
}

function measure(text: string): number {
  return Math.round(text.length * fontSize * 0.58);
}

export type Layout = "inline" | "stacked";

/**
 * Discord fits a thumbnail inside a square, so the widget is drawn into one and pinned to the top,
 * where it lines up with the headline beside it.
 */
export function diffstatImage(
  additions: number,
  deletions: number,
  layout: Layout = "stacked",
): Uint8Array {
  const added = `+${additions}`;
  const removed = `−${deletions}`;

  const blocks = diffstatBlocks(additions, deletions);

  const blocksWidth = blockCount * blockSize + (blockCount - 1) * blockGap;
  const textWidth = measure(added) + blockGap * 2 + measure(removed);

  const side =
    (layout === "inline" ? textWidth + blockGap * 2 + blocksWidth : blocksWidth) + padding * 2;

  const image = new PhotonImage(new Uint8Array(side * side * 4), side, side);
  const pixels = image.get_raw_pixels();

  const blocksTop =
    layout === "inline"
      ? padding + Math.round((fontSize - blockSize) / 2)
      : padding + fontSize + rowGap;
  const blocksLeft = layout === "inline" ? padding + textWidth + blockGap * 2 : padding;

  let x = blocksLeft;
  for (const block of blocks) {
    if (block === "empty")
      roundedRect(pixels, side, x, blocksTop, blockSize, blockSize, radius, palette.border);

    const inset = block === "empty" ? scale : 0;
    roundedRect(
      pixels,
      side,
      x + inset,
      blocksTop + inset,
      blockSize - inset * 2,
      blockSize - inset * 2,
      Math.max(radius - inset, 1),
      palette[block],
    );

    x += blockSize + blockGap;
  }

  const drawn = new PhotonImage(pixels, side, side);

  const textLeft = layout === "inline" ? padding : Math.round((side - textWidth) / 2);
  draw_text_with_color(drawn, added, textLeft, padding, fontSize, new Rgba(...palette.addedText));
  draw_text_with_color(
    drawn,
    removed,
    textLeft + measure(added) + blockGap * 2,
    padding,
    fontSize,
    new Rgba(...palette.removedText),
  );

  return drawn.get_bytes();
}
