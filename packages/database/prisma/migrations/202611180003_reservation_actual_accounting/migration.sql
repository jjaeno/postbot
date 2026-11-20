ALTER TABLE `automation_cost_reservations` ADD COLUMN `accountedActual` DECIMAL(18,6) NOT NULL DEFAULT 0;
UPDATE `automation_cost_reservations` AS r SET `accountedActual` = (
  SELECT COALESCE(SUM(u.`actualCost`), 0)
  FROM `automation_steps` AS s
  JOIN `provider_usages` AS u ON u.`productionJobId` = s.`productionJobId`
  WHERE s.`automationRunId` = r.`automationRunId` AND s.`stage` = r.`stage`
    AND LOWER(s.`platform`) = SUBSTRING_INDEX(SUBSTRING_INDEX(r.`idempotencyKey`, ':', -2), ':', 1)
) WHERE r.`settledAt` IS NOT NULL;
