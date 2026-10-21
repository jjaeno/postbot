-- v1 conflated YouTube average view percentage with completion and Instagram
-- reach with impressions. Preserve original rows, but never report them as facts.
UPDATE analytics_metric_snapshots s
JOIN platform_posts p ON p.id = s.platformPostId
SET s.mappingVersion = 'legacy-ambiguous-v1', s.status = 'UNAVAILABLE',
    s.unavailableReason = 'LEGACY_MAPPING_REQUIRES_RESYNC', s.value = NULL
WHERE s.mappingVersion = 'v1'
  AND ((p.platform = 'YOUTUBE' AND s.metric = 'completion_rate')
    OR (p.platform = 'INSTAGRAM' AND s.metric = 'impressions'));
