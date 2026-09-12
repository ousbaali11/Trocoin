import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSavedSearchDto, UpdateSavedSearchDto } from './dto/saved-search.dto';
import { SavedSearchesService } from './saved-searches.service';

@UseGuards(JwtAuthGuard)
@Controller('users/me/saved-searches')
export class SavedSearchesController {
  constructor(private savedSearches: SavedSearchesService) {}

  @Get()
  list(@Req() req: any) {
    return this.savedSearches.listMine(req.user.userId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateSavedSearchDto) {
    return this.savedSearches.create(req.user.userId, dto);
  }

  @Get(':id/results')
  run(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.savedSearches.run(req.user.userId, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSavedSearchDto) {
    return this.savedSearches.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.savedSearches.remove(req.user.userId, id);
  }
}
