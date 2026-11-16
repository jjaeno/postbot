import { PolicyAutomationJobPayloadSchema } from "@postbot/contracts";
import { assertExecutionOwner, type Prisma, type PrismaClient } from "@postbot/database";
import { evaluatePolicy, type PolicyRule } from "@postbot/policy-engine";

const object = (value: Prisma.JsonValue): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const numberValue = (value: Prisma.JsonValue, keys: readonly string[], fallback: number): number => { const data = object(value); for (const key of keys) if (typeof data[key] === "number") return data[key]; return fallback; };
const booleanValue = (value: Prisma.JsonValue, keys: readonly string[]): boolean => { const data = object(value); return keys.some((key) => data[key] === true); };
const stringList = (value: Prisma.JsonValue): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : Array.isArray(object(value).terms) ? (object(value).terms as unknown[]).filter((entry): entry is string => typeof entry === "string") : [];
const similarity = (left: string, right: string): number => {
  const tokens = (value: string): Set<string> => new Set(value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((token) => token.length > 2));
  const a = tokens(left); const b = tokens(right); if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((token) => b.has(token)).length; return shared / (a.size + b.size - shared);
};

export class PolicyProcessor {
  constructor(private readonly prisma: PrismaClient) {}

  async process(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const input = PolicyAutomationJobPayloadSchema.parse(payload).policy;
    const currentScene = await this.prisma.sceneVersion.findFirst({ where: { contentItemId: input.contentItemId, platform: input.platform }, orderBy: { version: "desc" } });
    const item = await this.prisma.contentItem.findUniqueOrThrow({ where: { id: input.contentItemId }, include: {
      channel: { include: { contentItems: { where: { id: { not: input.contentItemId } }, include: { scriptVersions: { where: { platform: input.platform }, orderBy: { version: "desc" }, take: 1 } }, take: 50 } } },
      sourceReferences: true,
      assetUsages: {
        where: currentScene ? { sceneVersionId: currentScene.id } : { id: { in: [] } },
        include: { asset: { include: { licenses: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } } }
      },
      scriptVersions: { where: { platform: input.platform }, orderBy: { version: "desc" }, take: 1 }
    } });
    const ruleRecord = await this.prisma.policyRule.findFirstOrThrow({ where: { platform: input.platform, region: input.region, effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: "desc" }, { version: "desc" }] });
    const rule: PolicyRule = {
      platform: input.platform.toLowerCase() as PolicyRule["platform"], region: ruleRecord.region, version: String(ruleRecord.version), effectiveAt: ruleRecord.effectiveAt.toISOString(), checkedAt: new Date().toISOString(),
      maxDurationSeconds: numberValue(ruleRecord.durationRule, ["maxDurationSeconds", "maxSeconds"], 60), requiredDisclosure: booleanValue(ruleRecord.aiDisclosureRule, ["required", "discloseRealisticSyntheticMedia"]),
      restrictedTerms: stringList(ruleRecord.restrictedTopics), requireVerifiedAssets: booleanValue(ruleRecord.rightsRule, ["requireVerifiedAssets", "commercialUseRequired"]), requireCommercialUse: booleanValue(ruleRecord.rightsRule, ["commercialUseRequired"]),
      minimumSourceCount: numberValue(ruleRecord.originalityRule, ["minimumSourceCount"], 1), minimumSourceReliability: numberValue(ruleRecord.originalityRule, ["minimumSourceReliability"], 0.6), minimumOriginalityScore: numberValue(ruleRecord.originalityRule, ["minimumOriginalityScore"], 0.55)
    };
    const script = item.scriptVersions[0]; const metadata = object(script?.qualitySnapshot ?? {}); const nested = metadata.metadata; const description = nested && typeof nested === "object" && !Array.isArray(nested) && typeof (nested as Record<string, unknown>).description === "string" ? String((nested as Record<string, unknown>).description) : item.summary ?? "";
    const sourceUrls = new Set(item.sourceReferences.map((source) => source.url));
    const facts = Array.isArray(metadata.facts) ? metadata.facts as unknown[] : item.sourceReferences.flatMap((source): unknown[] => { const raw = object(source.normalizedSnapshot ?? {}); return Array.isArray(raw.facts) ? raw.facts as unknown[] : []; });
    const allFactsLinked = facts.length > 0 && facts.every((fact) => fact && typeof fact === "object" && !Array.isArray(fact) && typeof (fact as Record<string, unknown>).sourceUrl === "string" && sourceUrls.has(String((fact as Record<string, unknown>).sourceUrl)));
    const licenses = item.assetUsages.map((usage) => usage.asset.licenses[0]);
    const maximumSimilarity = item.channel.contentItems.reduce((maximum, other) => Math.max(maximum, similarity(script?.body ?? "", other.scriptVersions[0]?.body ?? "")), 0);
    const evaluation = evaluatePolicy(rule, {
      durationSeconds: script?.durationSeconds?.toNumber() ?? null, description, factsHaveSources: allFactsLinked,
      hasAiDisclosure: /(?:ai|인공지능)\s*(?:생성|generated|사용)/i.test(description), assetsVerified: licenses.length > 0 && licenses.every((license) => license?.status === "VERIFIED" && license.derivativeAllowed && (!license.validFrom || license.validFrom <= new Date()) && (!license.validUntil || license.validUntil > new Date())),
      commercialUseVerified: licenses.length > 0 && licenses.every((license) => license?.commercialUseAllowed === true), sourceCount: item.sourceReferences.length,
      minimumSourceReliability: item.sourceReferences.length > 0 ? Math.min(...item.sourceReferences.map((source) => source.reliabilityScore?.toNumber() ?? 0)) : null,
      conflictingSources: item.sourceReferences.some((source) => object(source.normalizedSnapshot ?? {}).conflicting === true), duplicateRisk: maximumSimilarity >= 0.75 || item.duplicateGroupKey !== null,
      originalityScore: script?.body ? 1 - maximumSimilarity : null, sensitiveTopic: rule.restrictedTerms.some((term) => `${typeof metadata.reviewTitle === "string" ? metadata.reviewTitle : item.title} ${item.summary ?? ""} ${script?.hook ?? ""} ${script?.body ?? ""} ${script?.callToAction ?? ""}`.toLowerCase().includes(term.toLowerCase())),
      forcedReview: item.riskLevel > 0, platformRuleViolations: script?.durationSeconds && script.durationSeconds.toNumber() < numberValue(ruleRecord.durationRule, ["minDurationSeconds", "minSeconds"], 0) ? ["Content duration is below the platform minimum."] : []
    });
    const dbStatus = evaluation.status === "pass" ? "PASS" : evaluation.status === "warning" || evaluation.status === "review" ? "WARNING" : "FAIL";
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      const check = await tx.policyCheck.create({ data: { contentItemId: item.id, policyRuleId: ruleRecord.id, platform: input.platform, status: dbStatus, reasons: evaluation.findings } });
      const snapshot = JSON.parse(JSON.stringify({ policy: rule, status: evaluation.status, findings: evaluation.findings })) as Prisma.InputJsonObject;
      await tx.policySnapshot.create({ data: { channelId: item.channelId, policyRuleId: ruleRecord.id, policyCheckId: check.id, checkedAt: now, snapshot } });
      if (script) await tx.scriptVersion.update({ where: { id: script.id }, data: { qualitySnapshot: { ...metadata, reviewStatus: evaluation.status === "pass" && item.channel.automationMode === "FULL_AUTO" ? "APPROVED" : evaluation.status === "block" ? "HELD" : "REVIEW_REQUIRED" }  } });
      await tx.contentItem.update({ where: { id: item.id }, data: evaluation.status === "block" ? { status: "HELD", heldReason: "POLICY_BLOCK" } : evaluation.status !== "pass" ? { status: "REVIEW_REQUIRED", heldReason: "POLICY_REVIEW" } : item.channel.automationMode === "FULL_AUTO" ? { status: "APPROVED", approvedAt: now, heldReason: null } : { status: "REVIEW_REQUIRED", heldReason: null } });
    });
    return { contentItemId: item.id, status: evaluation.status, findings: evaluation.findings, rightsVerified: licenses.length > 0 && licenses.every((license) => license?.status === "VERIFIED" && license.commercialUseAllowed), policyVersion: rule.version, effectiveAt: rule.effectiveAt, checkedAt: now.toISOString() };
  }
}
