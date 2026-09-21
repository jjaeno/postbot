import { Module } from "@nestjs/common";
import { ReviewController } from "./review.controller.js";
import { REVIEW_REPOSITORY } from "./review.repository.js";
import { PrismaReviewRepository } from "./prisma-review.repository.js";
import { ReviewService } from "./review.service.js";
@Module({ controllers: [ReviewController], providers: [ReviewService, { provide: REVIEW_REPOSITORY, useClass: PrismaReviewRepository }] })
export class ReviewModule {}
