import { PhotonImage, SamplingFilter, resize, watermark } from "@cf-wasm/photon";

const baseSize = 256;

const overlap = 0.22;

const drop = 0.62;

type Placement = {
  size: number;
  x: number;
  y: number;
};

function fitChain(centers: { x: number; y: number }[]): Placement[] {
  const gaps = centers
    .slice(1)
    .map((center, index) => Math.hypot(center.x - centers[index]!.x, center.y - centers[index]!.y));

  const size = Math.min(...gaps) / (1 - overlap);

  const minimum = {
    x: Math.min(...centers.map((center) => center.x)) - size / 2,
    y: Math.min(...centers.map((center) => center.y)) - size / 2,
  };
  const extent = Math.max(
    Math.max(...centers.map((center) => center.x)) + size / 2 - minimum.x,
    Math.max(...centers.map((center) => center.y)) + size / 2 - minimum.y,
  );

  const scale = baseSize / extent;
  const scaled = Math.floor(size * scale);

  return centers.map((center) => ({
    size: scaled,
    x: Math.round((center.x - size / 2 - minimum.x) * scale),
    y: Math.round((center.y - size / 2 - minimum.y) * scale),
  }));
}

function placements(count: number): Placement[] {
  if (count < 2) {
    const [pair] = placements(2);
    const size = pair!.size;
    const offset = Math.round((baseSize - size) / 2);

    return [{ size, x: offset, y: offset }];
  }

  return fitChain(
    Array.from({ length: count }, (_, index) => ({
      x: index % 2 === 0 ? 0 : 1,
      y: index * drop,
    })),
  );
}

function circleMask(image: PhotonImage, size: number): PhotonImage {
  const pixels = image.get_raw_pixels();
  const center = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      const opacity = Math.min(Math.max(center - distance + 0.5, 0), 1);
      const index = (y * size + x) * 4 + 3;
      pixels[index] = Math.round(pixels[index]! * opacity);
    }
  }

  return new PhotonImage(pixels, size, size);
}

async function fetchAvatar(url: string): Promise<PhotonImage> {
  const withSize = new URL(url);
  withSize.searchParams.set("s", String(baseSize));

  const response = await fetch(withSize);
  if (!response.ok) throw new Error(`Avatar fetch failed for ${url}: ${response.status}`);

  const image = PhotonImage.new_from_byteslice(new Uint8Array(await response.arrayBuffer()));
  return resize(image, baseSize, baseSize, SamplingFilter.Lanczos3);
}

export async function compositeAuthorAvatars(urls: string[]): Promise<Uint8Array> {
  const chain = placements(urls.length);
  const canvas = new PhotonImage(new Uint8Array(baseSize * baseSize * 4), baseSize, baseSize);

  const images = await Promise.all(urls.map((url) => fetchAvatar(url)));

  for (const [index, image] of images.entries()) {
    const placement = chain[index]!;
    const sized = resize(image, placement.size, placement.size, SamplingFilter.Lanczos3);

    watermark(canvas, circleMask(sized, placement.size), BigInt(placement.x), BigInt(placement.y));
  }

  return canvas.get_bytes();
}

/** GitHub is the only place the worker will fetch a face from, asked or not. */
const avatarHost = "avatars.githubusercontent.com";

const mostFaces = 4;

export function avatarSources(asked: URL): string[] {
  return asked.searchParams
    .getAll("u")
    .slice(0, mostFaces * 2)
    .filter((url) => {
      try {
        const { protocol, hostname } = new URL(url);
        return protocol === "https:" && hostname === avatarHost;
      } catch {
        return false;
      }
    })
    .slice(0, mostFaces);
}

/** One face needs no drawing; several are drawn into one by the worker, and cached by Discord. */
export function compositeUrl(origin: string, urls: string[]): string {
  if (urls.length === 1) return urls[0]!;

  const asked = new URL("/avatars", origin);
  for (const url of urls) asked.searchParams.append("u", url);

  return asked.toString();
}
