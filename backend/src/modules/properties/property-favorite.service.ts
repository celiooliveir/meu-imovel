import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PropertyFavorite } from './property-favorite.entity';
import { Property } from './property.entity';
import { PropertyService } from './property.service';

@Injectable()
export class PropertyFavoriteService {
  constructor(
    @InjectRepository(PropertyFavorite)
    private readonly favoriteRepo: Repository<PropertyFavorite>,
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    private readonly propertyService: PropertyService,
  ) {}

  async add(propertyId: string, userId: string): Promise<void> {
    await this.propertyService.findByIdOrThrow(propertyId);

    const existing = await this.favoriteRepo.findOneBy({ propertyId, userId });
    if (existing) return;

    const favorite = this.favoriteRepo.create({ propertyId, userId });
    await this.favoriteRepo.save(favorite);
  }

  async remove(propertyId: string, userId: string): Promise<void> {
    await this.favoriteRepo.delete({ propertyId, userId });
  }

  async findFavorites(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ items: Property[]; total: number; page: number; limit: number }> {
    const [favorites, total] = await this.favoriteRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    if (favorites.length === 0) return { items: [], total, page, limit };

    const properties = await this.propertyRepo.find({
      where: { id: In(favorites.map((f) => f.propertyId)) },
      relations: ['photos'],
    });
    const propertyById = new Map(properties.map((p) => [p.id, p]));
    const items = favorites
      .map((f) => propertyById.get(f.propertyId))
      .filter((p): p is Property => p !== undefined);

    return { items, total, page, limit };
  }

  async findFavoriteIds(userId: string): Promise<string[]> {
    const favorites = await this.favoriteRepo.find({ where: { userId }, select: ['propertyId'] });
    return favorites.map((f) => f.propertyId);
  }
}
