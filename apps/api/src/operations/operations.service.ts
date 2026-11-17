import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@postbot/database";
import { AuditLogResponseSchema, CostReportQuerySchema, CostReportResponseSchema, CreateDataLifecycleRequestSchema, DataLifecycleRequestResponseSchema, NotificationResponseSchema, type AuditLogResponse, type CostReportResponse, type DataLifecycleRequestResponse, type NotificationResponse } from "@postbot/contracts";
import type { MaintenanceQueueAdapter } from "@postbot/jobs";
import { OAuthCryptoService } from "../oauth/oauth-crypto.service.js";
import { ReconcileUsageBillingSchema } from "@postbot/contracts";
import { settleJobReservation } from "@postbot/database";
import { reconcileProviderOutcome } from "./provider-reconciliation.js";

const number = (value: Prisma.Decimal | null | undefined): number => Number(value?.toString() ?? "0");
export const MAINTENANCE_QUEUE = Symbol("MAINTENANCE_QUEUE");

const lifecycleResponse = (request: {
  id: string; workspaceId: string | null; requestedByUserId: string | null; type: string; status: string;
  retentionBefore: Date | null; result: Prisma.JsonValue | null; errorCode: string | null; errorMessage: string | null;
  startedAt: Date | null; finishedAt: Date | null; createdAt: Date; updatedAt: Date;
}, duplicate?: boolean): DataLifecycleRequestResponse => DataLifecycleRequestResponseSchema.parse({
  ...request,
  retentionBefore: request.retentionBefore?.toISOString() ?? null,
  startedAt: request.startedAt?.toISOString() ?? null,
  finishedAt: request.finishedAt?.toISOString() ?? null,
  createdAt: request.createdAt.toISOString(),
  updatedAt: request.updatedAt.toISOString(),
  result: request.result ?? null,
  duplicate
});

@Injectable()
export class OperationsService implements OnModuleDestroy {
  constructor(
    @Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient,
    private readonly crypto: OAuthCryptoService,
    @Inject(MAINTENANCE_QUEUE) private readonly maintenanceQueue: MaintenanceQueueAdapter
  ) {}

  onModuleDestroy(): Promise<void> {
    return this.maintenanceQueue.close();
  }

