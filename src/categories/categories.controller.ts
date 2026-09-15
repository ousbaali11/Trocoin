import { Controller, Get, Param, Query } from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  /** Liste plate (compatibilité) */
  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  /** Arborescence familles → catégories */
  @Get('tree')
  findTree() {
    return this.categoriesService.findTree();
  }

  /** Catégories suggérées d'après les mots du titre saisi au dépôt (3 au plus). */
  @Get('suggest')
  suggest(@Query('q') q?: string) {
    return this.categoriesService.suggestFor((q || '').slice(0, 150));
  }

  /** Champs dynamiques d'une catégorie (formulaire de dépôt + filtres) */
  @Get(':slug/schema')
  schema(@Param('slug') slug: string) {
    return this.categoriesService.schemaFor(slug);
  }
}
