import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { PrismaClient } from "@postbot/database";
import { z } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";
const PolicyInput = z.object({ provider: z.enum(["google", "elevenlabs"]), model: z.string().min(1).max(120), accountRef: z.string().min(1).max(120),
  contractVersion: z.string().min(1).max(120), proofUrl: z.string().url().startsWith("https://"),
  evidence: z.object({ documentSha256: z.string().regex(/^[a-f0-9]{64}$/i), termsVersion: z.string().min(1).max(120), note: z.string().min(10).max(2000) }).strict(),
  commercialUseAllowed: z.boolean(), derivativeAllowed: z.boolean(), attributionRequired: z.boolean(), attributionText: z.string().max(2000).nullable(),
  validFrom: z.string().datetime(), validUntil: z.string().datetime(), confirmRights: z.literal(true)
}).strict().refine((value) => Date.parse(value.validUntil) > Date.parse(value.validFrom) && (!value.attributionRequired || !!value.attributionText), { message: "RIGHTS_SCOPE_INVALID" });

@Controller("channels/:channelId/provider-rights")
@UseGuards(AccessTokenGuard)
export class ProviderRightsController {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}
  private async owned(req: AuthenticatedRequest, channelId: string, write = false) {
    if (write && req.auth.workspace.role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED");
    if (!await this.prisma.channel.findFirst({ where: { id: channelId, workspaceId: req.auth.workspaceId } })) throw new NotFoundException("CHANNEL_NOT_FOUND");
  }
  @Get() async list(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string) {
    await this.owned(req, channelId);
    return { policies: await this.prisma.providerRightsPolicy.findMany({ where: { channelId }, orderBy: { createdAt: "desc" }, take: 100 }) };
  }
  @Post() async create(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string, @Body() raw: unknown) {
    await this.owned(req, channelId, true);
    const parsed = PolicyInput.safeParse(raw); if (!parsed.success) throw new BadRequestException("RIGHTS_PROOF_AND_EXACT_SCOPE_REQUIRED");
    const { confirmRights, ...input } = parsed.data;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const latest = await tx.providerRightsPolicy.findFirst({ where: { channelId, provider: input.provider, model: input.model, accountRef: input.accountRef, contractVersion: input.contractVersion }, orderBy: { version: "desc" } });
      const result = await tx.providerRightsPolicy.create({ data: { ...input, channelId, version: (latest?.version ?? 0) + 1, validFrom: new Date(input.validFrom), validUntil: new Date(input.validUntil) } });
      await tx.auditLog.create({ data: { workspaceId: req.auth.workspaceId, userId: req.auth.userId, action: "provider_rights.confirm_scope", targetType: "provider_rights_policy", targetId: result.id, metadata: { confirmed: confirmRights } } });
      return result;
    });
  }
  @Post(":policyId/revoke") async revoke(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string, @Param("policyId") policyId: string) {
    await this.owned(req, channelId, true);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const policy = await tx.providerRightsPolicy.findFirst({ where: { id: policyId, channelId } });
      if (!policy) throw new NotFoundException("RIGHTS_POLICY_NOT_FOUND");
      if (policy.revokedAt) return { revoked: true, heldPlans: 0 };
      await tx.providerRightsPolicy.update({ where: { id: policy.id }, data: { revokedAt: new Date() } });
      const licenses = await tx.assetLicense.findMany({ where: { rightsPolicyId: policy.id }, distinct: ["assetId"] });
      const ids = licenses.map((license) => license.assetId);
      for (const license of licenses) await tx.assetLicense.create({ data: { assetId: license.assetId, rightsPolicyId: policy.id, status: "REJECTED", licenseName: "provider-policy-revoked", commercialUseAllowed: false, derivativeAllowed: false, proofUrl: policy.proofUrl, checkedAt: new Date() } });
      const held = await tx.publishPlan.updateMany({ where: { status: "SCHEDULED", sceneVersion: { assetUsages: { some: { assetId: { in: ids } } } } }, data: { status: "HELD" } });
      await tx.auditLog.create({ data: { workspaceId: req.auth.workspaceId, userId: req.auth.userId, action: "provider_rights.revoke", targetType: "provider_rights_policy", targetId: policy.id, metadata: { heldPlans: held.count } } });
      return { revoked: true, heldPlans: held.count };
    });
  }
}
