-- Keep cancelled reservation history; active reservations are serialized under the channel lock.
CREATE INDEX `publish_plans_contentItemId_platform_status_idx` ON `publish_plans` (`contentItemId`, `platform`, `status`);
DROP INDEX `publish_plans_contentItemId_platform_key` ON `publish_plans`;
