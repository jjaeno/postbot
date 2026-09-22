import { Module } from "@nestjs/common";
import { OptimizationController } from "./optimization.controller.js";
import { OptimizationService } from "./optimization.service.js";
@Module({ controllers: [OptimizationController], providers: [OptimizationService] })
export class OptimizationModule {}
