import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@postbot/database";
import type { ContentReviewResponse, PolicyVerdict, UpdateReviewMetadataRequest } from "@postbot/contracts";
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

  async get(workspaceId: string, contentItemId: string): Promise<ContentReviewResponse | null> {
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: {
      sourceReferences: true, assetUsages: { include: { asset: { include: { licenses: true } } } }, scriptVersions: { orderBy: { version: "desc" } }, sceneVersions: { orderBy: { version: "desc" } }, contentIdeas: { take: 1 },
      policyChecks: { orderBy: { checkedAt: "desc" }, take: 1, include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } } }
    } });
    if (!item) return null;
    const scriptMetadata = json(item.scriptVersions[0]?.qualitySnapshot ?? null).metadata;
    const metadata = scriptMetadata && typeof scriptMetadata === "object" && !Array.isArray(scriptMetadata) ? scriptMetadata as Record<string, unknown> : {};
    const check = item.policyChecks[0];
    const snapshot = check?.snapshots[0];
    const snapshotData = json(snapshot?.snapshot ?? null);
    const rawFindings = Array.isArray(snapshotData.findings) ? snapshotData.findings : [];
    const findings = rawFindings.flatMap((finding) => {
      if (!finding || typeof finding !== "object" || Array.isArray(finding)) return [];
      const value = finding as Record<string, unknown>;
      return typeof value.code === "string" && typeof value.message === "string" && ["pass", "warning", "review", "block"].includes(String(value.severity)) ? [{ code: value.code, message: value.message, severity: value.severity as PolicyVerdict }] : [];
    });
    const seenPlatforms = new Set<string>();
    const outputs = item.scriptVersions.flatMap((script) => {
      const key = script.platform ?? "COMMON"; if (seenPlatforms.has(key)) return []; seenPlatforms.add(key);
      const scene = item.sceneVersions.find((candidate) => candidate.platform === script.platform && candidate.scriptVersionId === script.id) ?? item.sceneVersions.find((candidate) => candidate.platform === script.platform);
      const rawMetadata = json(script.qualitySnapshot).metadata; const outputMetadata = rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata) ? rawMetadata as Record<string, unknown> : {};
      return [{ platform: script.platform, scriptVersionId: script.id, sceneVersionId: scene?.id ?? null, scriptStatus: "ready" as const, renderStatus: scene?.renderManifest ? "ready" as const : "pending" as const, videoReady: Boolean(scene?.renderManifest), metadata: { description: typeof outputMetadata.description === "string" ? outputMetadata.description : item.summary ?? item.title, hashtags: Array.isArray(outputMetadata.hashtags) ? outputMetadata.hashtags.filter((tag): tag is string => typeof tag === "string") : [] } }];
    });
    return {
      id: item.id, channelId: item.channelId, status: item.status as ContentReviewResponse["status"], title: item.title, durationSeconds: item.scriptVersions[0]?.durationSeconds?.toNumber() ?? null,
      description: typeof metadata.description === "string" ? metadata.description : item.summary ?? "",
      sources: item.sourceReferences.map((source) => ({ title: source.title, url: source.url, sourceName: source.sourceName })),
      assets: item.assetUsages.map((usage) => ({ id: usage.assetId, licenseStatus: usage.asset.licenses[0]?.status ?? "PENDING", purpose: usage.purpose })),
      policy: check ? { status: verdictFromDb(check.status, findings), findings, snapshotId: snapshot?.id ?? null } : null,
      ideaId: item.contentIdeas[0]?.id ?? null,
      outputs
    };
  }

  async updateMetadata(workspaceId: string, contentItemId: string, input: UpdateReviewMetadataRequest): Promise<ContentReviewResponse | null> {
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: { scriptVersions: { where: { platform: input.platform }, orderBy: { version: "desc" }, take: 1 }, sceneVersions: { where: { platform: input.platform }, orderBy: { version: "desc" }, take: 1 } } });
    const script = item?.scriptVersions[0]; if (!item || !script) return null;
    const priorQuality = json(script.qualitySnapshot);
    await this.prisma.$transaction(async (tx) => {
      const nextVersion = script.version + 1;
      const created = await tx.scriptVersion.create({ data: { contentItemId, version: nextVersion, platform: input.platform, hook: script.hook, body: script.body, callToAction: script.callToAction, language: script.language, durationSeconds: script.durationSeconds, promptVersion: script.promptVersion, qualitySnapshot: { ...priorQuality, metadata: { description: input.description, hashtags: input.hashtags }, editedBy: "review" } } });
      const scene = item.sceneVersions[0];
      if (scene) await tx.sceneVersion.create({ data: { contentItemId, scriptVersionId: created.id, version: nextVersion, schemaVersion: scene.schemaVersion, platform: input.platform, sceneDocument: scene.sceneDocument as Prisma.InputJsonValue, renderManifest: scene.renderManifest === null ? undefined : scene.renderManifest as Prisma.InputJsonValue, durationSeconds: scene.durationSeconds } });
      await tx.contentItem.update({ where: { id: contentItemId }, data: { title: input.title, status: "REVIEW_REQUIRED", approvedAt: null } });
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

  async getEvidence(workspaceId: string, contentItemId: string, restrictedTerms: readonly string[], minDurationSeconds: number): Promise<PolicyEvidence | null> {
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: {
      sourceReferences: true,
      assetUsages: { include: { asset: { include: { licenses: { orderBy: { checkedAt: "desc" }, take: 1 } } } } },
      scriptVersions: { orderBy: { version: "desc" }, take: 1 },
      channel: { select: { contentItems: { where: { id: { not: contentItemId } }, include: { scriptVersions: { orderBy: { version: "desc" }, take: 1 } }, take: 50 } } }
    } });
    if (!item) return null;
    const sourceUrls = new Set(item.sourceReferences.map((source) => source.url));
    const facts = item.sourceReferences.flatMap((source) => {
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
    const text = `${item.title} ${item.summary ?? ""} ${currentBody}`.toLowerCase();
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

  async act(workspaceId: string, contentItemId: string, action: "approve" | "hold" | "discard" | "schedule"): Promise<ContentReviewResponse | "POLICY_GATE" | "INVALID_TRANSITION" | null> {
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: { policyChecks: { orderBy: { checkedAt: "desc" }, take: 1 }, publishPlans: { where: { status: "SCHEDULED" }, take: 1 } } });
    if (!item) return null;
    if (action === "approve" && item.policyChecks[0]?.status !== "PASS") return "POLICY_GATE";
    const target = action === "approve" ? "APPROVED" : action === "schedule" ? "SCHEDULED" : "HELD";
    if (action === "schedule" && (item.status !== "APPROVED" || item.publishPlans.length === 0)) return "INVALID_TRANSITION";
    if (action === "approve" && !["REVIEW_REQUIRED", "HELD"].includes(item.status)) return "INVALID_TRANSITION";
    await this.prisma.contentItem.update({ where: { id: contentItemId }, data: { status: target, approvedAt: action === "approve" ? new Date() : null, heldReason: action === "hold" ? "MANUAL_HOLD" : action === "discard" ? "DISCARDED" : null } });
    return this.get(workspaceId, contentItemId);
  }
}
