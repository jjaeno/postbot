import { Inject, Injectable } from "@nestjs/common";
import type { ContentItemListResponse } from "@postbot/contracts";
import { CONTENT_REPOSITORY, type ContentRepository } from "./content.repository.js";
@Injectable()
export class ContentService {
  constructor(@Inject(CONTENT_REPOSITORY) private readonly repository: ContentRepository) {}
  async list(workspaceId: string, channelId?: string): Promise<ContentItemListResponse> { return { items: await this.repository.list(workspaceId, channelId ?? null) }; }
}
