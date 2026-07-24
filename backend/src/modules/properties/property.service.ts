import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Property } from './property.entity';
import { PropertyPhoto } from './property-photo.entity';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@Injectable()
export class PropertyService {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    @InjectRepository(PropertyPhoto)
    private readonly photoRepo: Repository<PropertyPhoto>,
  ) {}

  async create(dto: CreatePropertyDto, ownerId: string): Promise<Property> {
    const property = this.propertyRepo.create({ ...dto, ownerId });
    return this.propertyRepo.save(property);
  }

  async findByIdOrThrow(id: string): Promise<Property> {
    const property = await this.propertyRepo.findOne({ where: { id }, relations: ['photos'] });
    if (!property) throw new NotFoundException('Imóvel não encontrado');
    return property;
  }

  async search(
    query: SearchPropertyQueryDto,
  ): Promise<{ items: Property[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.propertyRepo
      .createQueryBuilder('property')
      .where('property.isActive = :isActive', { isActive: true });

    if (query.city) qb.andWhere('property.city ILIKE :city', { city: query.city });
    if (query.type) qb.andWhere('property.type = :type', { type: query.type });
    if (query.transactionType) {
      qb.andWhere('property.transactionType = :transactionType', { transactionType: query.transactionType });
    }
    if (query.minPrice !== undefined) qb.andWhere('property.price >= :minPrice', { minPrice: query.minPrice });
    if (query.maxPrice !== undefined) qb.andWhere('property.price <= :maxPrice', { maxPrice: query.maxPrice });
    if (query.bedrooms !== undefined) qb.andWhere('property.bedrooms >= :bedrooms', { bedrooms: query.bedrooms });
    if (query.q) {
      qb.andWhere('(property.title ILIKE :q OR property.description ILIKE :q)', { q: `%${query.q}%` });
    }

    qb.orderBy('property.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    await this.attachPhotos(items);
    return { items, total, page, limit };
  }

  async findMine(
    ownerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: Property[]; total: number; page: number; limit: number }> {
    const [items, total] = await this.propertyRepo.findAndCount({
      where: { ownerId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    await this.attachPhotos(items);
    return { items, total, page, limit };
  }

  async update(id: string, ownerId: string, dto: UpdatePropertyDto): Promise<Property> {
    const property = await this.findByIdOrThrow(id);
    if (property.ownerId !== ownerId) {
      throw new ForbiddenException('Você não pode editar um imóvel de outro usuário');
    }
    Object.assign(property, dto);
    return this.propertyRepo.save(property);
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const property = await this.findByIdOrThrow(id);
    if (property.ownerId !== ownerId) {
      throw new ForbiddenException('Você não pode excluir um imóvel de outro usuário');
    }
    await this.propertyRepo.softRemove(property);
  }

  // A joined query here would multiply/mis-count rows for paginated
  // getManyAndCount()/findAndCount(); a separate lookup keeps counts correct.
  private async attachPhotos(properties: Property[]): Promise<void> {
    if (properties.length === 0) return;
    const photos = await this.photoRepo.find({
      where: { propertyId: In(properties.map((p) => p.id)) },
      order: { createdAt: 'ASC' },
    });
    const photosByProperty = new Map<string, PropertyPhoto[]>();
    for (const photo of photos) {
      const list = photosByProperty.get(photo.propertyId) ?? [];
      list.push(photo);
      photosByProperty.set(photo.propertyId, list);
    }
    for (const property of properties) {
      property.photos = photosByProperty.get(property.id) ?? [];
    }
  }
}
