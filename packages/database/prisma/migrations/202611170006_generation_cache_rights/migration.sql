CREATE TABLE `asset_generation_caches` (
 `id` VARCHAR(191) NOT NULL, `channelId` VARCHAR(191) NOT NULL, `inputKey` VARCHAR(64) NOT NULL,
 `state` VARCHAR(24) NOT NULL, `ownerKey` VARCHAR(191) NOT NULL, `assetId` VARCHAR(191) NULL, `snapshot` JSON NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 UNIQUE INDEX `asset_generation_caches_channelId_inputKey_key` (`channelId`, `inputKey`), INDEX `asset_generation_caches_assetId_idx` (`assetId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `provider_rights_policies` (
 `id` VARCHAR(191) NOT NULL, `channelId` VARCHAR(191) NOT NULL, `version` INT NOT NULL,
 `provider` VARCHAR(80) NOT NULL, `model` VARCHAR(120) NOT NULL, `accountRef` VARCHAR(120) NOT NULL, `contractVersion` VARCHAR(120) NOT NULL,
 `proofUrl` TEXT NOT NULL, `evidence` JSON NOT NULL, `commercialUseAllowed` BOOLEAN NOT NULL, `derivativeAllowed` BOOLEAN NOT NULL,
 `attributionRequired` BOOLEAN NOT NULL DEFAULT false, `attributionText` TEXT NULL,
 `validFrom` DATETIME(3) NOT NULL, `validUntil` DATETIME(3) NOT NULL, `revokedAt` DATETIME(3) NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE INDEX `provider_rights_scope_version_key` (`channelId`, `provider`, `model`, `accountRef`, `contractVersion`, `version`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `asset_licenses` ADD COLUMN `rightsPolicyId` VARCHAR(191) NULL;
ALTER TABLE `asset_generation_caches` ADD CONSTRAINT `asset_generation_caches_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `asset_generation_caches` ADD CONSTRAINT `asset_generation_caches_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `provider_rights_policies` ADD CONSTRAINT `provider_rights_policies_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `asset_licenses` ADD CONSTRAINT `asset_licenses_rightsPolicyId_fkey` FOREIGN KEY (`rightsPolicyId`) REFERENCES `provider_rights_policies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
