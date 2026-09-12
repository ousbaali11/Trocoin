import { Controller, Get, Param } from '@nestjs/common';
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

  /** Champs dynamiques d'une catégorie (formulaire de dépôt + filtres) */
  @Get(':slug/schema')
  schema(@Param('slug') slug: string) {
    return this.categoriesService.schemaFor(slug);
  }
}
