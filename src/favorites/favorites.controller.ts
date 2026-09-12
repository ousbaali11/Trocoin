import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FavoritesService } from './favorites.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class FavoritesController {
  constructor(private favoritesService: FavoritesService) {}

  @Post('listings/:id/favorite')
  add(@Req() req: any, @Param('id', ParseUUIDPipe) listingId: string) {
    return this.favoritesService.add(req.user.userId, listingId);
  }

  @Delete('listings/:id/favorite')
  remove(@Req() req: any, @Param('id', ParseUUIDPipe) listingId: string) {
    return this.favoritesService.remove(req.user.userId, listingId);
  }

  @Get('users/me/favorites')
  listMine(@Req() req: any) {
    return this.favoritesService.listMine(req.user.userId);
  }

  @Get('users/me/favorites/ids')
  listMineIds(@Req() req: any) {
    return this.favoritesService.listMineIds(req.user.userId);
  }
}
