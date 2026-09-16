-- CreateEnum
CREATE TABLE `content_ideas` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `status` ENUM('CANDIDATE', 'SHORTLISTED', 'REJECTED', 'USED', 'EXPIRED') NOT NULL DEFAULT 'CANDIDATE',
    `title` VARCHAR(255) NOT NULL,
    `summary` TEXT NULL,
    `canonicalUrl` TEXT NOT NULL,
    `urlHash` VARCHAR(128) NOT NULL,
    `contentHash` VARCHAR(128) NOT NULL,
    `sourceName` VARCHAR(191) NOT NULL,
    `sourceKind` ENUM('NEWS', 'OFFICIAL', 'PAPER', 'RSS', 'PUBLIC_DATA', 'MANUAL') NOT NULL,
    `provider` VARCHAR(80) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `collectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `suitabilityScore` DECIMAL(7, 6) NOT NULL,
    `freshnessScore` DECIMAL(7, 6) NOT NULL,
    `reliabilityScore` DECIMAL(7, 6) NOT NULL,
    `expectedValueScore` DECIMAL(7, 6) NOT NULL,
    `rejectionReason` TEXT NULL,
    `rawSnapshot` JSON NULL,
    `usedContentItemId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `content_ideas_usedContentItemId_key`(`usedContentItemId`),
    UNIQUE INDEX `content_ideas_channelId_urlHash_key`(`channelId`, `urlHash`),
    UNIQUE INDEX `content_ideas_channelId_contentHash_key`(`channelId`, `contentHash`),
    INDEX `content_ideas_channelId_status_collectedAt_idx`(`channelId`, `status`, `collectedAt`),
    INDEX `content_ideas_sourceKind_publishedAt_idx`(`sourceKind`, `publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `content_ideas` ADD CONSTRAINT `content_ideas_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_ideas` ADD CONSTRAINT `content_ideas_usedContentItemId_fkey` FOREIGN KEY (`usedContentItemId`) REFERENCES `content_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
