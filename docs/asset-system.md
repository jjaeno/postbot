# Asset, Image, and TTS system

`ASSET` jobs generate an image through the configured Image Provider, store its bytes through the configured Storage Provider, and persist Asset, AssetSource, AssetLicense, and optional AssetUsage records. A failed image generation uses only an internally stored IMAGE asset with a verified license that allows commercial and derivative use; if none exists the job fails.

Non-fixture generated images are stored with a pending license snapshot. Their job transitions to `NEEDS_REVIEW` and their ContentItem is `REVIEW_REQUIRED`; only an explicit verified license can later make such an asset eligible as a fallback.

`TTS` jobs synthesize audio, persist word timing in the AssetUsage snapshot, and write ProviderUsage and CostLedger under `tts:<idempotencyKey>`. Repeated execution with the same idempotency key does not create another usage or cost row.

Licensed BGM/SFX selection uses the same AUDIO fallback query and only exposes assets whose stored license snapshot is verified for commercial and derivative use.

`FakeStorageProvider`, `FakeImageProvider`, and `FakeTtsProvider` are deterministic test implementations. `S3StorageProvider` supports MinIO/S3 object upload, download, deletion, and presigned URLs. `GoogleImageProvider` and `ElevenLabsTtsProvider` are selected by environment configuration.

## Real-provider verification

Real image verification requires `IMAGE_PROVIDER=google` and `GOOGLE_API_KEY`. Real TTS verification requires `TTS_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, and a valid `ELEVENLABS_VOICE_ID`. These values must never be committed. This environment has no real provider keys, so only Fake Provider, MySQL, Redis, and MinIO integration paths are verified.
