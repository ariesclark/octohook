import { compositeUrl } from "../../avatars";
import { githubAvatarUrl } from "../theme";

/**
 * A thumbnail Discord fetches rather than one the message carries: the channel keeps a rendered
 * message and sends it as JSON, so an uploaded file would not survive to be sent again.
 */
export function avatarThumbnail(urls: (string | undefined)[], origin?: string): { url: string } {
  const sources = urls.filter((url) => url !== undefined);
  if (sources.length === 0) return { url: githubAvatarUrl };

  return { url: origin ? compositeUrl(origin, sources) : sources[0]! };
}
