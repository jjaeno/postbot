export type UploadPrivacy = "public" | "unlisted" | "private";
/** The operator's ceiling may narrow visibility; a channel can never widen it. */
export const publishPrivacy = (setting: unknown, ceiling: UploadPrivacy): UploadPrivacy => {
  const requested = setting === "PRIVATE" ? "private" : setting === "UNLISTED" ? "unlisted" : setting === "PUBLIC" ? "public" : ceiling;
  if (ceiling === "private" || requested === "private") return "private";
  if (ceiling === "unlisted" || requested === "unlisted") return "unlisted";
  return "public";
};
