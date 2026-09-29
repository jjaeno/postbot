ALTER TABLE `automation_steps`
  ADD COLUMN `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NULL,
  ADD COLUMN `branchKey` VARCHAR(16) NOT NULL DEFAULT 'COMMON';

DROP INDEX `automation_steps_automationRunId_stage_key` ON `automation_steps`;

CREATE UNIQUE INDEX `automation_steps_automationRunId_stage_branchKey_key`
  ON `automation_steps`(`automationRunId`, `stage`, `branchKey`);

CREATE INDEX `automation_steps_automationRunId_platform_status_idx`
  ON `automation_steps`(`automationRunId`, `platform`, `status`);
