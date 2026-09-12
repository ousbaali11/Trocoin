import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from './settings.service';

/** Endpoints publics / utilisateur autour de la monétisation. */
@Controller()
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get('settings/public')
  publicSettings() {
    return this.settings.publicSettings();
  }

  @Get('plans')
  plans() {
    return this.settings.listPlans();
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/me/entitlements')
  async entitlements(@Req() req: any) {
    const e = await this.settings.entitlements(req.user.userId, req.user.accountType);
    const sub = await this.settings.activeSubscription(req.user.userId);
    return { ...e, subscription: sub ? { id: sub.id, status: sub.status, startedAt: sub.startedAt, endsAt: sub.endsAt, provider: sub.provider } : null };
  }

  @UseGuards(JwtAuthGuard)
  @Post('users/me/subscription/:planId')
  subscribe(@Req() req: any, @Param('planId', ParseUUIDPipe) planId: string) {
    return this.settings.subscribe(req.user.userId, planId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('users/me/subscription')
  cancel(@Req() req: any) {
    return this.settings.cancel(req.user.userId);
  }
}
