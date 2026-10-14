import { Injectable } from "@nestjs/common";
import { loadConfig } from "@postbot/config";
import {
  FakeYouTubePublisherProvider,
  FakeInstagramPublisherProvider, FakeTikTokPublisherProvider,
  GoogleYouTubePublisherProvider,
  MetaInstagramPublisherProvider,
  TikTokPublisherProvider,
  type PublisherProvider
} from "@postbot/publishers";

@Injectable()
export class PublisherProviderFactory {
  private readonly config = loadConfig();

  youtube(): PublisherProvider {
    if (this.config.YOUTUBE_OAUTH_PROVIDER === "google") {
      if (!this.config.YOUTUBE_CLIENT_ID || !this.config.YOUTUBE_CLIENT_SECRET) {
        throw new Error("YouTube OAuth credentials are not configured.");
      }
      return new GoogleYouTubePublisherProvider(this.config.YOUTUBE_CLIENT_ID, this.config.YOUTUBE_CLIENT_SECRET, { timeoutMs: this.config.PROVIDER_HTTP_TIMEOUT_MS });
    }
    return new FakeYouTubePublisherProvider();
  }
  instagram(): PublisherProvider {
    if (this.config.INSTAGRAM_OAUTH_PROVIDER === "meta") {
      if (!this.config.INSTAGRAM_CLIENT_ID || !this.config.INSTAGRAM_CLIENT_SECRET) throw new Error("Instagram OAuth credentials are not configured.");
      return new MetaInstagramPublisherProvider({ clientId: this.config.INSTAGRAM_CLIENT_ID, clientSecret: this.config.INSTAGRAM_CLIENT_SECRET, graphVersion: this.config.INSTAGRAM_GRAPH_VERSION, timeoutMs: this.config.PROVIDER_HTTP_TIMEOUT_MS, pollIntervalMs: this.config.SOCIAL_PUBLISH_POLL_INTERVAL_MS });
    }
    return new FakeInstagramPublisherProvider();
  }
  tiktok(): PublisherProvider {
    if (this.config.TIKTOK_OAUTH_PROVIDER === "tiktok") {
      if (!this.config.TIKTOK_CLIENT_KEY || !this.config.TIKTOK_CLIENT_SECRET) throw new Error("TikTok OAuth credentials are not configured.");
      return new TikTokPublisherProvider({ clientId: this.config.TIKTOK_CLIENT_KEY, clientSecret: this.config.TIKTOK_CLIENT_SECRET, timeoutMs: this.config.PROVIDER_HTTP_TIMEOUT_MS, pollIntervalMs: this.config.SOCIAL_PUBLISH_POLL_INTERVAL_MS });
    }
    return new FakeTikTokPublisherProvider();
  }
}
