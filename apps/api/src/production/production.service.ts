import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ProductionResultsResponseSchema } from "@postbot/contracts";
import { Prisma, type PrismaClient } from "@postbot/database";
import { createHash } from "node:crypto";

const record = (value: Prisma.JsonValue | null | undefined): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const string = (value: Prisma.JsonValue | undefined): string | null => typeof value === "string" ? value : null;

@Injectable()
export class ProductionService {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async forRun(workspaceId: string, runId: string) {
    const run = await this.prisma.automationRun.findFirst({ where: { id: runId, channel: { workspaceId } },
      include: { steps: { where: { stage: "SCRIPT" }, include: { productionJob: true } } } });
    if (!run) throw new NotFoundException("AUTOMATION_RUN_NOT_FOUND");
    const results = [];
    for (const step of run.steps) {
      const output = record(step.productionJob?.result ?? step.output);
      const contentId = string(output.contentItemId); const sceneId = string(output.sceneVersionId);
      if (contentId && sceneId) results.push(await this.get(workspaceId, contentId, sceneId));
    }
    return { runId, production: results };
  }

  async get(workspaceId: string, contentItemId: string, sceneVersionId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const content = await tx.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: {
        sourceReferences: true, scriptVersions: { orderBy: { version: "desc" } },
        sceneVersions: { where: sceneVersionId ? { id: sceneVersionId } : {}, orderBy: { version: "desc" } },
        assetUsages: { include: { asset: { include: { licenses: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } } } },
        providerUsages: { orderBy: { occurredAt: "asc" } },
        policyChecks: { orderBy: { checkedAt: "desc" } },
        productionJobs: { where: { status: { in: ["FAILED", "NEEDS_REVIEW"] } }, orderBy: { createdAt: "desc" }, take: 50 }
      } });
      if (!content || (sceneVersionId && !content.sceneVersions.length)) throw new NotFoundException("PRODUCTION_RESULT_NOT_FOUND");
      const latestScenes = [...new Map([...content.sceneVersions].reverse().map((scene) => [scene.platform, scene])).values()];
      const results = latestScenes.map((scene) => {
        // Follow the scene's FK even when the current script has changed.
        const script = content.scriptVersions.find((script) => script.id === scene.scriptVersionId) ?? null;
        const snapshot = record(script?.qualitySnapshot); const manifest = record(scene.renderManifest);
        const planning = record(snapshot.planning); const qa = record(manifest.qa);
        const reasons = content.productionJobs.filter((job) => {
          const input = record(job.payload);
          return [input.assetPreparation, input.ttsPreparation, input.render].some((part) => record(part).sceneVersionId === scene.id);
        }).map((job) => ({ code: job.errorCode ?? job.status, message: "Production needs review", scriptVersionId: script?.id ?? null, sceneVersionId: scene.id }));
        if (!script) reasons.push({ code: "SCRIPT_VERSION_MISSING", message: "Linked script version is unavailable", scriptVersionId: null, sceneVersionId: scene.id });
        const policy = content.policyChecks.find((check) => check.platform === scene.platform && check.checkedAt >= scene.createdAt);
        const videoKey = string(manifest.videoKey);
        return {
          reference: { contractVersion: "production-result-v1", contentItemId, platform: scene.platform, scriptVersionId: script?.id ?? null, sceneVersionId: scene.id },
          state: reasons.length ? "REVIEW_REQUIRED" : videoKey ? "RENDERED" : "IN_PROGRESS",
          originalTitle: content.sourceReferences.find((source) => source.isPrimary)?.title ?? content.title,
          planning: { title: string(planning.title), summary: string(planning.summary) },
          sources: content.sourceReferences.map((source) => {
            const data = record(source.normalizedSnapshot); const text = string(data.body);
            return { id: source.id, url: source.url, title: source.title, publishedAt: source.publishedAt?.toISOString() ?? null,
              collectedAt: string(data.collectedAt) ?? source.createdAt.toISOString(), scope: data.contentScope === "FULL_TEXT" || data.contentScope === "SUMMARY" ? data.contentScope : "UNKNOWN",
              text, fingerprint: text ? createHash("sha256").update(text).digest("hex") : null };
          }),
          claims: Array.isArray(snapshot.facts) ? snapshot.facts : [], evidence: snapshot.factEvidence ?? null,
          script: script ? { id: script.id, version: script.version, hook: script.hook, body: script.body, callToAction: script.callToAction, language: script.language } : null,
          scene: { id: scene.id, version: scene.version, scriptVersionId: scene.scriptVersionId, document: scene.sceneDocument },
          assets: content.assetUsages.filter((usage) => usage.sceneVersionId === scene.id || usage.sceneVersionId === null).map((usage) => ({
            id: usage.assetId, sceneVersionId: usage.sceneVersionId, purpose: usage.purpose, kind: usage.asset.kind,
            licenseStatus: usage.asset.licenses[0]?.status ?? "UNKNOWN", usage: usage.usageSnapshot })),
          video: videoKey ? { key: videoKey, thumbnailKey: string(manifest.thumbnailKey), rendererVersion: string(manifest.rendererVersion), actualDurationSeconds: typeof qa.durationSeconds === "number" ? qa.durationSeconds : null } : null,
          quality: { technical: manifest.technicalQuality ?? null, policy: policy ? { id: policy.id, status: policy.status, reasons: policy.reasons } : null },
          // Return billing fields, never raw provider responses or journals.
          usage: content.providerUsages.map((usage) => ({ id: usage.id, productionJobId: usage.productionJobId, provider: usage.provider, model: usage.model,
            operation: usage.operation, quantity: usage.quantity.toString(), unit: usage.unit, currency: usage.currency,
            estimatedCost: usage.estimatedCost?.toString() ?? null, actualCost: usage.actualCost?.toString() ?? null })),
          reviewReasons: reasons, observedAt: new Date().toISOString()
        };
      });
      return ProductionResultsResponseSchema.parse({ contentItemId, results });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
