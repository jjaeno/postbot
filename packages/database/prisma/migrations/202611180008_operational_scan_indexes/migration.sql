CREATE INDEX `production_jobs_status_heartbeatAt_id_idx` ON `production_jobs` (`status`,`heartbeatAt`,`id`);
CREATE INDEX `production_jobs_channelId_status_finishedAt_idx` ON `production_jobs` (`channelId`,`status`,`finishedAt`);
