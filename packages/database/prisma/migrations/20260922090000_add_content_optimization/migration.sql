-- Preserve proposal history while adding explicit pending and expired states.
ALTER TABLE `channels` ADD COLUMN `optimizationSettings` JSON NULL;

ALTER TABLE `optimization_suggestions` MODIFY `status` ENUM('PENDING', 'PROPOSED', 'APPROVED', 'REJECTED', 'HELD', 'APPLIED', 'EXPIRED') NOT NULL DEFAULT 'PROPOSED';
ALTER TABLE `experiments` MODIFY `status` ENUM('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'STOPPED', 'INCONCLUSIVE') NOT NULL DEFAULT 'DRAFT';

ALTER TABLE `optimization_suggestions`
    ADD COLUMN `suggestionKey` VARCHAR(128) NULL,
    ADD COLUMN `targetStrategy` JSON NULL,
    ADD COLUMN `risk` JSON NULL,
    ADD COLUMN `inputSnapshot` JSON NULL,
    ADD COLUMN `metricVersion` VARCHAR(80) NULL,
    ADD COLUMN `ruleVersion` VARCHAR(80) NULL,
    ADD COLUMN `rollbackStrategyVersionId` VARCHAR(191) NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `optimization_suggestions_suggestionKey_key` ON `optimization_suggestions`(`suggestionKey`);
CREATE INDEX `optimization_suggestions_channelId_expiresAt_idx` ON `optimization_suggestions`(`channelId`, `expiresAt`);

ALTER TABLE `experiments`
    ADD COLUMN `targetMetric` VARCHAR(80) NULL,
    ADD COLUMN `minSampleSize` INTEGER NOT NULL DEFAULT 20,
    ADD COLUMN `stopCriteria` JSON NULL,
    ADD COLUMN `result` JSON NULL,
    ADD COLUMN `stopReason` TEXT NULL;

CREATE TABLE `experiment_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `experimentId` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NOT NULL,
    `arm` VARCHAR(40) NOT NULL,
    `assignmentKey` VARCHAR(128) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `experiment_assignments_assignmentKey_key`(`assignmentKey`),
    UNIQUE INDEX `experiment_assignments_experimentId_contentItemId_key`(`experimentId`, `contentItemId`),
    INDEX `experiment_assignments_experimentId_arm_idx`(`experimentId`, `arm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `experiment_assignments` ADD CONSTRAINT `experiment_assignments_experimentId_fkey` FOREIGN KEY (`experimentId`) REFERENCES `experiments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `experiment_assignments` ADD CONSTRAINT `experiment_assignments_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
