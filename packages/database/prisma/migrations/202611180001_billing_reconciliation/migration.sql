ALTER TABLE `automation_cost_reservations` ADD COLUMN `settlementBasis` VARCHAR(40) NULL;
ALTER TABLE `provider_usages`
  ADD COLUMN `billingState` VARCHAR(40) NOT NULL DEFAULT 'KNOWN_ESTIMATE',
  ADD COLUMN `billingRevision` INTEGER NOT NULL DEFAULT 0;
UPDATE `provider_usages` SET `billingState` = 'INVOICE_CONFIRMED' WHERE `actualCost` IS NOT NULL;
CREATE TABLE `billing_reconciliations` (
  `id` VARCHAR(191) NOT NULL,
  `providerUsageId` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `previousAmount` DECIMAL(18,6) NULL,
  `actualAmount` DECIMAL(18,6) NOT NULL,
  `evidenceHash` CHAR(64) NOT NULL,
  `externalReference` VARCHAR(191) NOT NULL,
  `revision` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `billing_reconciliations_idempotencyKey_key` (`idempotencyKey`),
  UNIQUE INDEX `billing_reconciliations_providerUsageId_revision_key` (`providerUsageId`, `revision`),
  PRIMARY KEY (`id`),
  CONSTRAINT `billing_reconciliations_providerUsageId_fkey` FOREIGN KEY (`providerUsageId`) REFERENCES `provider_usages` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
