import { Controller, Get, Module, Param } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LegalPage } from './legal-page.entity';
import { PagesService } from './pages.service';

@Controller('pages')
class PagesController {
  constructor(private pages: PagesService) {}

  @Get()
  async list() {
    return (await this.pages.list()).filter((p) => p.published).map(({ slug, title, updatedAt }) => ({ slug, title, updatedAt }));
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.pages.get(slug);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([LegalPage])],
  controllers: [PagesController],
  providers: [PagesService],
  exports: [PagesService],
})
export class PagesModule {}
