import { Injectable } from "@nestjs/common";
import { loadConfig } from "@postbot/config";
import {
  FakeYouTubePublisherProvider,
  GoogleYouTubePublisherProvider,
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
      return new GoogleYouTubePublisherProvider(this.config.YOUTUBE_CLIENT_ID, this.config.YOUTUBE_CLIENT_SECRET);
    }
    return new FakeYouTubePublisherProvider();
  }
}
