import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@Req() req: any) {
    return this.notifications.listMine(req.user.userId);
  }

  @Get('unread-count')
  async unread(@Req() req: any) {
    return { unread: await this.notifications.unreadCount(req.user.userId) };
  }

  @Post('read-all')
  readAll(@Req() req: any) {
    return this.notifications.markAllRead(req.user.userId);
  }

  @Post(':id/read')
  read(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(req.user.userId, id);
  }
}
