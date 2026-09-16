import { Injectable } from "@nestjs/common";
import { FixtureTopicSourceProvider, type TopicSourceProvider } from "@postbot/providers";

@Injectable()
export class TopicSourceProviderFactory {
  fixture(): TopicSourceProvider {
    return new FixtureTopicSourceProvider();
  }
}
