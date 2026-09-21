import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@postbot/database";
import type { ContentReviewResponse, PolicyVerdict } from "@postbot/contracts";
import type { PolicyRuleRecord, ReviewRepository } from "./review.repository.js";

const json = (value: Prisma.JsonValue | null): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const verdictFromDb = (status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN", findings: readonly { severity: PolicyVerdict }[]): PolicyVerdict =>
  findings.some((finding) => finding.severity === "block") ? "block" : findings.some((finding) => finding.severity === "review") ? "review" : status === "PASS" ? "pass" : status === "WARNING" ? "warning" : "block";
const dbStatus = (status: PolicyVerdict): "PASS" | "WARNING" | "FAIL" => status === "pass" ? "PASS" : status === "block" ? "FAIL" : "WARNING";

@Injectable()
export class PrismaReviewRepository implements ReviewRepository {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async get(workspaceId: string, contentItemId: string): Promise<ContentReviewResponse | null> {
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: {
      sourceReferences: true, assetUsages: { include: { asset: { include: { licenses: true } } } }, scriptVersions: { orderBy: { version: "desc" }, take: 1 },
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
    return {
      id: item.id, channelId: item.channelId, status: item.status as ContentReviewResponse["status"], title: item.title, durationSeconds: item.scriptVersions[0]?.durationSeconds?.toNumber() ?? null,
      description: typeof metadata.description === "string" ? metadata.description : item.summary ?? "",
      sources: item.sourceReferences.map((source) => ({ title: source.title, url: source.url, sourceName: source.sourceName })),
      assets: item.assetUsages.map((usage) => ({ id: usage.assetId, licenseStatus: usage.asset.licenses[0]?.status ?? "PENDING", purpose: usage.purpose })),
      policy: check ? { status: verdictFromDb(check.status, findings), findings, snapshotId: snapshot?.id ?? null } : null
    };
  }

  async getRule(platform: PolicyRuleRecord["platform"], region: string, at: Date): Promise<PolicyRuleRecord | null> {
    const rule = await this.prisma.policyRule.findFirst({ where: { platform, region, effectiveAt: { lte: at } }, orderBy: [{ effectiveAt: "desc" }, { version: "desc" }] });
    return rule ? { ...rule, durationRule: json(rule.durationRule), originalityRule: json(rule.originalityRule), aiDisclosureRule: json(rule.aiDisclosureRule), rightsRule: json(rule.rightsRule), restrictedTopics: json(rule.restrictedTopics) } : null;
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
    const item = await this.prisma.contentItem.findFirst({ where: { id: contentItemId, channel: { workspaceId } }, include: { policyChecks: { orderBy: { checkedAt: "desc" }, take: 1 } } });
    if (!item) return null;
    if (action === "approve" && item.policyChecks[0]?.status !== "PASS") return "POLICY_GATE";
    const target = action === "approve" ? "APPROVED" : action === "schedule" ? "SCHEDULED" : "HELD";
    if (action === "schedule" && item.status !== "APPROVED") return "INVALID_TRANSITION";
    if (action === "approve" && !["REVIEW_REQUIRED", "HELD"].includes(item.status)) return "INVALID_TRANSITION";
    await this.prisma.contentItem.update({ where: { id: contentItemId }, data: { status: target, approvedAt: action === "approve" ? new Date() : null, heldReason: action === "hold" ? "MANUAL_HOLD" : action === "discard" ? "DISCARDED" : null } });
    return this.get(workspaceId, contentItemId);
  }
}
