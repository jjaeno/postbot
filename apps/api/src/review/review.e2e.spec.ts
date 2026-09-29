import "reflect-metadata";
import type { CanActivate, ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ContentReviewResponseSchema, type ContentReviewResponse } from "@postbot/contracts";
import type { Server } from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { HttpExceptionResponseFilter } from "../http-exception.filter.js";
import { ReviewController } from "./review.controller.js";
import { REVIEW_REPOSITORY, type PolicyRuleRecord, type ReviewRepository } from "./review.repository.js";
import { ReviewService } from "./review.service.js";

const rule: PolicyRuleRecord = { id: "rule-1", platform: "YOUTUBE", region: "GLOBAL", version: 1, effectiveAt: new Date("2026-01-01"), checkedAt: new Date("2026-01-01"), durationRule: { maxDurationSeconds: 60 }, originalityRule: {}, aiDisclosureRule: {}, rightsRule: { requireVerifiedAssets: true }, restrictedTopics: { terms: [] } };
const content = (): ContentReviewResponse => ({ id: "content-1", channelId: "channel-1", status: "REVIEW_REQUIRED", title: "Review", description: "verified content", durationSeconds: 30, sources: [{ title: "Source", url: "https://example.com", sourceName: "Example" }], assets: [{ id: "asset-1", licenseStatus: "VERIFIED", purpose: "image" }], policy: null, ideaId: "idea-1", outputs: [] });
class Guard implements CanActivate { canActivate(context: ExecutionContext): boolean { context.switchToHttp().getRequest<{ auth: { workspaceId: string } }>().auth = { workspaceId: "workspace-1" }; return true; } }
class Repository implements ReviewRepository {
  current = content();
  get = (): Promise<ContentReviewResponse> => Promise.resolve(this.current);
  getRule = (): Promise<PolicyRuleRecord> => Promise.resolve(rule);
  getEvidence = () => Promise.resolve({ factsHaveSources: true, sourceCount: 1, minimumSourceReliability: 0.9, conflictingSources: false, assetsVerified: true, commercialUseVerified: true, duplicateRisk: false, originalityScore: 1, sensitiveTopic: false, forcedReview: false, platformRuleViolations: [] });
  updateMetadata = (): Promise<ContentReviewResponse> => Promise.resolve(this.current);
  getPreviewKey = (): Promise<string | null> => Promise.resolve(null);
  saveCheck = (_workspace: string, _item: string, _rule: PolicyRuleRecord, status: "pass" | "warning" | "review" | "block", findings: readonly { code: string; severity: "pass" | "warning" | "review" | "block"; message: string }[]): Promise<ContentReviewResponse> => { this.current = { ...this.current, policy: { status, findings: [...findings], snapshotId: "snapshot-1" } }; return Promise.resolve(this.current); };
  act = (_workspace: string, _item: string, action: "approve" | "hold" | "discard" | "schedule"): Promise<ContentReviewResponse | "POLICY_GATE" | "INVALID_TRANSITION"> => { if (action === "approve" && this.current.policy?.status !== "pass") return Promise.resolve("POLICY_GATE"); this.current = { ...this.current, status: action === "approve" ? "APPROVED" : action === "schedule" ? "SCHEDULED" : "HELD" }; return Promise.resolve(this.current); };
}
describe("review HTTP API", () => {
  let app: INestApplication;
  afterEach(async () => { await app?.close(); });
  it("checks policy and gates approval through authenticated routes", async () => {
    const module = await Test.createTestingModule({ controllers: [ReviewController], providers: [ReviewService, { provide: REVIEW_REPOSITORY, useClass: Repository }] }).overrideGuard(AccessTokenGuard).useClass(Guard).compile();
    app = module.createNestApplication(); app.useGlobalFilters(new HttpExceptionResponseFilter()); await app.init();
    const server = app.getHttpServer() as Server;
    await request(server).post("/content/content-1/review/action").send({ action: "approve" }).expect(409);
    await request(server).post("/content/content-1/review/policy-check").send({ platform: "YOUTUBE" }).expect(201).expect((response) => expect(ContentReviewResponseSchema.parse(response.body).policy?.status).toBe("pass"));
    await request(server).post("/content/content-1/review/action").send({ action: "approve" }).expect(201).expect((response) => expect(ContentReviewResponseSchema.parse(response.body).status).toBe("APPROVED"));
  });
});
