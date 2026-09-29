import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PlatformSchema, ReviewActionRequestSchema, RunPolicyCheckRequestSchema, UpdateReviewMetadataRequestSchema, type ContentReviewResponse, type UpdateReviewMetadataRequest } from "@postbot/contracts";
import { evaluatePolicy, type PolicyRule } from "@postbot/policy-engine";
import { loadConfig } from "@postbot/config";
import { FakeStorageProvider, S3StorageProvider, type StorageProvider } from "@postbot/providers";
import { REVIEW_REPOSITORY, type PolicyRuleRecord, type ReviewRepository } from "./review.repository.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asStringList = (value: unknown, key: string): string[] => {
  const raw = Array.isArray(value) ? value : record(value)[key];
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
};
const asBoolean = (value: unknown, keys: readonly string[]): boolean => keys.some((key) => record(value)[key] === true);
const asNumber = (value: unknown, keys: readonly string[], fallback: number): number => {
  for (const key of keys) { const raw = record(value)[key]; if (typeof raw === "number") return raw; }
  return fallback;
};

const toRule = (rule: PolicyRuleRecord): PolicyRule => ({
  platform: rule.platform.toLocaleLowerCase() as PolicyRule["platform"], region: rule.region, version: String(rule.version), effectiveAt: rule.effectiveAt.toISOString(), checkedAt: rule.checkedAt.toISOString(),
  maxDurationSeconds: asNumber(rule.durationRule, ["maxDurationSeconds", "maxSeconds"], 60),
  requiredDisclosure: asBoolean(rule.aiDisclosureRule, ["required", "discloseRealisticSyntheticMedia"]),
  restrictedTerms: asStringList(rule.restrictedTopics, "terms"),
  requireVerifiedAssets: asBoolean(rule.rightsRule, ["requireVerifiedAssets", "commercialUseRequired"]),
  requireCommercialUse: asBoolean(rule.rightsRule, ["commercialUseRequired"]),
  minimumSourceCount: asNumber(rule.originalityRule, ["minimumSourceCount"], 1),
  minimumSourceReliability: asNumber(rule.originalityRule, ["minimumSourceReliability"], 0.6),
  minimumOriginalityScore: asNumber(rule.originalityRule, ["minimumOriginalityScore"], 0.55)
});

@Injectable()
export class ReviewService {
  private readonly storage: StorageProvider;
  constructor(@Inject(REVIEW_REPOSITORY) private readonly repository: ReviewRepository) {
    const config = loadConfig();
    this.storage = config.STORAGE_PROVIDER === "s3" ? new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }) : new FakeStorageProvider();
  }
  async get(workspaceId: string, contentItemId: string): Promise<ContentReviewResponse> {
    const review = await this.repository.get(workspaceId, contentItemId);
    if (!review) throw new NotFoundException({ code: "CONTENT_NOT_FOUND", message: "Content was not found." });
    return review;
  }
  async check(workspaceId: string, contentItemId: string, raw: unknown): Promise<ContentReviewResponse> {
    const input = RunPolicyCheckRequestSchema.parse(raw);
    const review = await this.get(workspaceId, contentItemId);
    const rule = await this.repository.getRule(input.platform, input.region, new Date());
    if (!rule) throw new ConflictException({ code: "POLICY_RULE_NOT_FOUND", message: "No effective policy rule is configured." });
    const normalizedRule = toRule(rule);
    const evidence = await this.repository.getEvidence(workspaceId, contentItemId, normalizedRule.restrictedTerms, asNumber(rule.durationRule, ["minDurationSeconds", "minSeconds"], 0));
    if (!evidence) throw new NotFoundException({ code: "CONTENT_NOT_FOUND", message: "Content was not found." });
    const evaluation = evaluatePolicy(normalizedRule, {
      durationSeconds: review.durationSeconds, description: review.description,
      hasAiDisclosure: /(?:ai|인공지능)\s*(?:생성|generated|사용)/i.test(review.description),
      ...evidence
    });
    const saved = await this.repository.saveCheck(workspaceId, contentItemId, rule, evaluation.status, evaluation.findings);
    if (!saved) throw new NotFoundException({ code: "CONTENT_NOT_FOUND", message: "Content was not found." });
    return saved;
  }
  async action(workspaceId: string, contentItemId: string, raw: unknown): Promise<ContentReviewResponse> {
    const input = ReviewActionRequestSchema.parse(raw);
    const result = await this.repository.act(workspaceId, contentItemId, input.action);
    if (!result) throw new NotFoundException({ code: "CONTENT_NOT_FOUND", message: "Content was not found." });
    if (result === "POLICY_GATE") throw new ConflictException({ code: "POLICY_GATE", message: "A passing policy check is required." });
    if (result === "INVALID_TRANSITION") throw new BadRequestException({ code: "INVALID_REVIEW_TRANSITION", message: "Invalid content state transition." });
    return result;
  }
  async updateMetadata(workspaceId: string, contentItemId: string, raw: unknown): Promise<ContentReviewResponse> {
    const input: UpdateReviewMetadataRequest = UpdateReviewMetadataRequestSchema.parse(raw);
    const result = await this.repository.updateMetadata(workspaceId, contentItemId, input);
    if (!result) throw new NotFoundException({ code: "CONTENT_OUTPUT_NOT_FOUND", message: "Content output was not found." });
    return result;
  }
  async preview(workspaceId: string, contentItemId: string, rawPlatform: string | undefined): Promise<{ url: string; expiresInSeconds: number }> {
    const platform = rawPlatform ? PlatformSchema.parse(rawPlatform) : null;
    const key = await this.repository.getPreviewKey(workspaceId, contentItemId, platform);
    if (!key) throw new NotFoundException({ code: "RENDER_PREVIEW_NOT_FOUND", message: "Rendered preview was not found." });
    const expiresInSeconds = 900;
    return { url: await this.storage.presignedUrl(key, expiresInSeconds), expiresInSeconds };
  }
}
