-- CreateTable
CREATE TABLE `collection_rules` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `keywords` JSON NOT NULL,
    `excludedKeywords` JSON NULL,
    `allowedSources` JSON NULL,
    `excludedSources` JSON NULL,
    `recencyHours` INTEGER NOT NULL,
    `collectionFrequencyMinutes` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `collection_rules_channelId_isActive_idx`(`channelId`, `isActive`),
    UNIQUE INDEX `collection_rules_channelId_version_key`(`channelId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `collection_rules` ADD CONSTRAINT `collection_rules_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
