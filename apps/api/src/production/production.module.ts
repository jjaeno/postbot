import { Module } from "@nestjs/common";
import { ProductionController } from "./production.controller.js";
import { ProductionService } from "./production.service.js";
import { ProductionRunsController } from "./production-runs.controller.js";
@Module({ controllers: [ProductionController, ProductionRunsController], providers: [ProductionService], exports: [ProductionService] })
export class ProductionModule {}
