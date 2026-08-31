import { Inject, Injectable } from "@nestjs/common";
import type { ScriptSceneGenerationResponse } from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import { createHash } from "node:crypto";
import type { GenerationIdea, GenerationRepository, SaveGenerationInput } from "./generation.repository.js";

const jsonObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

type StoredGenerationSnapshot = ScriptSceneGenerationResponse;

const parseSnapshot = (value: Prisma.JsonValue | null): StoredGenerationSnapshot | null => {
  const object = jsonObject(value);
  return "contentItemId" in object ? (object as StoredGenerationSnapshot) : null;
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

@Injectable()
export class PrismaGenerationRepository implements GenerationRepository {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async findIdea(workspaceId: string, ideaId: string): Promise<GenerationIdea | null> {
    const idea = await this.prisma.contentIdea.findFirst({
      where: {
        id: ideaId,
        channel: { workspaceId }
      },
      include: { channel: true }
    });
    if (!idea) {
      return null;
    }
    return {
      id: idea.id,
      channelId: idea.channelId,
      title: idea.title,
      summary: idea.summary ?? "",
      canonicalUrl: idea.canonicalUrl,
      sourceName: idea.sourceName,
      sourceKind: idea.sourceKind,
      publishedAt: idea.publishedAt?.toISOString() ?? null,
      topic: idea.channel.topic ?? idea.channel.name,
      language: idea.channel.language
    };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ScriptSceneGenerationResponse | null> {
    const usage = await this.prisma.providerUsage.findUnique({
      where: { idempotencyKey }
    });
    const snapshot = parseSnapshot(usage?.providerResponse ?? null);
    return snapshot ? { ...snapshot, duplicate: true } : null;
  }

  async save(input: SaveGenerationInput): Promise<ScriptSceneGenerationResponse> {
    return this.prisma.$transaction(async (tx) => {
      const contentItem = await tx.contentItem.upsert({
        where: {
          channelId_topicKey: {
            channelId: input.idea.channelId,
            topicKey: `idea:${input.idea.id}`
          }
        },
        update: {
          title: input.idea.title,
          summary: input.idea.summary,
          status: "GENERATING"
        },
        create: {
          channelId: input.idea.channelId,
          title: input.idea.title,
          summary: input.idea.summary,
          topicKey: `idea:${input.idea.id}`,
          collectedAt: new Date()
        }
      });

      await tx.sourceReference.upsert({
        where: {
          contentItemId_urlHash: {
            contentItemId: contentItem.id,
            urlHash: sha256(input.idea.canonicalUrl)
          }
        },
        update: {},
        create: {
          contentItemId: contentItem.id,
          kind: input.idea.sourceKind,
          title: input.idea.title,
          url: input.idea.canonicalUrl,
          urlHash: sha256(input.idea.canonicalUrl),
          sourceName: input.idea.sourceName,
          publishedAt: input.idea.publishedAt ? new Date(input.idea.publishedAt) : null,
          reliabilityScore: new Prisma.Decimal("0.800000"),
          isPrimary: true,
          normalizedSnapshot: {
            facts: input.facts
          }
        }
      });

      const latestScript = await tx.scriptVersion.findFirst({
        where: { contentItemId: contentItem.id, platform: input.platform },
        orderBy: { version: "desc" }
      });
      const version = (latestScript?.version ?? 0) + 1;
      const scriptVersion = await tx.scriptVersion.create({
        data: {
          contentItemId: contentItem.id,
          version,
          platform: input.platform,
          hook: input.script.hook,
          body: input.script.body,
          callToAction: input.script.callToAction,
          language: input.script.language,
          durationSeconds: new Prisma.Decimal(input.script.durationSeconds.toFixed(3)),
          promptVersion: input.promptVersion,
          qualitySnapshot: {
            metadata: input.metadata,
            facts: input.facts,
            model: input.model
          }
        }
      });
      const sceneVersion = await tx.sceneVersion.create({
        data: {
          contentItemId: contentItem.id,
          scriptVersionId: scriptVersion.id,
          version,
          platform: input.platform,
          schemaVersion: input.sceneDocument.schemaVersion,
          sceneDocument: input.sceneDocument,
          durationSeconds: new Prisma.Decimal(input.script.durationSeconds.toFixed(3))
        }
      });

      const response: ScriptSceneGenerationResponse = {
        contentItemId: contentItem.id,
        scriptVersionId: scriptVersion.id,
        sceneVersionId: sceneVersion.id,
        version,
        promptVersion: input.promptVersion,
        model: input.model,
        metadata: input.metadata,
        script: input.script,
        facts: input.facts,
        sceneDocument: input.sceneDocument,
        usage: input.usage,
        duplicate: false
      };

      await tx.providerUsage.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: {},
        create: {
          contentItemId: contentItem.id,
          provider: "llm",
          model: input.model,
          operation: "script-scene-generation",
          quantity: new Prisma.Decimal(input.usage.totalTokens),
          unit: "token",
          estimatedCost: new Prisma.Decimal(input.usage.estimatedCostUsd),
          idempotencyKey: input.idempotencyKey,
          providerResponse: response as Prisma.InputJsonObject
        }
      });
      await tx.costLedger.create({
        data: {
          contentItemId: contentItem.id,
          direction: "ESTIMATED",
          category: "llm",
          amount: new Prisma.Decimal(input.usage.estimatedCostUsd),
          note: `model:${input.model}`
        }
      });
      await tx.contentIdea.update({
        where: { id: input.idea.id },
        data: {
          status: "USED",
          usedContentItemId: contentItem.id
        }
      });
      await tx.contentItem.update({
        where: { id: contentItem.id },
        data: { status: "REVIEW_REQUIRED" }
      });
      return response;
    });
  }
}
