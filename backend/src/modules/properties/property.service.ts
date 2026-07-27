import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Property, PropertyStatus } from './property.entity';
import { PropertyPhoto } from './property-photo.entity';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { GeocodingService } from '../../shared/geocoding/geocoding.service';

const ADDRESS_FIELDS = ['street', 'number', 'neighborhood', 'city', 'state', 'zipCode'] as const;

@Injectable()
export class PropertyService {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    @InjectRepository(PropertyPhoto)
    private readonly photoRepo: Repository<PropertyPhoto>,
    private readonly geocodingService: GeocodingService,
  ) {}

  async create(dto: CreatePropertyDto, ownerId: string): Promise<Property> {
    const geo = await this.geocodingService.geocode(this.composeAddress(dto));
    const property = this.propertyRepo.create({
      ...dto,
      ownerId,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
    });
    const saved = await this.propertyRepo.save(property);
    await this.setPropertyLocation(saved.id, saved.latitude, saved.longitude);
    return saved;
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
      .where('property.status = :status', { status: PropertyStatus.PUBLISHED });

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

    const hasGeoFilter = query.lat !== undefined && query.lng !== undefined;
    if (hasGeoFilter) {
      const radiusMeters = (query.radiusKm ?? 10) * 1000;
      qb.andWhere('property.location IS NOT NULL')
        .andWhere(
          'ST_DWithin(property.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)',
          { lng: query.lng, lat: query.lat, radiusMeters },
        )
        .orderBy(
          'ST_Distance(property.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)',
          'ASC',
        );
    } else {
      qb.orderBy('property.createdAt', 'DESC');
    }

    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();
    await this.attachPhotos(items);

    if (hasGeoFilter) {
      for (const item of items) {
        if (item.latitude !== null && item.longitude !== null) {
          item.distanceKm = haversineKm(query.lat as number, query.lng as number, item.latitude, item.longitude);
        }
      }
    }

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

    const addressChanged = ADDRESS_FIELDS.some(
      (field) => dto[field] !== undefined && dto[field] !== property[field],
    );

    Object.assign(property, dto);

    if (addressChanged) {
      const geo = await this.geocodingService.geocode(this.composeAddress(property));
      property.latitude = geo?.latitude ?? null;
      property.longitude = geo?.longitude ?? null;
    }

    const saved = await this.propertyRepo.save(property);

    if (addressChanged) {
      await this.setPropertyLocation(saved.id, saved.latitude, saved.longitude);
    }

    return saved;
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const property = await this.findByIdOrThrow(id);
    if (property.ownerId !== ownerId) {
      throw new ForbiddenException('Você não pode excluir um imóvel de outro usuário');
    }
    await this.propertyRepo.softRemove(property);
  }

  private composeAddress(fields: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  }): string {
    return `${fields.street}, ${fields.number}, ${fields.neighborhood}, ${fields.city}, ${fields.state}, ${fields.zipCode}`;
  }

  // The geography column can't be safely set via plain save() (Postgres won't reliably
  // auto-cast a parameterized text value to geography), so it's always written through
  // an explicit ST_SetSRID(ST_MakePoint(...))::geography raw update.
  private async setPropertyLocation(
    propertyId: string,
    latitude: number | null,
    longitude: number | null,
  ): Promise<void> {
    if (latitude === null || longitude === null) {
      await this.propertyRepo.update(propertyId, { location: null });
      return;
    }
    await this.propertyRepo
      .createQueryBuilder()
      .update(Property)
      .set({ location: () => 'ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography' })
      .where('id = :id', { id: propertyId })
      .setParameters({ lng: longitude, lat: latitude })
      .execute();
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

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const EARTH_RADIUS_KM = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
