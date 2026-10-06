import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@postbot/database";
import type { ContentReviewResponse, PolicyVerdict, UpdateReviewMetadataRequest, UpdateReviewScriptRequest, ReviewAssetLicenseRequest } from "@postbot/contracts";
import { SceneDocumentSchema } from "@postbot/scene-schema";
import { readAssetUsagePurpose, sceneAssetUsageKey } from "@postbot/asset-library";
import type { PolicyEvidence, PolicyRuleRecord, ReviewRepository } from "./review.repository.js";

const json = (value: Prisma.JsonValue | null): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const verdictFromDb = (status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN", findings: readonly { severity: PolicyVerdict }[]): PolicyVerdict =>
  findings.some((finding) => finding.severity === "block") ? "block" : findings.some((finding) => finding.severity === "review") ? "review" : status === "PASS" ? "pass" : status === "WARNING" ? "warning" : "block";
const dbStatus = (status: PolicyVerdict): "PASS" | "WARNING" | "FAIL" => status === "pass" ? "PASS" : status === "block" ? "FAIL" : "WARNING";
const lexicalSimilarity = (left: string, right: string): number => {
  const tokens = (value: string): Set<string> => new Set(value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((token) => token.length > 2));
  const a = tokens(left); const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
};

@Injectable()
export class PrismaReviewRepository implements ReviewRepository {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}
  async reviewAssetLicense(workspaceId: string, userId: string, contentItemId: string, input: ReviewAssetLicenseRequest): Promise<boolean> {
    const asset = await this.prisma.asset.findFirst({ where: { id: input.assetId, channel: { workspaceId }, usages: { some: { contentItemId, contentItem: { channel: { workspaceId } } } } } });
    if (!asset) return false;
    await this.prisma.$transaction(async (tx) => {
      await tx.assetLicense.create({ data: { assetId: asset.id, status: input.status, licenseName: input.licenseName, proofUrl: input.proofUrl, commercialUseAllowed: input.commercialUseAllowed, derivativeAllowed: input.derivativeAllowed, checkedAt: new Date() } });
      await tx.auditLog.create({ data: { workspaceId, userId, action: "asset.license.review", targetType: "asset", targetId: asset.id, metadata: { status: input.status } } });
      const usages = await tx.assetUsage.findMany({ where: { assetId: asset.id, contentItem: { channel: { workspaceId } } }, include: { sceneVersion: true } });
      const affected = new Set<string>();
      for (const usage of usages) {
        const candidates = usage.sceneVersion ? [usage.sceneVersion] : await tx.sceneVersion.findMany({ where: { contentItemId: usage.contentItemId }, orderBy: { version: "desc" }, distinct: ["platform"] });
        for (const scene of candidates) {
          const latest = await tx.sceneVersion.findFirst({ where: { contentItemId: scene.contentItemId, platform: scene.platform }, orderBy: { version: "desc" } });
          if (latest?.id !== scene.id || affected.has(scene.id)) continue;
          affected.add(scene.id);
          const scope = { contentItemId: scene.contentItemId, platform: scene.platform };
          const scripts = await tx.scriptVersion.findMany({ where: scope });
          for (const script of scripts) await tx.scriptVersion.update({ where: { id: script.id }, data: { qualitySnapshot: { ...json(script.qualitySnapshot), reviewStatus: "REVIEW_REQUIRED" } } });
          if (scene.platform) {
            const platformScope = { contentItemId: scene.contentItemId, platform: scene.platform };
            const check = await tx.policyCheck.findFirst({ where: platformScope, orderBy: { checkedAt: "desc" } });
            if (check) await tx.policyCheck.create({ data: { ...platformScope, policyRuleId: check.policyRuleId, status: "UNKNOWN", reasons: [{ code: "LICENSE_REVIEW_CHANGED", message: "권리 증빙 변경 후 정책 재검사가 필요합니다." }] } });
            await tx.publishPlan.updateMany({ where: { ...platformScope, status: "SCHEDULED" }, data: { status: "HELD" } });
          }
          const activePlans = await tx.publishPlan.count({ where: { contentItemId: scene.contentItemId, status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] } } });
          if (!activePlans) await tx.contentItem.update({ where: { id: scene.contentItemId }, data: { status: "REVIEW_REQUIRED" } });
          if (input.status !== "VERIFIED") continue;
          const sceneUsages = await tx.assetUsage.findMany({ where: { sceneVersionId: scene.id }, include: { asset: { include: { licenses: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } } } });
          const now = new Date();
          if (!sceneUsages.length || !sceneUsages.every((record) => {
            const license = record.asset.licenses[0];
            return license?.status === "VERIFIED" && license.commercialUseAllowed && license.derivativeAllowed && (!license.validFrom || license.validFrom <= now) && (!license.validUntil || license.validUntil > now);
          })) continue;
          const steps = await tx.automationStep.findMany({ where: { stage: "ASSET", platform: scene.platform, status: "HELD", errorCode: "ASSET_LICENSE_REVIEW_REQUIRED", automationRun: { channel: { workspaceId }, status: { in: ["RUNNING", "PAUSED"] } } } });
          for (const step of steps) {
            const result = json(step.output);
            const records = Array.isArray(result.assets) ? result.assets : [];
            if (!records.some((record) => json(record as Prisma.JsonValue).assetId === asset.id) || !step.productionJobId) continue;
            const job = await tx.productionJob.findUnique({ where: { id: step.productionJobId } });
            const preparation = json(json(job?.payload ?? null).assetPreparation as Prisma.JsonValue);
            if (preparation.sceneVersionId !== scene.id || job?.status !== "NEEDS_REVIEW") continue;
            await tx.automationStep.update({ where: { id: step.id }, data: { status: "PENDING", errorCode: null, errorMessage: null, finishedAt: null } });
            await tx.automationRun.update({ where: { id: step.automationRunId }, data: { status: "QUEUED", pausedReason: null, nextRunAt: now } });
          }
        }
      }
    });
    return true;
  }

  async get(workspaceId: string, contentItemId: string): Promise<ContentReviewResponse | null> {
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: {
      sourceReferences: true, assetUsages: { include: { asset: { include: { licenses: { orderBy: { checkedAt: "desc" }, take: 1 } } } } }, scriptVersions: { orderBy: { version: "desc" } }, sceneVersions: { orderBy: { version: "desc" } }, contentIdeas: { take: 1 },
      policyChecks: { orderBy: { checkedAt: "desc" }, include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } } },
      publishPlans: { orderBy: { createdAt: "desc" } }
    } });
    if (!item) return null;
    const readPolicy = (policyCheck: (typeof item.policyChecks)[number] | undefined) => {
      const policySnapshot = policyCheck?.snapshots[0];
      const policySnapshotData = json(policySnapshot?.snapshot ?? null);
      const policyFindings = (Array.isArray(policySnapshotData.findings) ? policySnapshotData.findings : []).flatMap((finding) => {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)) return [];
        const value = finding as Record<string, unknown>;
        return typeof value.code === "string" && typeof value.message === "string" && ["pass", "warning", "review", "block"].includes(String(value.severity)) ? [{ code: value.code, message: value.message, severity: value.severity as PolicyVerdict }] : [];
      });
      return policyCheck ? { status: verdictFromDb(policyCheck.status, policyFindings), findings: policyFindings, snapshotId: policySnapshot?.id ?? null } : null;
    };
    const scriptMetadata = json(item.scriptVersions[0]?.qualitySnapshot ?? null).metadata;
    const metadata = scriptMetadata && typeof scriptMetadata === "object" && !Array.isArray(scriptMetadata) ? scriptMetadata as Record<string, unknown> : {};
    const check = item.policyChecks[0];
    const seenPlatforms = new Set<string>();
    const outputs = item.scriptVersions.flatMap((script) => {
      const key = script.platform ?? "COMMON"; if (seenPlatforms.has(key)) return []; seenPlatforms.add(key);
      const scene = item.sceneVersions.find((candidate) => candidate.platform === script.platform && candidate.scriptVersionId === script.id) ?? item.sceneVersions.find((candidate) => candidate.platform === script.platform);
      const rawMetadata = json(script.qualitySnapshot).metadata; const outputMetadata = rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata) ? rawMetadata as Record<string, unknown> : {};
      const platformCheck = item.policyChecks.find((candidate) => candidate.platform === script.platform);
      const publishPlan = item.publishPlans.find((candidate) => candidate.platform === script.platform);
      const scriptQuality = json(script.qualitySnapshot);
      const reviewStatus = scriptQuality.reviewStatus === "APPROVED" ? "APPROVED" as const : scriptQuality.reviewStatus === "HELD" ? "HELD" as const : scriptQuality.reviewStatus === "DISCARDED" ? "DISCARDED" as const : "REVIEW_REQUIRED" as const;
      return [{ script: { hook: script.hook, body: script.body, callToAction: script.callToAction, language: script.language }, durationSeconds: script.durationSeconds?.toNumber() ?? null, title: typeof scriptQuality.reviewTitle === "string" ? scriptQuality.reviewTitle : item.title, reviewStatus, platform: script.platform, scriptVersionId: script.id, sceneVersionId: scene?.id ?? null, scriptStatus: "ready" as const, renderStatus: scene?.renderManifest ? "ready" as const : "pending" as const, videoReady: Boolean(scene?.renderManifest), metadata: { description: typeof outputMetadata.description === "string" ? outputMetadata.description : item.summary ?? item.title, hashtags: Array.isArray(outputMetadata.hashtags) ? outputMetadata.hashtags.filter((tag): tag is string => typeof tag === "string") : [] }, policy: platformCheck && platformCheck.checkedAt >= script.createdAt && (!scene || platformCheck.checkedAt >= scene.createdAt) ? readPolicy(platformCheck) : null, publishStatus: publishPlan?.status ?? null }];
    });
    return {
      id: item.id, channelId: item.channelId, status: item.status as ContentReviewResponse["status"], title: item.title, durationSeconds: item.scriptVersions[0]?.durationSeconds?.toNumber() ?? null,
      description: typeof metadata.description === "string" ? metadata.description : item.summary ?? "",
      sources: item.sourceReferences.map((source) => ({ title: source.title, url: source.url, sourceName: source.sourceName })),
      assets: item.assetUsages.map((usage) => ({ id: usage.assetId, sceneVersionId: usage.sceneVersionId, licenseStatus: usage.asset.licenses[0]?.status ?? "PENDING", purpose: usage.purpose })),
      policy: readPolicy(check),
      ideaId: item.contentIdeas[0]?.id ?? null,
      outputs
    };
  }

  async updateMetadata(workspaceId: string, contentItemId: string, input: UpdateReviewMetadataRequest): Promise<ContentReviewResponse | null> {
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: { scriptVersions: { where: { platform: input.platform }, orderBy: { version: "desc" }, take: 1 }, sceneVersions: { where: { platform: input.platform }, orderBy: { version: "desc" }, take: 1 } } });
    if (!item || !item.scriptVersions[0]) return null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${item.channelId} FOR UPDATE`;
      const script = await tx.scriptVersion.findFirstOrThrow({ where: { contentItemId, platform: input.platform }, orderBy: { version: "desc" } });
      const priorQuality = { ...json(script.qualitySnapshot), reviewStatus: "REVIEW_REQUIRED" };
      const nextVersion = script.version + 1;
      await tx.scriptVersion.create({ data: { contentItemId, version: nextVersion, platform: input.platform, hook: script.hook, body: script.body, callToAction: script.callToAction, language: script.language, durationSeconds: script.durationSeconds, promptVersion: script.promptVersion, qualitySnapshot: { ...priorQuality, reviewTitle: input.title, metadata: { description: input.description, hashtags: input.hashtags }, editedBy: "review" } } });
      // Metadata edits reuse the rendered scene and its asset/license evidence.
      if (input.platform) await tx.publishPlan.updateMany({ where: { contentItemId, platform: input.platform, status: "SCHEDULED" }, data: { status: "HELD" } });
      // Platform titles live in the version snapshot, not the shared planning title.
      await tx.contentItem.update({ where: { id: contentItemId }, data: { status: "REVIEW_REQUIRED", approvedAt: null } });
    });
    return this.get(workspaceId, contentItemId);
  }

  async updateScript(workspaceId: string, userId: string, contentItemId: string, input: UpdateReviewScriptRequest): Promise<ContentReviewResponse | null> {
    const owned = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId }, sourceReferences: { some: { url: input.sourceUrl } } } });
    if (!owned) return null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${owned.channelId} FOR UPDATE`;
      const script = await tx.scriptVersion.findFirstOrThrow({ where: { contentItemId, platform: input.platform }, orderBy: { version: "desc" } });
      const scene = await tx.sceneVersion.findFirstOrThrow({ where: { contentItemId, platform: input.platform }, orderBy: { version: "desc" } });
      const document = SceneDocumentSchema.parse(scene.sceneDocument);
      const text = [input.hook, input.body, input.callToAction].join(" ");
      const words = text.split(/\s+/); const chunk = Math.ceil(words.length / document.scenes.length);
      document.scenes = document.scenes.map((entry, index) => ({ ...entry, narration: { text: words.slice(index * chunk, (index + 1) * chunk).join(" ") || input.callToAction, sourceUrl: input.sourceUrl }, overlays: entry.overlays.map((overlay) => ({ ...overlay, text: (overlay.kind === "title" ? input.hook : overlay.kind === "cta" ? input.callToAction : input.body).slice(0, 120) })) }));
      SceneDocumentSchema.parse(document);
      const nextScript = await tx.scriptVersion.create({ data: { contentItemId, platform: input.platform, version: script.version + 1, hook: input.hook, body: input.body, callToAction: input.callToAction, language: script.language, durationSeconds: script.durationSeconds, promptVersion: script.promptVersion, qualitySnapshot: { ...json(script.qualitySnapshot), reviewStatus: "REVIEW_REQUIRED", facts: [{ claim: text, sourceUrl: input.sourceUrl }], factsConfirmedBy: userId, editedBy: "owner-script-review" } } });
      const nextScene = await tx.sceneVersion.create({ data: { contentItemId, scriptVersionId: nextScript.id, platform: input.platform, version: nextScript.version, schemaVersion: scene.schemaVersion, sceneDocument: document, durationSeconds: scene.durationSeconds } });
      const usages = await tx.assetUsage.findMany({ where: { sceneVersionId: scene.id } });
      for (const usage of usages) {
        const purpose = readAssetUsagePurpose(usage); if (!purpose.startsWith("scene-image:")) continue;
        await tx.assetUsage.create({ data: { assetId: usage.assetId, contentItemId, sceneVersionId: nextScene.id, purpose: sceneAssetUsageKey(purpose, nextScene.id), usageSnapshot: { ...json(usage.usageSnapshot), originalPurpose: purpose } } });
      }
      await tx.publishPlan.updateMany({ where: { contentItemId, platform: input.platform, status: "SCHEDULED" }, data: { status: "HELD" } });
      await tx.contentItem.update({ where: { id: contentItemId }, data: { status: "REVIEW_REQUIRED", approvedAt: null } });
      await tx.auditLog.create({ data: { workspaceId, userId, action: "review.script.edit_and_confirm_sources", targetType: "script_version", targetId: nextScript.id } });
    });
    return this.get(workspaceId, contentItemId);
  }

  async getPreviewKey(workspaceId: string, contentItemId: string, platform: PolicyRuleRecord["platform"] | null): Promise<string | null> {
    const scene = await this.prisma.sceneVersion.findFirst({ where: { contentItemId, platform, contentItem: { channel: { workspaceId } }, renderManifest: { not: Prisma.DbNull } }, orderBy: { version: "desc" }, select: { renderManifest: true } });
    const manifest = json(scene?.renderManifest ?? null);
    return typeof manifest.videoKey === "string" ? manifest.videoKey : null;
  }

  async getRule(platform: PolicyRuleRecord["platform"], region: string, at: Date): Promise<PolicyRuleRecord | null> {
    const rule = await this.prisma.policyRule.findFirst({ where: { platform, region, effectiveAt: { lte: at } }, orderBy: [{ effectiveAt: "desc" }, { version: "desc" }] });
    return rule;
  }

  async getEvidence(workspaceId: string, contentItemId: string, platform: PolicyRuleRecord["platform"], restrictedTerms: readonly string[], minDurationSeconds: number): Promise<PolicyEvidence | null> {
    const currentScene = await this.prisma.sceneVersion.findFirst({ where: { contentItemId, platform, contentItem: { channel: { workspaceId } } }, orderBy: { version: "desc" } });
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: {
      sourceReferences: true,
      assetUsages: { where: currentScene ? { sceneVersionId: currentScene.id } : { id: { in: [] } }, include: { asset: { include: { licenses: { orderBy: { checkedAt: "desc" }, take: 1 } } } } },
      scriptVersions: { where: { platform }, orderBy: { version: "desc" }, take: 1 },
      channel: { select: { contentItems: { where: { id: { not: contentItemId } }, include: { scriptVersions: { orderBy: { version: "desc" }, take: 1 } }, take: 50 } } }
    } });
    if (!item) return null;
    const sourceUrls = new Set(item.sourceReferences.map((source) => source.url));
    const quality = json(item.scriptVersions[0]?.qualitySnapshot ?? null);
    const facts = typeof quality.factsConfirmedBy === "string" && Array.isArray(quality.facts) ? quality.facts as unknown[] : item.sourceReferences.flatMap((source) => {
      const snapshot = json(source.normalizedSnapshot);
      return Array.isArray(snapshot.facts) ? snapshot.facts as unknown[] : [];
    });
    const linkedFacts = facts.filter((fact) => fact && typeof fact === "object" && !Array.isArray(fact) && typeof (fact as Record<string, unknown>).sourceUrl === "string" && sourceUrls.has(String((fact as Record<string, unknown>).sourceUrl)));
    const conflictingSources = item.sourceReferences.some((source) => {
      const snapshot = json(source.normalizedSnapshot);
      return snapshot.conflicting === true || (Array.isArray(snapshot.conflictsWith) && snapshot.conflictsWith.length > 0);
    });
    const currentBody = item.scriptVersions[0]?.body ?? "";
    const similarity = item.channel.contentItems.reduce((maximum, other) => Math.max(maximum, lexicalSimilarity(currentBody, other.scriptVersions[0]?.body ?? "")), 0);
    const duration = item.scriptVersions[0]?.durationSeconds?.toNumber() ?? null;
    const script = item.scriptVersions[0];
    const text = `${typeof quality.reviewTitle === "string" ? quality.reviewTitle : item.title} ${item.summary ?? ""} ${script?.hook ?? ""} ${currentBody} ${script?.callToAction ?? ""}`.toLowerCase();
    const licenses = item.assetUsages.map((usage) => usage.asset.licenses[0]);
    return {
      factsHaveSources: facts.length > 0 && facts.length === linkedFacts.length,
      sourceCount: item.sourceReferences.length,
      minimumSourceReliability: item.sourceReferences.length > 0 ? Math.min(...item.sourceReferences.map((source) => source.reliabilityScore?.toNumber() ?? 0)) : null,
      conflictingSources,
      assetsVerified: licenses.length > 0 && licenses.every((license) => license?.status === "VERIFIED"),
      commercialUseVerified: licenses.length > 0 && licenses.every((license) => license?.commercialUseAllowed === true),
      duplicateRisk: similarity >= 0.75 || item.duplicateGroupKey !== null,
      originalityScore: currentBody ? 1 - similarity : null,
      sensitiveTopic: restrictedTerms.some((term) => text.includes(term.toLowerCase())),
      forcedReview: item.riskLevel > 0,
      platformRuleViolations: duration !== null && duration < minDurationSeconds ? [`Content duration is below ${minDurationSeconds} seconds.`] : []
    };
  }

  async saveCheck(workspaceId: string, contentItemId: string, rule: PolicyRuleRecord, status: PolicyVerdict, findings: readonly { code: string; severity: PolicyVerdict; message: string }[]): Promise<ContentReviewResponse | null> {
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, select: { id: true, channelId: true } });
    if (!item) return null;
    await this.prisma.$transaction(async (tx) => {
      const check = await tx.policyCheck.create({ data: { contentItemId, policyRuleId: rule.id, platform: rule.platform, status: dbStatus(status), reasons: findings } });
      await tx.policySnapshot.create({ data: { channelId: item.channelId, policyRuleId: rule.id, policyCheckId: check.id, checkedAt: new Date(), snapshot: { policy: { platform: rule.platform, region: rule.region, version: rule.version, effectiveAt: rule.effectiveAt.toISOString(), checkedAt: rule.checkedAt.toISOString() }, status, findings } } });
      await tx.contentItem.update({ where: { id: contentItemId }, data: status === "block" ? { status: "HELD", heldReason: "POLICY_BLOCK" } : { status: "REVIEW_REQUIRED", heldReason: null } });
    });
    return this.get(workspaceId, contentItemId);
  }

  async act(workspaceId: string, contentItemId: string, action: "approve" | "hold" | "discard" | "schedule", platform?: PolicyRuleRecord["platform"]): Promise<ContentReviewResponse | "POLICY_GATE" | "INVALID_TRANSITION" | null> {
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: {
      policyChecks: { where: platform ? { platform } : undefined, orderBy: { checkedAt: "desc" }, take: 1 },
      scriptVersions: { where: platform ? { platform } : undefined, orderBy: { version: "desc" }, take: 1 },
      sceneVersions: { where: platform ? { platform } : undefined, orderBy: { version: "desc" }, take: 1 },
      publishPlans: { where: { status: "SCHEDULED", ...(platform ? { platform } : {}) }, take: 1 }
    } });
    if (!item) return null;
    const check = item.policyChecks[0];
    const script = item.scriptVersions[0];
    const scene = item.sceneVersions[0];
    if (action === "approve" && (check?.status !== "PASS" || !script || !scene || !scene.renderManifest || check.checkedAt < script.createdAt || check.checkedAt < scene.createdAt)) return "POLICY_GATE";
    const target = action === "approve" ? "APPROVED" : action === "schedule" ? "SCHEDULED" : "HELD";
    if (action === "schedule" && (item.status !== "APPROVED" || item.publishPlans.length === 0)) return "INVALID_TRANSITION";
    if (action === "approve" && !["REVIEW_REQUIRED", "HELD", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED"].includes(item.status)) return "INVALID_TRANSITION";
    const affectedScripts = await this.prisma.scriptVersion.findMany({ where: { contentItemId, ...(platform ? { platform } : {}) }, orderBy: { version: "desc" } });
    const seen = new Set<string>();
    const latestScripts = affectedScripts.filter((candidate) => { const key = candidate.platform ?? "COMMON"; if (seen.has(key)) return false; seen.add(key); return true; });
    if (action === "approve") {
      for (const candidate of latestScripts) {
        const [currentCheck, currentScene] = await Promise.all([
          this.prisma.policyCheck.findFirst({ where: { contentItemId, ...(candidate.platform ? { platform: candidate.platform } : {}) }, orderBy: { checkedAt: "desc" } }),
          this.prisma.sceneVersion.findFirst({ where: { contentItemId, platform: candidate.platform }, orderBy: { version: "desc" } })
        ]);
        if (currentCheck?.status !== "PASS" || !currentScene?.renderManifest || currentCheck.checkedAt < candidate.createdAt || currentCheck.checkedAt < currentScene.createdAt) return "POLICY_GATE";
      }
    }
    for (const candidate of latestScripts) {
      await this.prisma.scriptVersion.update({ where: { id: candidate.id }, data: { qualitySnapshot: { ...json(candidate.qualitySnapshot), reviewStatus: action === "approve" ? "APPROVED" : action === "discard" ? "DISCARDED" : action === "hold" ? "HELD" : "APPROVED" }  } });
    }
    const retainPublishingStatus = platform && ["SCHEDULED", "PUBLISHING", "PUBLISHED"].includes(item.status);
    await this.prisma.contentItem.update({ where: { id: contentItemId }, data: { status: retainPublishingStatus ? item.status : platform && action !== "approve" ? "REVIEW_REQUIRED" : target, approvedAt: action === "approve" ? new Date() : undefined, heldReason: platform ? undefined : action === "hold" ? "MANUAL_HOLD" : action === "discard" ? "DISCARDED" : null } });
    if (action === "approve") {
      const scriptSteps = await this.prisma.automationStep.findMany({
        where: { stage: "SCRIPT", automationRun: { channelId: item.channelId } },
        select: { automationRunId: true, output: true }
      });
      const runIds = scriptSteps.filter((step) => json(step.output).contentItemId === contentItemId).map((step) => step.automationRunId);
      if (runIds.length > 0) {
        await this.prisma.$transaction([
          this.prisma.automationStep.updateMany({ where: { automationRunId: { in: runIds }, stage: "PUBLISH", status: "HELD", errorCode: "AWAITING_APPROVAL", ...(platform ? { platform } : {}) }, data: { status: "PENDING", errorCode: null, errorMessage: null, finishedAt: null } }),
          this.prisma.automationRun.updateMany({ where: { id: { in: runIds }, status: "PAUSED" }, data: { status: "QUEUED", pausedReason: null, nextRunAt: new Date() } })
        ]);
      }
    }
    return this.get(workspaceId, contentItemId);
  }
}
