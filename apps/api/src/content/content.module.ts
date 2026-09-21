import { Module } from "@nestjs/common";
import { ContentController } from "./content.controller.js";
import { CONTENT_REPOSITORY } from "./content.repository.js";
import { PrismaContentRepository } from "./prisma-content.repository.js";
import { ContentService } from "./content.service.js";
@Module({ controllers: [ContentController], providers: [ContentService, { provide: CONTENT_REPOSITORY, useClass: PrismaContentRepository }] }) export class ContentModule {}
