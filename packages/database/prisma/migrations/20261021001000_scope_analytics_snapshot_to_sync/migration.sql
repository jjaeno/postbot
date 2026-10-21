-- Different query periods may have the same observedAt. Keep both reports while
-- preserving idempotency within a single sync, including partial-failure recovery.
ALTER TABLE analytics_metric_snapshots
  ADD INDEX analytics_snapshot_post_idx (platformPostId),
  DROP INDEX analytics_metric_snapshots_platformPostId_metric_observedAt__key,
  ADD UNIQUE INDEX analytics_snapshot_sync_post_metric_observed_revision_key
    (analyticsSyncId, platformPostId, metric, observedAt, revision);
