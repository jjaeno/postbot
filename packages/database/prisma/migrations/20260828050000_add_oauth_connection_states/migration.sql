CREATE TABLE `oauth_connection_states` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NULL,
  `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NOT NULL,
  `stateHash` VARCHAR(128) NOT NULL,
  `encryptedCodeVerifier` TEXT NOT NULL,
  `tokenCipher` VARCHAR(64) NOT NULL,
  `tokenKeyVersion` INTEGER NOT NULL,
  `scopes` JSON NOT NULL,
  `redirectUri` VARCHAR(512) NOT NULL,
  `provider` VARCHAR(40) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `oauth_connection_states_stateHash_key`(`stateHash`),
  INDEX `oauth_connection_states_workspaceId_platform_expiresAt_idx`(`workspaceId`, `platform`, `expiresAt`),
  INDEX `oauth_connection_states_channelId_idx`(`channelId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `oauth_connection_states`
  ADD CONSTRAINT `oauth_connection_states_workspaceId_fkey`
  FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `oauth_connection_states`
  ADD CONSTRAINT `oauth_connection_states_channelId_fkey`
  FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
