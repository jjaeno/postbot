import type { ContentItemSummary } from "@postbot/contracts";
export const CONTENT_REPOSITORY = Symbol("CONTENT_REPOSITORY");
export type ContentRepository = { list(workspaceId: string, channelId: string | null): Promise<ContentItemSummary[]> };
