import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateReportDto } from './dto/create-report.dto';
import { REPORT_REASONS } from './report.entity';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /** Motifs proposés (libellés gérés côté front). */
  @Get('reasons')
  reasons() {
    return REPORT_REASONS;
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  create(@Req() req: any, @Body() dto: CreateReportDto) {
    return this.reportsService.create(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(@Req() req: any) {
    return this.reportsService.listMine(req.user.userId);
  }
}
