import { WebhookContent } from "./types";

function getWebhookUrl(secret: string, type?: string): string {
  return `https://discord.com/api/webhooks/${secret}${type ? `/${type}` : ""}`;
}

export function toRequest(secret: string, { files, ...message }: WebhookContent): Request {
  const url = `${getWebhookUrl(secret)}?with_components=true`;

  if (!files?.length)
    return new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(message),
    });

  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      ...message,
      attachments: files.map((file, id) => ({ id, filename: file.name })),
    }),
  );

  for (const [id, file] of files.entries())
    form.append(`files[${id}]`, new Blob([file.data], { type: "image/png" }), file.name);

  return new Request(url, {
    method: "POST",
    body: form,
  });
}

/** A rendered message, read back out of the request that would have carried it to Discord. */
export async function contentOf(request: Request): Promise<unknown> {
  return request.headers.get("content-type")?.startsWith("application/json")
    ? await request.json()
    : JSON.parse(String((await request.formData()).get("payload_json")));
}
