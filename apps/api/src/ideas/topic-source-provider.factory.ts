import { Injectable } from "@nestjs/common";
import { loadConfig } from "@postbot/config";
import { FixtureTopicSourceProvider, RssTopicSourceProvider, type TopicSourceProvider } from "@postbot/providers";

@Injectable()
export class TopicSourceProviderFactory {
  private readonly config = loadConfig();

  fixture(): TopicSourceProvider {
    return new FixtureTopicSourceProvider();
  }

  automatic(): TopicSourceProvider {
    if (this.config.TOPIC_SOURCE_PROVIDER === "rss") {
      const feedUrls = this.config.TOPIC_SOURCE_FEED_URLS.split(",").map((value) => value.trim()).filter(Boolean);
      if (feedUrls.length === 0) throw new Error("TOPIC_SOURCE_FEED_URLS is required when TOPIC_SOURCE_PROVIDER=rss.");
      return new RssTopicSourceProvider({ feedUrls, timeoutMs: this.config.TOPIC_SOURCE_TIMEOUT_MS, maxRetries: this.config.TOPIC_SOURCE_MAX_RETRIES });
    }
    return this.fixture();
  }
}
