CREATE TABLE `analytics_syncs` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dataDelayHours` INTEGER NULL,
    `errorCode` VARCHAR(80) NULL,
    `errorMessage` TEXT NULL,
    UNIQUE INDEX `analytics_syncs_idempotencyKey_key`(`idempotencyKey`),
    INDEX `analytics_syncs_channelId_platform_periodStart_idx`(`channelId`, `platform`, `periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `analytics_metric_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `analyticsSyncId` VARCHAR(191) NOT NULL,
    `platformPostId` VARCHAR(191) NOT NULL,
    `metric` VARCHAR(80) NOT NULL,
    `mappingVersion` VARCHAR(40) NOT NULL,
    `status` ENUM('AVAILABLE', 'UNAVAILABLE', 'PARTIAL') NOT NULL,
    `value` DECIMAL(20, 6) NULL,
    `unit` VARCHAR(40) NULL,
    `aggregation` VARCHAR(40) NULL,
    `unavailableReason` TEXT NULL,
    `rawSnapshot` JSON NOT NULL,
    `observedAt` DATETIME(3) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `analytics_metric_snapshots_analyticsSyncId_metric_idx`(`analyticsSyncId`, `metric`),
    UNIQUE INDEX `analytics_metric_snapshots_platformPostId_metric_observedAt__key`(`platformPostId`, `metric`, `observedAt`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `analytics_syncs` ADD CONSTRAINT `analytics_syncs_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `analytics_metric_snapshots` ADD CONSTRAINT `analytics_metric_snapshots_analyticsSyncId_fkey` FOREIGN KEY (`analyticsSyncId`) REFERENCES `analytics_syncs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `analytics_metric_snapshots` ADD CONSTRAINT `analytics_metric_snapshots_platformPostId_fkey` FOREIGN KEY (`platformPostId`) REFERENCES `platform_posts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
