# Asset, Image, and TTS system

## Scene asset and cost behavior

ASSET automation reads the selected platform `SceneDocument` and creates one image for every scene `visualPrompt`. Each usage is attached to the exact `sceneVersionId` with purpose `scene-image:<platform>:<sceneId>`; renderer lookup therefore cannot reuse another platform or older version accidentally.

The logical purpose is stored in `usageSnapshot.originalPurpose`. Scene-scoped DB purpose keys use an 80-character prefix plus a 128-bit digest of logical purpose and SceneVersion, within the existing VARCHAR(120) unique key. Identical fallback/image/audio bytes can therefore retain separate historical scene usages while retries remain idempotent. Renderer accepts legacy unsuffixed purposes but selects only the exact SceneVersion. No schema change or migration is introduced.

Fallback lookup is channel-scoped and checks the latest license, commercial/derivative permission and validity dates; a historical approval cannot override a later rejection. Review/policy evidence also selects the current platform SceneVersion instead of combining older regeneration assets.

Real image and TTS rights remain unknown, not implicitly commercial-use approved. The review screen records a human-reviewed HTTPS proof URL, license name, commercial/derivative confirmations and VERIFIED/REJECTED status. This records evidence, not automated legal verification. Changes invalidate policy/approval and hold scheduled plans until recheck/reapproval.

Image and TTS Provider results record `ProviderUsage` and estimated `CostLedger` entries with the production job correlation. Configured real-provider rates are used for the estimate. A provider response is not mislabeled as an actual settled charge when the provider does not return billing settlement data.

`ASSET` jobs generate an image through the configured Image Provider, store its bytes through the configured Storage Provider, and persist Asset, AssetSource, AssetLicense, and optional AssetUsage records. A failed image generation uses only an internally stored IMAGE asset with a verified license that allows commercial and derivative use; if none exists the job fails.

Non-fixture generated images are stored with a pending license snapshot. Their job transitions to `NEEDS_REVIEW` and their ContentItem is `REVIEW_REQUIRED`; only an explicit verified license can later make such an asset eligible as a fallback.

`TTS` jobs synthesize audio, persist word timing in the AssetUsage snapshot, and write ProviderUsage and CostLedger under `tts:<idempotencyKey>`. Repeated execution with the same idempotency key does not create another usage or cost row.

Licensed BGM/SFX selection uses the same AUDIO fallback query and only exposes assets whose stored license snapshot is verified for commercial and derivative use.

`FakeStorageProvider`, `FakeImageProvider`, and `FakeTtsProvider` are deterministic test implementations. `S3StorageProvider` supports MinIO/S3 object upload, download, deletion, and presigned URLs. `GoogleImageProvider` and `ElevenLabsTtsProvider` are selected by environment configuration.

## Real-provider verification

Real image verification requires `IMAGE_PROVIDER=google` and `GOOGLE_API_KEY`. Real TTS verification requires `TTS_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, and a valid `ELEVENLABS_VOICE_ID`. These values must never be committed. This environment has no real provider keys, so only Fake Provider, MySQL, Redis, and MinIO integration paths are verified.
