import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@postbot/database";
import { AuditLogResponseSchema, CostReportQuerySchema, CostReportResponseSchema, NotificationResponseSchema, type AuditLogResponse, type CostReportResponse, type NotificationResponse } from "@postbot/contracts";
import { OAuthCryptoService } from "../oauth/oauth-crypto.service.js";

const number = (value: Prisma.Decimal | null | undefined): number => Number(value?.toString() ?? "0");

@Injectable()
export class OperationsService {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient, private readonly crypto: OAuthCryptoService) {}

  async costReport(workspaceId: string, raw: unknown): Promise<CostReportResponse> {
    const input = CostReportQuerySchema.parse(raw);
    const usage = await this.prisma.providerUsage.findMany({ where: { occurredAt: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) }, ...(input.provider ? { provider: input.provider } : {}), ...(input.channelId ? { contentItem: { channelId: input.channelId, channel: { workspaceId } } } : { contentItem: { channel: { workspaceId } } }) }, select: { provider: true, estimatedCost: true, actualCost: true } });
    const ledger = await this.prisma.costLedger.findMany({ where: { occurredAt: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) }, ...(input.channelId ? { contentItem: { channelId: input.channelId, channel: { workspaceId } } } : { contentItem: { channel: { workspaceId } } }) }, select: { direction: true, amount: true, providerUsage: { select: { provider: true } } } });
    const totals = { estimated: new Prisma.Decimal(0), actual: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
    const providerTotals = new Map<string, { estimated: Prisma.Decimal; actual: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const entry of ledger) {
      const bucket = entry.direction === "ESTIMATED" ? "estimated" : entry.direction === "ACTUAL" ? "actual" : "credit";
      totals[bucket] = totals[bucket].plus(entry.amount);
      const provider = entry.providerUsage?.provider ?? "other";
      const current = providerTotals.get(provider) ?? { estimated: new Prisma.Decimal(0), actual: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      current[bucket] = current[bucket].plus(entry.amount);
      providerTotals.set(provider, current);
    }
    const usageActual = usage.reduce((total, item) => total.plus(item.actualCost ?? 0), new Prisma.Decimal(0));
    const discrepancy = usageActual.minus(totals.actual);
    return CostReportResponseSchema.parse({ currency: "USD", periodStart: input.periodStart, periodEnd: input.periodEnd, estimated: number(totals.estimated), actual: number(totals.actual), credit: number(totals.credit), reconciled: discrepancy.isZero(), discrepancy: number(discrepancy), byProvider: [...providerTotals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([provider, values]) => ({ provider, estimated: number(values.estimated), actual: number(values.actual), credit: number(values.credit) })) });
  }

  async listNotifications(workspaceId: string): Promise<NotificationResponse[]> {
    const notifications = await this.prisma.notification.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 100 });
    return notifications.map((notification) => NotificationResponseSchema.parse({ ...notification, acknowledgedAt: notification.acknowledgedAt?.toISOString() ?? null, createdAt: notification.createdAt.toISOString() }));
  }

  async acknowledge(workspaceId: string, userId: string, notificationId: string): Promise<NotificationResponse> {
    const notification = await this.prisma.notification.findFirst({ where: { id: notificationId, workspaceId } });
    if (!notification) throw new NotFoundException("NOTIFICATION_NOT_FOUND");
    const updated = await this.prisma.notification.update({ where: { id: notification.id }, data: { acknowledgedAt: notification.acknowledgedAt ?? new Date(), acknowledgedByUserId: notification.acknowledgedByUserId ?? userId } });
    await this.audit(workspaceId, userId, "notification.acknowledge", "notification", updated.id, { eventKey: updated.eventKey });
    return NotificationResponseSchema.parse({ ...updated, acknowledgedAt: updated.acknowledgedAt?.toISOString() ?? null, createdAt: updated.createdAt.toISOString() });
  }

  async listAudit(workspaceId: string): Promise<AuditLogResponse[]> {
    const logs = await this.prisma.auditLog.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 200 });
    return logs.map((log) => AuditLogResponseSchema.parse({ ...log, targetId: log.targetId ?? null, metadata: log.metadata ?? null, createdAt: log.createdAt.toISOString() }));
  }

  async notify(workspaceId: string, input: { eventKey: string; severity: "INFO" | "WARNING" | "CRITICAL"; payload: Prisma.InputJsonValue; channelId?: string; cooldownMinutes?: number }): Promise<void> {
    const bucket = Math.floor(Date.now() / ((input.cooldownMinutes ?? 30) * 60_000));
    const notificationKey = `${workspaceId}:${input.eventKey}:${input.channelId ?? "workspace"}:${bucket}`;
    await this.prisma.notification.upsert({ where: { notificationKey }, create: { workspaceId, channelId: input.channelId, notificationKey, eventKey: input.eventKey, severity: input.severity, payload: input.payload }, update: {} });
  }

  async audit(workspaceId: string, userId: string | null, action: string, targetType: string, targetId: string | null, metadata?: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action, targetType, targetId, metadata } });
  }

  async rotateOAuthKeys(workspaceId: string, userId: string, role: string): Promise<{ rotated: number }> {
    if (role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED");
    const credentials = await this.prisma.oAuthCredential.findMany({ where: { platformAccount: { workspaceId } } });
    let rotated = 0;
    for (const credential of credentials) {
      if (credential.tokenKeyVersion === this.crypto.keyVersion) continue;
      const access = this.crypto.decrypt({ cipherText: credential.encryptedAccessToken, cipher: credential.tokenCipher as "aes-256-gcm", keyVersion: credential.tokenKeyVersion });
      const refresh = credential.encryptedRefreshToken ? this.crypto.decrypt({ cipherText: credential.encryptedRefreshToken, cipher: credential.tokenCipher as "aes-256-gcm", keyVersion: credential.tokenKeyVersion }) : null;
      const encryptedAccess = this.crypto.encrypt(access); const encryptedRefresh = refresh ? this.crypto.encrypt(refresh) : null;
      await this.prisma.oAuthCredential.update({ where: { id: credential.id }, data: { encryptedAccessToken: encryptedAccess.cipherText, encryptedRefreshToken: encryptedRefresh?.cipherText ?? null, tokenCipher: encryptedAccess.cipher, tokenKeyVersion: encryptedAccess.keyVersion } });
      rotated += 1;
    }
    await this.audit(workspaceId, userId, "oauth.key_rotation", "oauth_credential", null, { rotated });
    return { rotated };
  }
}
