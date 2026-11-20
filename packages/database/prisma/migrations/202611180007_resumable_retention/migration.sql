ALTER TABLE `scene_versions` ADD COLUMN `retentionState` VARCHAR(24) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE `assets` ADD COLUMN `retentionState` VARCHAR(24) NOT NULL DEFAULT 'ACTIVE';
CREATE INDEX `scene_versions_retentionState_createdAt_id_idx` ON `scene_versions` (`retentionState`,`createdAt`,`id`);
CREATE INDEX `assets_retentionState_createdAt_id_idx` ON `assets` (`retentionState`,`createdAt`,`id`);
CREATE TABLE `storage_deletions` (
 `id` VARCHAR(191) NOT NULL, `workspaceId` VARCHAR(191) NOT NULL, `channelId` VARCHAR(191) NOT NULL,
 `resourceId` VARCHAR(191) NOT NULL, `kind` VARCHAR(24) NOT NULL, `state` VARCHAR(24) NOT NULL DEFAULT 'MARKED',
 `objectKeys` JSON NOT NULL, `snapshot` JSON NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 PRIMARY KEY (`id`), UNIQUE INDEX `storage_deletions_kind_resourceId_key` (`kind`,`resourceId`), INDEX `storage_deletions_workspaceId_state_id_idx` (`workspaceId`,`state`,`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
