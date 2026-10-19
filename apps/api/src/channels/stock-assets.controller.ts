import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { PrismaClient } from "@postbot/database";
import { loadConfig } from "@postbot/config";
import { AssetRepository, checksumSha256, assetNeedsReview } from "@postbot/asset-library";
import { FakeStorageProvider, S3StorageProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";

const StockInput = z.object({
  bodyBase64: z.string().min(1).max(1_400_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  licenseName: z.string().min(1).max(120),
  proofUrl: z.string().url().refine((value) => new URL(value).protocol === "https:"),
  commercialUseAllowed: z.literal(true), derivativeAllowed: z.literal(true)
  , assetKind: z.enum(["stock", "logo"]).optional()
}).strict();

export const validateStockBytes = (body: Uint8Array, mimeType: string): void => {
  if (body.length > 1_048_576 || body.length < 16) throw new BadRequestException("STOCK_IMAGE_SIZE_INVALID");
  const png = Buffer.from(body.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = body[0] === 255 && body[1] === 216 && body[2] === 255 && body[body.length - 2] === 255 && body[body.length - 1] === 217;
  if (!(mimeType === "image/png" ? png : jpeg)) throw new BadRequestException("STOCK_IMAGE_FORMAT_INVALID");
};

@Controller("channels/:channelId/stock-assets")
@UseGuards(AccessTokenGuard)
export class StockAssetsController {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  private async repository(workspaceId: string, channelId: string): Promise<AssetRepository> {
    if (!await this.prisma.channel.findFirst({ where: { id: channelId, workspaceId } })) throw new NotFoundException("CHANNEL_NOT_FOUND");
    const config = loadConfig();
    const storage = config.STORAGE_PROVIDER === "s3" ? new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }) : new FakeStorageProvider();
    return new AssetRepository(this.prisma, storage);
  }

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string) {
    const repository = await this.repository(req.auth.workspaceId, channelId);
    return { assets: (await repository.selectLicensedStock(channelId)).map((asset) => ({ id: asset.assetId })) };
  }

  @Post()
  async upload(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string, @Body() raw: unknown) {
    if (req.auth.workspace.role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED");
    const parsed = StockInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException("STOCK_IMAGE_AND_LICENSE_REQUIRED");
    const input = parsed.data;
    const bytes = Buffer.from(input.bodyBase64, "base64");
    validateStockBytes(bytes, input.mimeType);
    const repository = await this.repository(req.auth.workspaceId, channelId);
    // Identical bytes have independent ownership and evidence in each channel.
    const existing = await this.prisma.asset.findUnique({ where: { dedupScope_checksumSha256: { dedupScope: channelId, checksumSha256: checksumSha256(bytes) } } });
    if (existing && existing.channelId !== channelId) throw new BadRequestException("STOCK_IMAGE_ALREADY_OWNED_BY_ANOTHER_CHANNEL");
    if (existing && (input.assetKind === "logo" ? existing.kind !== "GRAPHIC" : existing.kind !== "IMAGE" || existing.origin === "AI_GENERATED")) throw new BadRequestException("ASSET_KIND_CONFLICT");
    const result = await repository.store({ channelId, kind: input.assetKind === "logo" ? "GRAPHIC" : "IMAGE", origin: input.assetKind === "logo" ? "INTERNAL" : "STOCK_FREE", key: `stock/${channelId}/${randomUUID()}`, body: bytes, mimeType: input.mimeType, source: { provider: "owner-upload", sourceUrl: input.proofUrl }, license: { status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: input.proofUrl } });
    const stored = await this.prisma.asset.findUniqueOrThrow({ where: { id: result.assetId } });
    if (stored.channelId !== channelId || (input.assetKind === "logo" ? stored.kind !== "GRAPHIC" : stored.kind !== "IMAGE" || stored.origin === "AI_GENERATED")) throw new BadRequestException("ASSET_OWNERSHIP_OR_KIND_CONFLICT");
    if (result.duplicate && assetNeedsReview(await repository.getLicense(result.assetId))) throw new BadRequestException("ASSET_LICENSE_REVIEW_REQUIRED");
    // Re-upload cannot silently replace proof and bypass output invalidation.
    if (!result.duplicate) await this.prisma.assetLicense.create({ data: { assetId: result.assetId, status: "VERIFIED", licenseName: input.licenseName, commercialUseAllowed: true, derivativeAllowed: true, proofUrl: input.proofUrl, checkedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { workspaceId: req.auth.workspaceId, userId: req.auth.userId, action: "stock.asset.register", targetType: "asset", targetId: result.assetId } });
    // Held stock jobs retry through their existing scene/job idempotency keys.
    const held = await this.prisma.automationStep.findMany({ where: { stage: "ASSET", status: "HELD", errorCode: "STOCK_ASSET_REQUIRED", automationRun: { channelId, status: { in: ["PAUSED", "RUNNING"] } } } });
    for (const step of held) await this.prisma.$transaction([
      this.prisma.automationStep.update({ where: { id: step.id }, data: { status: "PENDING", errorCode: null, errorMessage: null, finishedAt: null } }),
      this.prisma.automationRun.update({ where: { id: step.automationRunId }, data: { status: "QUEUED", pausedReason: null, nextRunAt: new Date() } })
    ]);
    return { id: result.assetId };
  }
}
