import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ReviewActionRequestSchema, RunPolicyCheckRequestSchema, type ContentReviewResponse } from "@postbot/contracts";
import { evaluatePolicy, type PolicyRule } from "@postbot/policy-engine";
import { REVIEW_REPOSITORY, type PolicyRuleRecord, type ReviewRepository } from "./review.repository.js";

const asStringList = (value: Record<string, unknown>, key: string): string[] => Array.isArray(value[key]) ? value[key].filter((entry): entry is string => typeof entry === "string") : [];
const asBoolean = (value: Record<string, unknown>, key: string): boolean => value[key] === true;
const asNumber = (value: Record<string, unknown>, key: string, fallback: number): number => typeof value[key] === "number" ? value[key] : fallback;

const toRule = (rule: PolicyRuleRecord): PolicyRule => ({
  platform: rule.platform.toLocaleLowerCase() as PolicyRule["platform"], region: rule.region, version: String(rule.version), effectiveAt: rule.effectiveAt.toISOString(), checkedAt: rule.checkedAt.toISOString(),
  maxDurationSeconds: asNumber(rule.durationRule, "maxDurationSeconds", 60), requiredDisclosure: asBoolean(rule.aiDisclosureRule, "required"),
  restrictedTerms: asStringList(rule.restrictedTopics, "terms"), requireVerifiedAssets: asBoolean(rule.rightsRule, "requireVerifiedAssets")
});

@Injectable()
export class ReviewService {
  constructor(@Inject(REVIEW_REPOSITORY) private readonly repository: ReviewRepository) {}
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
    const evaluation = evaluatePolicy(toRule(rule), {
      durationSeconds: review.durationSeconds, description: review.description, factsHaveSources: review.sources.length > 0,
      hasAiDisclosure: /(?:ai|인공지능)\s*(?:생성|generated|사용)/i.test(review.description),
      assetsVerified: review.assets.every((asset) => asset.licenseStatus === "VERIFIED"), duplicateRisk: false
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
}
