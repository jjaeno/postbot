ALTER TABLE `source_fetches` ADD COLUMN `completedAt` DATETIME(3) NULL;
CREATE INDEX `source_fetches_channelId_completedAt_idx` ON `source_fetches`(`channelId`, `completedAt`);
