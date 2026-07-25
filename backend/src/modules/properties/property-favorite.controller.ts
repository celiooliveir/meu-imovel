import { Controller, Post, Delete, Param, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { PropertyFavoriteService } from './property-favorite.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';

@Controller('properties/:propertyId/favorite')
export class PropertyFavoriteController {
  constructor(private readonly favoriteService: PropertyFavoriteService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async add(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.favoriteService.add(propertyId, user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async remove(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.favoriteService.remove(propertyId, user.id);
  }
}
