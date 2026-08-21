import { compositeAuthorAvatars } from "../../avatars";
import { githubAvatarUrl } from "../theme";
import { WebhookFile } from "../types";

export async function avatarThumbnail(
  urls: (string | undefined)[],
): Promise<{ files: WebhookFile[]; url: string }> {
  const sources = urls.filter((url) => url !== undefined);
  const fallback = sources[0] ?? githubAvatarUrl;

  const files: WebhookFile[] = [];

  try {
    files.push({
      name: "authors.png",
      data: await compositeAuthorAvatars(sources.length > 0 ? sources : [fallback]),
    });

    return { files, url: "attachment://authors.png" };
  } catch (reason) {
    console.error("avatar composite failed", reason);
    return { files, url: fallback };
  }
}
