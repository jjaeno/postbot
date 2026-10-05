import { Inject, Injectable } from "@nestjs/common";
import type { ContentItemSummary } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import type { ContentRepository } from "./content.repository.js";
@Injectable()
export class PrismaContentRepository implements ContentRepository {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}
  async list(workspaceId: string, channelId: string | null): Promise<ContentItemSummary[]> {
    const items = await this.prisma.contentItem.findMany({ where: { channel: { workspaceId }, ...(channelId ? { channelId } : {}) }, include: { sceneVersions: { orderBy: { version: "desc" } } }, orderBy: { updatedAt: "desc" }, take: 100 });
    return items.map((item) => ({ id: item.id, channelId: item.channelId, title: item.title, status: item.status, updatedAt: item.updatedAt.toISOString(), sceneVersionId: item.sceneVersions[0]?.id ?? null, renderReady: Boolean(item.sceneVersions[0]?.renderManifest), platforms: [...new Set(item.sceneVersions.flatMap((scene) => scene.platform ? [scene.platform] : []))] }));
  }
}
