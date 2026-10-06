import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { PrismaClient } from "@postbot/database";
import { AssetRepository, assetNeedsReview, checksumSha256 } from "@postbot/asset-library";
import { loadConfig } from "@postbot/config";
import { FakeStorageProvider, S3StorageProvider } from "@postbot/providers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";

const Input = z.object({ bodyBase64: z.string().min(1).max(1400000).regex(/^[A-Za-z0-9+/]+={0,2}$/), name: z.string().min(1).max(120), licenseName: z.string().min(3).max(120), proofUrl: z.string().url().refine((value) => new URL(value).protocol === "https:"), commercialUseAllowed: z.literal(true), derivativeAllowed: z.literal(true) }).strict();
export const validateWav = (bytes: Buffer): void => {
  if (bytes.length < 44 || bytes.length > 1048576 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new BadRequestException("PCM_WAV_REQUIRED");
  let format = false; let data = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4); const start = offset + 8;
    if (start + length > bytes.length) throw new BadRequestException("WAV_CHUNK_INVALID");
    const tag = bytes.toString("ascii", offset, offset + 4);
    if (tag === "fmt ") {
      if (length < 16 || bytes.readUInt16LE(start) !== 1 || ![1, 2].includes(bytes.readUInt16LE(start + 2)) || ![8, 16, 24, 32].includes(bytes.readUInt16LE(start + 14)) || bytes.readUInt32LE(start + 4) < 8000 || bytes.readUInt32LE(start + 4) > 96000) throw new BadRequestException("PCM_WAV_FORMAT_INVALID");
      format = true;
    }
    if (tag === "data" && length > 0) data = true;
    offset = start + length + length % 2;
  }
  if (!format || !data) throw new BadRequestException("WAV_DATA_REQUIRED");
};
@Controller("channels/:channelId/audio-assets")
@UseGuards(AccessTokenGuard)
export class AudioAssetsController {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}
  private async owned(workspaceId: string, channelId: string) { if (!await this.prisma.channel.findFirst({ where: { id: channelId, workspaceId } })) throw new NotFoundException("CHANNEL_NOT_FOUND"); }
  @Get()
  async list(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string) {
    await this.owned(req.auth.workspaceId, channelId);
    const assets = await this.prisma.asset.findMany({ where: { channelId, kind: "AUDIO", origin: "STOCK_FREE" }, include: { licenses: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
    const now = new Date();
    return { assets: assets.filter((asset) => { const license = asset.licenses[0]; return license?.status === "VERIFIED" && license.commercialUseAllowed && license.derivativeAllowed && (!license.validFrom || license.validFrom <= now) && (!license.validUntil || license.validUntil > now); }).map((asset) => ({ id: asset.id, name: asset.licenses[0]?.licenseName ?? "등록 오디오" })) };
  }
  @Post()
  async upload(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string, @Body() raw: unknown) {
    if (req.auth.workspace.role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED");
    await this.owned(req.auth.workspaceId, channelId);
    const input = Input.safeParse(raw); if (!input.success) throw new BadRequestException("AUDIO_LICENSE_REQUIRED");
    const bytes = Buffer.from(input.data.bodyBase64, "base64"); validateWav(bytes);
    const existing = await this.prisma.asset.findUnique({ where: { checksumSha256: checksumSha256(bytes) } });
    if (existing && (existing.channelId !== channelId || existing.kind !== "AUDIO" || existing.origin !== "STOCK_FREE")) throw new BadRequestException("AUDIO_OWNERSHIP_CONFLICT");
    const config = loadConfig();
    const storage = config.STORAGE_PROVIDER === "s3" ? new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }) : new FakeStorageProvider();
    const repository = new AssetRepository(this.prisma, storage);
    const saved = await repository.store({ channelId, kind: "AUDIO", origin: "STOCK_FREE", key: `audio-stock/${channelId}/${randomUUID()}`, body: bytes, mimeType: "audio/wav", source: { provider: "owner-upload", sourceUrl: input.data.proofUrl }, license: { status: "verified", commercialUseAllowed: true, derivativeAllowed: true, attributionRequired: false, attributionText: null, proofUrl: input.data.proofUrl } });
    const persisted = await this.prisma.asset.findUniqueOrThrow({ where: { id: saved.assetId } });
    if (persisted.channelId !== channelId || persisted.kind !== "AUDIO" || persisted.origin !== "STOCK_FREE") throw new BadRequestException("AUDIO_OWNERSHIP_CONFLICT");
    if (saved.duplicate && assetNeedsReview(await repository.getLicense(saved.assetId))) throw new BadRequestException("AUDIO_LICENSE_REVIEW_REQUIRED");
    if (!saved.duplicate) await this.prisma.assetLicense.create({ data: { assetId: saved.assetId, status: "VERIFIED", licenseName: `${input.data.name}: ${input.data.licenseName}`.slice(0, 120), proofUrl: input.data.proofUrl, commercialUseAllowed: true, derivativeAllowed: true, checkedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { workspaceId: req.auth.workspaceId, userId: req.auth.userId, action: "audio.asset.register", targetType: "asset", targetId: saved.assetId } });
    return { id: saved.assetId };
  }
}
