import { RESTPostAPIWebhookWithTokenJSONBody } from "discord-api-types/rest";

export const githubAvatarUrl =
  "https://cdn.discordapp.com/avatars/1083425319148597258/e57fd67dc7ca0cc840a0e87a82281bc5.webp?size=512";

export const defaultWebhookContent: RESTPostAPIWebhookWithTokenJSONBody = {
  username: "GitHub",
  avatar_url: githubAvatarUrl,
};

export const colors = {
  neutral: 0x7289da,
  error: 0xfc2929,
  success: 0x009800,
};

export const stateColors: Partial<Record<string, number>> = {
  error: colors.error,
  failure: colors.error,
  success: colors.success,
};
