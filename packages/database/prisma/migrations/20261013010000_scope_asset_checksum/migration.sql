-- Keep actual content hashes and all existing asset/usage/license references.
-- New assets deduplicate within a channel or the deliberate shared library.
ALTER TABLE `assets` ADD COLUMN `dedupScope` VARCHAR(191) NOT NULL DEFAULT 'global';
UPDATE `assets` SET `dedupScope` = COALESCE(`channelId`, 'global');
DROP INDEX `assets_checksumSha256_key` ON `assets`;
CREATE UNIQUE INDEX `assets_dedupScope_checksumSha256_key` ON `assets`(`dedupScope`, `checksumSha256`);