  async costReport(workspaceId: string, raw: unknown): Promise<CostReportResponse> {
    const input = CostReportQuerySchema.parse(raw);
    const scope = { ...(input.contentItemId ? { id: input.contentItemId } : {}), ...(input.channelId ? { channelId: input.channelId } : {}), channel: { workspaceId } };
    const usage = await this.prisma.providerUsage.findMany({ where: { occurredAt: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) }, ...(input.provider ? { provider: input.provider } : {}), contentItem: scope }, select: { provider: true, estimatedCost: true, actualCost: true } });
    const ledger = await this.prisma.costLedger.findMany({ where: { occurredAt: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) }, contentItem: scope, ...(input.provider ? { providerUsage: { provider: input.provider } } : {}) }, select: { direction: true, amount: true, providerUsage: { select: { provider: true } } } });
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
    return CostReportResponseSchema.parse({ currency: "USD", periodStart: input.periodStart, periodEnd: input.periodEnd, estimated: number(totals.estimated), actual: number(totals.actual), credit: number(totals.credit), reconciled: discrepancy.isZero() && !usage.some((item) => item.actualCost === null && item.estimatedCost?.gt(0)), discrepancy: number(discrepancy), byProvider: [...providerTotals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([provider, values]) => ({ provider, estimated: number(values.estimated), actual: number(values.actual), credit: number(values.credit) })) });
  }

  async listNotifications(workspaceId: string): Promise<NotificationResponse[]> {
    const notifications = await this.prisma.notification.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 100 });
    return notifications.map((notification) => NotificationResponseSchema.parse({ ...notification, acknowledgedAt: notification.acknowledgedAt?.toISOString() ?? null, createdAt: notification.createdAt.toISOString() }));
  }

  async reconcileUsageBilling(workspaceId: string, userId: string, role: string, usageId: string, raw: unknown) {
    if (role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED");
    const input = ReconcileUsageBillingSchema.parse(raw);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      const usage = await tx.providerUsage.findFirst({ where: { id: usageId, OR: [{ contentItem: { channel: { workspaceId } } }, { productionJob: { channel: { workspaceId } } }] } });
      if (!usage) throw new NotFoundException("PROVIDER_USAGE_NOT_FOUND");
      const key = `billing:${workspaceId}:${input.idempotencyKey}`;
      const existing = await tx.billingReconciliation.findUnique({ where: { idempotencyKey: key } });
      const actualAmount = new Prisma.Decimal(input.actualAmount);
      if (existing) {
        if (existing.providerUsageId !== usageId || !existing.actualAmount.equals(actualAmount) || existing.evidenceHash !== input.evidenceHash || existing.externalReference !== input.externalReference) throw new ConflictException("BILLING_IDEMPOTENCY_CONFLICT");
        return { receipt: existing, jobId: usage.productionJobId };
      }
      if (usage.billingRevision !== input.expectedRevision) throw new ConflictException("BILLING_REVISION_CONFLICT");
      const revision = usage.billingRevision + 1;
      const receipt = await tx.billingReconciliation.create({ data: { providerUsageId: usageId, actorUserId: userId, idempotencyKey: key, previousAmount: usage.actualCost, actualAmount, evidenceHash: input.evidenceHash, externalReference: input.externalReference, revision } });
      const delta = actualAmount.minus(usage.actualCost ?? 0);
      await tx.providerUsage.update({ where: { id: usageId }, data: { actualCost: actualAmount, billingState: "INVOICE_CONFIRMED", billingRevision: revision } });
      await tx.costLedger.create({ data: { providerUsageId: usageId, contentItemId: usage.contentItemId, direction: "ACTUAL", category: "invoice-reconciliation", currency: usage.currency, amount: delta, occurredAt: usage.occurredAt, note: `billing-revision:${revision}` } });
      if (usage.productionJobId) {
        const step = await tx.automationStep.findUnique({ where: { productionJobId: usage.productionJobId } });
        if (step?.platform) {
          const key = `automation:${step.automationRunId}:${step.stage.toLowerCase()}:${step.platform.toLowerCase()}:cost`;
          await tx.$queryRaw`SELECT id FROM automation_cost_reservations WHERE idempotencyKey = ${key} FOR UPDATE`;
          const reservation = await tx.automationCostReservation.findUnique({ where: { idempotencyKey: key } });
          if (reservation) {
            const total = await tx.providerUsage.aggregate({ where: { productionJobId: usage.productionJobId }, _sum: { actualCost: true } });
            const accounted = total._sum.actualCost ?? new Prisma.Decimal(0);
            await tx.automationRun.update({ where: { id: step.automationRunId }, data: { budgetActual: { increment: accounted.minus(reservation.accountedActual) } } });
            await tx.automationCostReservation.update({ where: { id: reservation.id }, data: { accountedActual: accounted } });
          }
        }
      }
      await tx.auditLog.create({ data: { workspaceId, userId, action: "billing.reconciled", targetType: "providerUsage", targetId: usageId, metadata: { receiptId: receipt.id, revision, evidenceHash: input.evidenceHash, previousAmount: usage.actualCost?.toString() ?? null, actualAmount: actualAmount.toString() } } });
      return { receipt, jobId: usage.productionJobId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (result.jobId) await settleJobReservation(this.prisma, result.jobId);
    return { id: result.receipt.id, usageId, actualAmount: result.receipt.actualAmount.toFixed(6), revision: result.receipt.revision };
  }

  reconcileProviderOutcome(workspaceId: string, userId: string, role: string, jobId: string, raw: unknown) {
    return reconcileProviderOutcome(this.prisma, workspaceId, userId, role, jobId, raw);
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

  async createLifecycleRequest(workspaceId: string, userId: string, role: string, raw: unknown): Promise<DataLifecycleRequestResponse> {
    if (role !== "OWNER") throw new ForbiddenException("OWNER_ROLE_REQUIRED");
    const input = CreateDataLifecycleRequestSchema.parse(raw);
    const existing = await this.prisma.dataLifecycleRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const sameIntent = existing.workspaceId === workspaceId && existing.requestedByUserId === userId && existing.type === input.type &&
        (existing.retentionBefore?.toISOString() ?? null) === (input.retentionBefore ?? null);
      if (!sameIntent) throw new ConflictException("IDEMPOTENCY_CONFLICT");
      return lifecycleResponse(existing, true);
    }
    const request = await this.prisma.dataLifecycleRequest.create({
      data: {
        workspaceId,
        requestedByUserId: userId,
        type: input.type,
        retentionBefore: input.retentionBefore ? new Date(input.retentionBefore) : null,
        idempotencyKey: input.idempotencyKey
      }
    });
    await this.audit(workspaceId, userId, "data_lifecycle.request", "data_lifecycle_request", request.id, { type: request.type, retentionBefore: input.retentionBefore ?? null });
    try {
      await this.maintenanceQueue.enqueue({ requestId: request.id });
    } catch (error) {
      await this.prisma.dataLifecycleRequest.update({ where: { id: request.id }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "Maintenance queue unavailable.", finishedAt: new Date() } });
      throw error;
    }
    return lifecycleResponse(request, false);
  }

  async getLifecycleRequest(workspaceId: string, userId: string, requestId: string): Promise<DataLifecycleRequestResponse> {
    const request = await this.prisma.dataLifecycleRequest.findFirst({
      where: { id: requestId, OR: [{ workspaceId }, { requestedByUserId: userId }] }
    });
    if (!request) throw new NotFoundException("DATA_LIFECYCLE_REQUEST_NOT_FOUND");
    return lifecycleResponse(request);
  }
}
