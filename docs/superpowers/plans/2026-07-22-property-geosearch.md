# Busca Geoespacial de Imóveis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-geocode a property's address on create/edit, and let `GET /properties` filter and sort by distance from a point, with a "Perto de mim" filter in the mobile search screen.

**Architecture:** A new `GeocodingService` (Nominatim wrapper, mirrors the existing `CloudinaryService` pattern) is called by `PropertyService` on create and on address-changing updates, populating plain `latitude`/`longitude` columns plus a PostGIS `geography(Point,4326)` column used only for spatial queries. `GET /properties` gains optional `lat`/`lng`/`radiusKm` params that add a `ST_DWithin` filter and switch the sort order to nearest-first; the display-only `distanceKm` is computed in application code (Haversine) from the already-fetched `latitude`/`longitude`, avoiding any dependency on extracting raw computed columns from TypeORM. Mobile adds a "Perto de mim" toggle using `expo-location`.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostGIS (already running via `postgis/postgis:15-3.4`), Node 22's native `fetch` (no new backend dependency for Nominatim — it's a plain REST call). Mobile: Expo Router ~56, `expo-location` (new).

## Global Constraints

- Geocoding never blocks property create/update: `GeocodingService.geocode()` returns `null` (never throws) on no-match, non-2xx response, or network error — the property is always saved, just without coordinates if geocoding didn't succeed.
- `update()` only re-geocodes when an address field actually changed (`street`, `number`, `neighborhood`, `city`, `state`, or `zipCode`) — editing price/description/etc. must not trigger a geocoding call.
- The PostGIS `location` column is `nullable: true` and marked `select: false` on the entity — it's written only via a raw `UpdateQueryBuilder` call (`ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`), never through plain `repo.save()`, and it's never read back directly (only `ST_DWithin`/`ST_Distance` reference it in raw SQL; the plain `latitude`/`longitude` columns are the readable source of truth). This sidesteps a real risk verified while planning: Postgres does not reliably auto-cast a parameterized text value to `geography` the way it does for a literal SQL cast, so the column is only ever touched through explicit `ST_SetSRID(ST_MakePoint(...))::geography` SQL.
- `GET /properties` without `lat`/`lng` behaves identically to today — no change to existing filters, pagination, or ordering. The radius filter and distance sort only activate when both `lat` and `lng` are provided.
- `distanceKm` is a plain (undecorated, non-`@Column`) property on the `Property` entity class — populated only by `search()` when a geo filter is active, read by `PropertyResponseDto.fromEntity(property)` (still single-argument — do not add a second parameter to `fromEntity`, since `PropertyController` calls it point-free as `items.map(PropertyResponseDto.fromEntity)`, and `Array.prototype.map` passes `(item, index, array)` — a second parameter would silently receive the array index instead of a real value).
- Backend testing follows the established two-level convention: unit tests mock repositories/services via `getRepositoryToken`/DI overrides; e2e tests mock `GeocodingService` via `.overrideProvider(GeocodingService).useValue(...)` on the `AppModule` test module (same pattern already used for `CloudinaryService` in `property-photo.e2e-spec.ts`) — **`property.e2e-spec.ts` also needs this override added**, since every property it creates in `beforeAll` now triggers a real geocoding call otherwise, which would hit Nominatim's live API from CI (against their usage policy and unreliable for tests).
- No new mobile dependencies beyond `expo-location`. Do not pass a `style` prop to `<Button>`/`<Input>` (both spread `{...props}` after their own internal `style` array, silently replacing it).
- Mobile has no test runner beyond `tsc --noEmit` — the only required gate for mobile tasks.
- **Sandbox note for whoever implements this:** if there's no local Postgres/Docker, e2e tests can't be executed (need a live DB to boot the app) — write them carefully, self-review by comparing against the already-passing tests in the same file, and rely on unit tests + `tsc --noEmit` as the runnable local gate. Full e2e validation happens via CI after push.

---

## Task 1: Backend — `GeocodingService` + entity columns + create/update integration

**Files:**
- Create: `backend/src/shared/geocoding/geocoding.module.ts`
- Create: `backend/src/shared/geocoding/geocoding.service.ts`
- Create: `backend/src/shared/geocoding/geocoding.service.spec.ts`
- Modify: `backend/src/modules/properties/property.entity.ts`
- Modify: `backend/src/modules/properties/property.module.ts`
- Modify: `backend/src/modules/properties/property.service.ts`
- Modify: `backend/src/modules/properties/dto/property-response.dto.ts`
- Modify: `backend/src/modules/properties/property.service.spec.ts`
- Modify: `backend/test/property.e2e-spec.ts`

**Interfaces:**
- Produces: `GeocodingService.geocode(address: string): Promise<{ latitude: number; longitude: number } | null>` — consumed by `PropertyService` in this task, and unchanged by Task 2. `Property.latitude: number | null`, `Property.longitude: number | null`, `Property.distanceKm?: number` (undecorated, transient) — `distanceKm` is populated by Task 2's `search()` changes, not this task, but the field must exist on the entity now since `PropertyResponseDto.fromEntity` reads it starting in this task.

- [ ] **Step 1: Write the failing `GeocodingService` unit test**

Create `backend/src/shared/geocoding/geocoding.service.spec.ts`:

```ts
import { GeocodingService } from './geocoding.service';

describe('GeocodingService', () => {
  let service: GeocodingService;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    service = new GeocodingService();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('should return coordinates when Nominatim finds a match', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ lat: '-23.5505', lon: '-46.6333' }]),
    } as Response);

    const result = await service.geocode('Rua Vergueiro, 500, São Paulo, SP');

    expect(result).toEqual({ latitude: -23.5505, longitude: -46.6333 });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org'),
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) }),
    );
  });

  it('should return null when no results are found', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) } as Response);
    const result = await service.geocode('Endereço inexistente 99999');
    expect(result).toBeNull();
  });

  it('should return null when the request fails', async () => {
    fetchSpy.mockResolvedValue({ ok: false } as Response);
    const result = await service.geocode('Qualquer endereço');
    expect(result).toBeNull();
  });

  it('should return null when fetch throws', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    const result = await service.geocode('Qualquer endereço');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend
npx jest --no-coverage geocoding.service.spec.ts
```

Expected: FAIL — `Cannot find module './geocoding.service'`.

- [ ] **Step 3: Implement `GeocodingService`**

Create `backend/src/shared/geocoding/geocoding.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

@Injectable()
export class GeocodingService {
  async geocode(address: string): Promise<GeocodeResult | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'meu-imovel-app (contato@meuimovel.com.br)' },
      });
      if (!response.ok) return null;

      const results = (await response.json()) as Array<{ lat: string; lon: string }>;
      if (results.length === 0) return null;

      return { latitude: parseFloat(results[0].lat), longitude: parseFloat(results[0].lon) };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Create the `GeocodingModule`**

Create `backend/src/shared/geocoding/geocoding.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';

@Module({
  providers: [GeocodingService],
  exports: [GeocodingService],
})
export class GeocodingModule {}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend
npx jest --no-coverage geocoding.service.spec.ts
```

Expected: PASS — 4 tests green.

- [ ] **Step 6: Add `latitude`/`longitude`/`location`/`distanceKm` to the `Property` entity**

Modify `backend/src/modules/properties/property.entity.ts` — add the new columns after `zipCode` and the transient field at the end of the class:

```ts
import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';
import { User } from '../users/user.entity';
import { PropertyPhoto } from './property-photo.entity';

export enum PropertyType {
  APARTMENT = 'apartment',
  HOUSE = 'house',
  COMMERCIAL = 'commercial',
  LAND = 'land',
}

export enum TransactionType {
  SALE = 'sale',
  RENT = 'rent',
}

const decimalTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : parseFloat(value)),
};

@Entity('properties')
export class Property extends BaseEntity {
  @Column()
  title: string;

  @Column('text')
  description: string;

  @Index()
  @Column({ type: 'enum', enum: PropertyType })
  type: PropertyType;

  @Column({ type: 'enum', enum: TransactionType })
  transactionType: TransactionType;

  @Column('decimal', { precision: 12, scale: 2, transformer: decimalTransformer })
  price: number;

  @Column({ type: 'int', nullable: true })
  bedrooms: number | null;

  @Column({ type: 'int', nullable: true })
  bathrooms: number | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true, transformer: decimalTransformer })
  areaM2: number | null;

  @Column()
  street: string;

  @Column()
  number: string;

  @Column()
  neighborhood: string;

  @Index()
  @Column()
  city: string;

  @Column({ type: 'varchar', length: 2 })
  state: string;

  @Column()
  zipCode: string;

  @Column('decimal', { precision: 10, scale: 7, nullable: true, transformer: decimalTransformer })
  latitude: number | null;

  @Column('decimal', { precision: 10, scale: 7, nullable: true, transformer: decimalTransformer })
  longitude: number | null;

  // PostGIS geography point, used only by ST_DWithin/ST_Distance in raw SQL.
  // Never read directly and never written via plain save() — see property.service.ts.
  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true, select: false })
  location: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @OneToMany(() => PropertyPhoto, (photo) => photo.property)
  photos: PropertyPhoto[];

  // Transient — populated only by PropertyService.search() when a geo filter is active. Not a DB column.
  distanceKm?: number;
}
```

- [ ] **Step 7: Wire `GeocodingModule` into `PropertyModule`**

Modify `backend/src/modules/properties/property.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from './property.entity';
import { PropertyPhoto } from './property-photo.entity';
import { PropertyService } from './property.service';
import { PropertyController } from './property.controller';
import { PropertyPhotoService } from './property-photo.service';
import { PropertyPhotoController } from './property-photo.controller';
import { CloudinaryModule } from '../../shared/cloudinary/cloudinary.module';
import { GeocodingModule } from '../../shared/geocoding/geocoding.module';

@Module({
  imports: [TypeOrmModule.forFeature([Property, PropertyPhoto]), CloudinaryModule, GeocodingModule],
  providers: [PropertyService, PropertyPhotoService],
  controllers: [PropertyController, PropertyPhotoController],
})
export class PropertyModule {}
```

- [ ] **Step 8: Add `latitude`/`longitude`/`distanceKm` to `PropertyResponseDto`**

Modify `backend/src/modules/properties/dto/property-response.dto.ts`:

```ts
import { Property, PropertyType, TransactionType } from '../property.entity';

export interface PropertyPhotoResponse {
  id: string;
  url: string;
}

export class PropertyResponseDto {
  id: string;
  title: string;
  description: string;
  type: PropertyType;
  transactionType: TransactionType;
  price: number;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  ownerId: string;
  createdAt: Date;
  photos: PropertyPhotoResponse[];
  distanceKm?: number;

  static fromEntity(property: Property): PropertyResponseDto {
    const dto = new PropertyResponseDto();
    dto.id = property.id;
    dto.title = property.title;
    dto.description = property.description;
    dto.type = property.type;
    dto.transactionType = property.transactionType;
    dto.price = property.price;
    dto.bedrooms = property.bedrooms;
    dto.bathrooms = property.bathrooms;
    dto.areaM2 = property.areaM2;
    dto.street = property.street;
    dto.number = property.number;
    dto.neighborhood = property.neighborhood;
    dto.city = property.city;
    dto.state = property.state;
    dto.zipCode = property.zipCode;
    dto.latitude = property.latitude;
    dto.longitude = property.longitude;
    dto.isActive = property.isActive;
    dto.ownerId = property.ownerId;
    dto.createdAt = property.createdAt;
    dto.photos = [...(property.photos ?? [])]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((photo) => ({ id: photo.id, url: photo.url }));
    dto.distanceKm = property.distanceKm;
    return dto;
  }
}
```

- [ ] **Step 9: Inject `GeocodingService` and geocode on create/update**

Modify `backend/src/modules/properties/property.service.ts` — add the `GeocodingService` dependency, `composeAddress`/`setPropertyLocation` private helpers, and geocoding calls in `create`/`update`. This step only covers `create`/`update`/the helpers; `search`'s radius filter is Task 2. Full file:

```ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Property } from './property.entity';
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
```

- [ ] **Step 10: Update the property service unit tests**

Modify `backend/src/modules/properties/property.service.spec.ts` — add a `mockGeocodingService` and `mockUpdateQueryBuilder`, provide `GeocodingService` in the testing module, extend the `create`/`update` test blocks, and add a `describe('geocoding integration', ...)` block. Full file:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PropertyService } from './property.service';
import { Property, PropertyType, TransactionType } from './property.entity';
import { PropertyPhoto } from './property-photo.entity';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';
import { GeocodingService } from '../../shared/geocoding/geocoding.service';

describe('PropertyService', () => {
  let service: PropertyService;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    // Update-query-builder chain, reused for the location raw update (create/update paths).
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    softRemove: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockPhotoRepo = {
    find: jest.fn(),
  };

  const mockGeocodingService = {
    geocode: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PropertyService,
        { provide: getRepositoryToken(Property), useValue: mockRepo },
        { provide: getRepositoryToken(PropertyPhoto), useValue: mockPhotoRepo },
        { provide: GeocodingService, useValue: mockGeocodingService },
      ],
    }).compile();
    service = module.get(PropertyService);
    jest.clearAllMocks();
    Object.values(mockQueryBuilder).forEach((fn) => {
      if (fn !== mockQueryBuilder.getManyAndCount && fn !== mockQueryBuilder.execute) fn.mockReturnThis();
    });
    mockQueryBuilder.execute.mockResolvedValue(undefined);
    mockPhotoRepo.find.mockResolvedValue([]);
    mockGeocodingService.geocode.mockResolvedValue(null);
  });

  describe('create', () => {
    const dto: CreatePropertyDto = {
      title: 'Casa térrea',
      description: 'Descrição com mais de dez caracteres',
      type: PropertyType.HOUSE,
      transactionType: TransactionType.SALE,
      price: 100000,
      street: 'Rua A',
      number: '1',
      neighborhood: 'Centro',
      city: 'Curitiba',
      state: 'PR',
      zipCode: '80000-000',
    };

    it('should attach ownerId and save the property', async () => {
      const created = { ...dto, ownerId: 'owner-1', id: 'prop-1', latitude: null, longitude: null } as Property;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.create(dto, 'owner-1');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...dto, ownerId: 'owner-1', latitude: null, longitude: null }),
      );
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(result.ownerId).toBe('owner-1');
    });

    it('should geocode the address and save the coordinates when found', async () => {
      mockGeocodingService.geocode.mockResolvedValue({ latitude: -25.4284, longitude: -49.2733 });
      const created = {
        ...dto, ownerId: 'owner-1', id: 'prop-1', latitude: -25.4284, longitude: -49.2733,
      } as Property;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      await service.create(dto, 'owner-1');

      expect(mockGeocodingService.geocode).toHaveBeenCalledWith('Rua A, 1, Centro, Curitiba, PR, 80000-000');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: -25.4284, longitude: -49.2733 }),
      );
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(Property);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        location: expect.any(Function),
      });
      expect(mockQueryBuilder.setParameters).toHaveBeenCalledWith({ lng: -49.2733, lat: -25.4284 });
    });

    it('should save with null coordinates when geocoding finds nothing', async () => {
      mockGeocodingService.geocode.mockResolvedValue(null);
      const created = { ...dto, ownerId: 'owner-1', id: 'prop-1', latitude: null, longitude: null } as Property;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      await service.create(dto, 'owner-1');

      expect(mockRepo.update).toHaveBeenCalledWith('prop-1', { location: null });
    });
  });

  describe('findByIdOrThrow', () => {
    it('should return the property with photos when found', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'prop-1' } as Property);
      const result = await service.findByIdOrThrow('prop-1');
      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'prop-1' }, relations: ['photos'] });
      expect(result.id).toBe('prop-1');
    });

    it('should throw NotFoundException when not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('search', () => {
    it('should apply filters, return paginated results, and attach photos', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[{ id: 'prop-1' } as Property], 1]);
      mockPhotoRepo.find.mockResolvedValue([
        { id: 'photo-1', propertyId: 'prop-1', createdAt: new Date('2026-01-01') } as PropertyPhoto,
      ]);

      const query: SearchPropertyQueryDto = { city: 'São Paulo', page: 2, limit: 10 };
      const result = await service.search(query);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('property.city ILIKE :city', { city: 'São Paulo' });
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.items[0].photos).toEqual([
        { id: 'photo-1', propertyId: 'prop-1', createdAt: new Date('2026-01-01') },
      ]);
      expect(result).toEqual(expect.objectContaining({ total: 1, page: 2, limit: 10 }));
    });

    it('should default to page 1 and limit 20 when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.search({});

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
      expect(mockPhotoRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('findMine', () => {
    it('should return paginated properties owned by the given user, with photos attached', async () => {
      mockRepo.findAndCount.mockResolvedValue([[{ id: 'prop-1', ownerId: 'owner-1' } as Property], 1]);
      mockPhotoRepo.find.mockResolvedValue([
        { id: 'photo-1', propertyId: 'prop-1', createdAt: new Date('2026-01-01') } as PropertyPhoto,
      ]);

      const result = await service.findMine('owner-1', 1, 20);

      expect(mockRepo.findAndCount).toHaveBeenCalledWith({
        where: { ownerId: 'owner-1' },
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result.items[0].photos).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should compute skip from page and limit', async () => {
      mockRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findMine('owner-1', 3, 10);

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    });
  });

  describe('update', () => {
    it('should update and save when the requester owns the property', async () => {
      const existing = {
        id: 'prop-1', ownerId: 'owner-1', price: 100,
        street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipCode: '80000-000',
      } as Property;
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.update('prop-1', 'owner-1', { price: 200 });

      expect(result.price).toBe(200);
      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'prop-1', price: 200 }));
      expect(mockGeocodingService.geocode).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.update('prop-1', 'owner-2', { price: 200 })).rejects.toThrow(ForbiddenException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('should re-geocode when an address field changes', async () => {
      const existing = {
        id: 'prop-1', ownerId: 'owner-1',
        street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipCode: '80000-000',
      } as Property;
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockGeocodingService.geocode.mockResolvedValue({ latitude: -23.5505, longitude: -46.6333 });

      await service.update('prop-1', 'owner-1', { city: 'São Paulo', state: 'SP' });

      expect(mockGeocodingService.geocode).toHaveBeenCalledWith(
        'Rua A, 1, Centro, São Paulo, SP, 80000-000',
      );
      expect(mockQueryBuilder.setParameters).toHaveBeenCalledWith({ lng: -46.6333, lat: -23.5505 });
    });
  });

  describe('remove', () => {
    it('should soft-remove when the requester owns the property', async () => {
      const existing = { id: 'prop-1', ownerId: 'owner-1' } as Property;
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.softRemove.mockResolvedValue(existing);

      await service.remove('prop-1', 'owner-1');

      expect(mockRepo.softRemove).toHaveBeenCalledWith(existing);
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.remove('prop-1', 'owner-2')).rejects.toThrow(ForbiddenException);
      expect(mockRepo.softRemove).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 11: Run the unit tests to verify they pass**

```bash
cd backend
npx jest --no-coverage property.service.spec.ts geocoding.service.spec.ts
```

Expected: PASS — all tests green (property.service.spec.ts now has 3 `create` tests, 4 `update` tests, plus the existing `findByIdOrThrow`/`search`/`findMine`/`remove` tests; geocoding.service.spec.ts has 4 tests).

- [ ] **Step 12: Run `tsc` to catch e2e-file compile issues (can't execute e2e without a DB)**

```bash
cd backend
npx tsc --noEmit -p tsconfig.spec.json
```

Expected: fails right now, because Step 13 hasn't updated `property.e2e-spec.ts`'s `beforeAll` yet to override `GeocodingService` — that's fine, do Step 13 next, then re-run this.

- [ ] **Step 13: Override `GeocodingService` in the property e2e suite and assert coordinates on create**

Modify `backend/test/property.e2e-spec.ts`:

1. Add the `GeocodingService` import and a `mockGeocodingService` right after the existing imports, before the `describe` block:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GeocodingService } from '../src/shared/geocoding/geocoding.service';

const CITY_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  'São Paulo': { latitude: -23.5505, longitude: -46.6333 },
  'Rio de Janeiro': { latitude: -22.9068, longitude: -43.1729 },
  Curitiba: { latitude: -25.4284, longitude: -49.2733 },
  Salvador: { latitude: -12.9777, longitude: -38.5016 },
  'Belo Horizonte': { latitude: -19.9167, longitude: -43.9345 },
  'Porto Alegre': { latitude: -30.0346, longitude: -51.2177 },
};

const mockGeocodingService = {
  geocode: jest.fn((address: string) => {
    const city = Object.keys(CITY_COORDINATES).find((c) => address.includes(c));
    return Promise.resolve(city ? CITY_COORDINATES[city] : null);
  }),
};
```

2. In `beforeAll`, change the `Test.createTestingModule({ imports: [AppModule] }).compile()` call to override `GeocodingService`, matching the pattern already used for `CloudinaryService` in `property-photo.e2e-spec.ts`:

```ts
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GeocodingService)
      .useValue(mockGeocodingService)
      .compile();
```

3. Extend the `POST /api/v1/properties — owner cria imóvel e retorna 201` test to also assert coordinates were set (the existing `validProperty` fixture's `city` is `'Belo Horizonte'`, which is in `CITY_COORDINATES`):

```ts
  it('POST /api/v1/properties — owner cria imóvel e retorna 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validProperty)
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe(validProperty.title);
    expect(res.body.price).toBe(validProperty.price);
    expect(res.body.isActive).toBe(true);
    expect(res.body.ownerId).toBeDefined();
    expect(res.body.latitude).toBeCloseTo(-19.9167, 3);
    expect(res.body.longitude).toBeCloseTo(-43.9345, 3);
  });
```

- [ ] **Step 14: Run `tsc` again to confirm the e2e file compiles**

```bash
cd backend
npx tsc --noEmit -p tsconfig.spec.json
```

Expected: no errors.

- [ ] **Step 15: Commit**

```bash
git add backend/src/shared/geocoding backend/src/modules/properties/property.entity.ts backend/src/modules/properties/property.module.ts backend/src/modules/properties/property.service.ts backend/src/modules/properties/property.service.spec.ts backend/src/modules/properties/dto/property-response.dto.ts backend/test/property.e2e-spec.ts
git commit -m "feat: auto-geocode property address on create/edit"
```

---

## Task 2: Backend — `GET /properties` radius filter + distance sort

**Files:**
- Modify: `backend/src/modules/properties/dto/search-property-query.dto.ts`
- Modify: `backend/src/modules/properties/property.service.ts`
- Modify: `backend/src/modules/properties/property.service.spec.ts`
- Modify: `backend/test/property.e2e-spec.ts`

**Interfaces:**
- Consumes: `Property.latitude`/`longitude`/`distanceKm` and `GeocodingService` wiring from Task 1 (unchanged).
- Produces: `SearchPropertyQueryDto.lat`/`lng`/`radiusKm` (optional) — consumed by Task 3/4's mobile `PropertySearchFilters`.

- [ ] **Step 1: Write the failing e2e tests**

Modify `backend/test/property.e2e-spec.ts` — add 3 new `it` blocks right after the existing `it('GET /api/v1/properties?q= — busca textual', ...)` block and before `it('GET /api/v1/properties/:id — retorna o imóvel', ...)`:

```ts

  it('GET /api/v1/properties?lat=&lng=&radiusKm= — filtra por proximidade e ordena por distância', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .query({ lat: -23.5505, lng: -46.6333, radiusKm: 50 })
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([spFlatId, spHouseId]));
    expect(ids).not.toContain(rioFlatId);
    expect(ids).not.toContain(curitibaLandId);
    expect(res.body.items[0].distanceKm).toBeCloseTo(0, 1);
  });

  it('GET /api/v1/properties?lat=&lng= — usa raio padrão de 10km quando radiusKm não é informado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .query({ lat: -23.5505, lng: -46.6333 })
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([spFlatId, spHouseId]));
    expect(ids).not.toContain(curitibaLandId);
  });

  it('GET /api/v1/properties — sem lat/lng mantém a ordenação por data, sem filtro de raio', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([spFlatId, spHouseId, rioFlatId, curitibaLandId]));
    expect(res.body.items[0].distanceKm).toBeUndefined();
  });
```

- [ ] **Step 2: Run the e2e tests to verify the new ones fail**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test CLOUDINARY_CLOUD_NAME=test CLOUDINARY_API_KEY=test CLOUDINARY_API_SECRET=test NODE_OPTIONS=--experimental-vm-modules npx jest --config test/jest-e2e.json --no-coverage --forceExit -t "Properties"
```

Expected: existing tests still PASS (properties are already geocoded per Task 1); the 3 new radius-filter tests FAIL (400 — `lat`/`lng`/`radiusKm` aren't recognized fields yet, stripped by `whitelist: true`, so the filter has no effect and city-mismatched fixtures leak into results / `distanceKm` is never set).

- [ ] **Step 3: Add `lat`/`lng`/`radiusKm` to the search query DTO**

Modify `backend/src/modules/properties/dto/search-property-query.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsString, IsEnum, IsNumber, IsInt, IsOptional, Min, Max,
} from 'class-validator';
import { PropertyType, TransactionType } from '../property.entity';

export class SearchPropertyQueryDto {
  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsEnum(PropertyType)
  type?: PropertyType;

  @IsOptional()
  @IsEnum(TransactionType)
  transactionType?: TransactionType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  radiusKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
```

- [ ] **Step 4: Add the radius filter and distance sort/compute to `search()`**

Modify `backend/src/modules/properties/property.service.ts` — replace the `search` method and add a `haversineKm` helper function at the bottom of the file (below the class):

```ts
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
```

And this function at the very bottom of `property.service.ts`, after the closing `}` of the `PropertyService` class:

```ts
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
```

- [ ] **Step 5: Add unit tests for the radius filter**

Modify `backend/src/modules/properties/property.service.spec.ts` — add these two tests inside the existing `describe('search', ...)` block, after the "should default to page 1 and limit 20" test:

```ts

    it('should add the radius filter and order by distance when lat/lng are provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [{ id: 'prop-1', latitude: -23.5505, longitude: -46.6333 } as Property],
        1,
      ]);

      const query: SearchPropertyQueryDto = { lat: -23.55, lng: -46.63, radiusKm: 25 };
      const result = await service.search(query);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('property.location IS NOT NULL');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ST_DWithin(property.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)',
        { lng: -46.63, lat: -23.55, radiusMeters: 25000 },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'ST_Distance(property.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)',
        'ASC',
      );
      expect(result.items[0].distanceKm).toBeCloseTo(0, 1);
    });

    it('should default the radius to 10km when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.search({ lat: -23.55, lng: -46.63 });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ST_DWithin(property.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)',
        { lng: -46.63, lat: -23.55, radiusMeters: 10000 },
      );
    });
```

- [ ] **Step 6: Run the unit tests to verify they pass**

```bash
cd backend
npx jest --no-coverage property.service.spec.ts
```

Expected: PASS — all tests green, including the 2 new radius-filter tests.

- [ ] **Step 7: Run the e2e tests to verify they pass**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test CLOUDINARY_CLOUD_NAME=test CLOUDINARY_API_KEY=test CLOUDINARY_API_SECRET=test NODE_OPTIONS=--experimental-vm-modules npx jest --config test/jest-e2e.json --no-coverage --forceExit
```

Expected: PASS — the full property e2e suite green, including the 3 new radius-search tests.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/properties/dto/search-property-query.dto.ts backend/src/modules/properties/property.service.ts backend/src/modules/properties/property.service.spec.ts backend/test/property.e2e-spec.ts
git commit -m "feat: add radius filter and distance sort to property search"
```

---

## Task 3: Mobile — `expo-location` + extend `services/properties.ts`

**Files:**
- Modify: `mobile/package.json` (via `npx expo install`)
- Modify: `mobile/services/properties.ts`

**Interfaces:**
- Produces: `PropertySearchFilters.lat?`/`lng?`/`radiusKm?`, `Property.latitude`/`longitude`/`distanceKm?` — consumed by Task 4.

- [ ] **Step 1: Install `expo-location`**

```bash
cd mobile
npx expo install expo-location
```

Expected: adds `expo-location` to `mobile/package.json` at the version compatible with the installed Expo SDK (56).

- [ ] **Step 2: Verify the installed package's API matches what this plan assumes**

Before writing Task 4's code, confirm against the installed package that `expo-location` exports `requestForegroundPermissionsAsync()` (returning an object with a `status` field) and `getCurrentPositionAsync(options)` (returning an object with `coords.latitude`/`coords.longitude`):

```bash
cd mobile
grep -n "requestForegroundPermissionsAsync\|getCurrentPositionAsync" node_modules/expo-location/build/*.d.ts
```

If the signatures differ from what's used in Task 4's code below, adjust Task 4 to match the installed package's actual types — this plan's mobile location code was verified against the current Expo SDK 56 docs, but the installed package is the ground truth per `mobile/AGENTS.md`.

- [ ] **Step 3: Add geo fields to `services/properties.ts`**

Modify `mobile/services/properties.ts` — add `latitude`/`longitude`/`distanceKm` to `Property` and `lat`/`lng`/`radiusKm` to `PropertySearchFilters`. Full file:

```ts
import { api } from './api';

export enum PropertyType {
  APARTMENT = 'apartment',
  HOUSE = 'house',
  COMMERCIAL = 'commercial',
  LAND = 'land',
}

export enum TransactionType {
  SALE = 'sale',
  RENT = 'rent',
}

export interface PropertyPhoto {
  id: string;
  url: string;
}

export interface Property {
  id: string;
  title: string;
  description: string;
  type: PropertyType;
  transactionType: TransactionType;
  price: number;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  ownerId: string;
  createdAt: string;
  photos: PropertyPhoto[];
  distanceKm?: number;
}

export interface PropertySearchFilters {
  city?: string;
  type?: PropertyType;
  transactionType?: TransactionType;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  q?: string;
  page?: number;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export interface PropertySearchResult {
  items: Property[];
  total: number;
  page: number;
  limit: number;
}

export interface PropertyInput {
  title: string;
  description: string;
  type: PropertyType;
  transactionType: TransactionType;
  price: number;
  bedrooms?: number;
  bathrooms?: number;
  areaM2?: number;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface UpdatePropertyInput extends Partial<PropertyInput> {
  isActive?: boolean;
}

export interface UploadablePhoto {
  uri: string;
  name: string;
  type: string;
}

export const propertyApi = {
  search: (filters: PropertySearchFilters = {}) =>
    api.get<PropertySearchResult>('/properties', { params: filters }),

  getById: (id: string) => api.get<Property>(`/properties/${id}`),

  getMine: (page?: number) =>
    api.get<PropertySearchResult>('/properties/mine', { params: { page } }),

  create: (dto: PropertyInput) => api.post<Property>('/properties', dto),

  update: (id: string, dto: UpdatePropertyInput) => api.patch<Property>(`/properties/${id}`, dto),

  remove: (id: string) => api.delete(`/properties/${id}`),

  uploadPhotos: (id: string, photos: UploadablePhoto[]) => {
    const formData = new FormData();
    photos.forEach((photo) => {
      // React Native's FormData accepts { uri, name, type } for file fields at
      // runtime, but its TS type only declares string | Blob — the cast is a
      // known, unavoidable mismatch between the RN polyfill and its types.
      formData.append('photos', { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob);
    });
    return api.post<PropertyPhoto[]>(`/properties/${id}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  deletePhoto: (id: string, photoId: string) => api.delete(`/properties/${id}/photos/${photoId}`),
};
```

- [ ] **Step 4: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/services/properties.ts
git commit -m "feat: add expo-location and geo fields to properties API client"
```

---

## Task 4: Mobile — "Perto de mim" filter in the search screen

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `propertyApi.search`'s `lat`/`lng`/`radiusKm` filters and `Property.distanceKm` from Task 3.

- [ ] **Step 1: Add the "Perto de mim" toggle and radius selector**

Overwrite `mobile/app/(tabs)/index.tsx` with the full file:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Image } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../stores/auth.store';
import { propertyApi, Property } from '../../services/properties';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };
const RADIUS_OPTIONS = [5, 10, 20];

function formatPrice(price: number, transactionType: string) {
  const value = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return transactionType === 'rent' ? `${value}/mês` : value;
}

export default function SearchScreen() {
  const user = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [nearMe, setNearMe] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await propertyApi.search({
        q: q || undefined,
        city: city || undefined,
        lat: nearMe && coords ? coords.lat : undefined,
        lng: nearMe && coords ? coords.lng : undefined,
        radiusKm: nearMe && coords ? radiusKm : undefined,
      });
      setItems(data.items);
    } catch {
      Alert.alert('Erro', 'Não foi possível buscar os imóveis');
    } finally {
      setLoading(false);
    }
  }, [q, city, nearMe, coords, radiusKm]);

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearMe, coords, radiusKm]);

  const toggleNearMe = async () => {
    if (nearMe) {
      setNearMe(false);
      setCoords(null);
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão negada', 'Ative a localização para buscar imóveis perto de você');
      return;
    }
    const position = await Location.getCurrentPositionAsync({});
    setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
    setNearMe(true);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Olá, {user?.name} 👋</Text>
      <Input label="Buscar" value={q} onChangeText={setQ} placeholder="Título ou descrição" />
      <Input label="Cidade" value={city} onChangeText={setCity} placeholder="Ex: São Paulo" />

      <TouchableOpacity style={[styles.nearMeButton, nearMe && styles.nearMeButtonActive]} onPress={toggleNearMe}>
        <Text style={[styles.nearMeText, nearMe && styles.nearMeTextActive]}>
          📍 {nearMe ? 'Perto de mim (ativo)' : 'Perto de mim'}
        </Text>
      </TouchableOpacity>

      {nearMe ? (
        <View style={styles.radiusRow}>
          {RADIUS_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.radiusOption, radiusKm === option && styles.radiusOptionSelected]}
              onPress={() => setRadiusKm(option)}
            >
              <Text style={[styles.radiusText, radiusKm === option && styles.radiusTextSelected]}>
                {option} km
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <Button title="Buscar" onPress={search} loading={loading} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.list}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Nenhum imóvel encontrado</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: '/property/[id]', params: { id: item.id } })}
          >
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSub}>
              {item.city} • {TRANSACTION_LABEL[item.transactionType]}
              {item.distanceKm !== undefined ? ` • ${item.distanceKm.toFixed(1)} km` : ''}
            </Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price, item.transactionType)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff' },
  greeting: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  list: { marginTop: 16 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 32 },
  nearMeButton: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1.5,
    borderColor: '#d1d5db', marginBottom: 8, alignSelf: 'flex-start',
  },
  nearMeButtonActive: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  nearMeText: { fontSize: 14, color: '#374151', fontWeight: '600' },
  nearMeTextActive: { color: '#fff' },
  radiusRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  radiusOption: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: '#d1d5db',
  },
  radiusOptionSelected: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  radiusText: { fontSize: 14, color: '#374151' },
  radiusTextSelected: { color: '#fff', fontWeight: '700' },
  card: {
    padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 12,
  },
  cardImage: { width: '100%', height: 140, borderRadius: 8, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '700', color: '#1a56db', marginTop: 8 },
});
```

Notes on the logic:
- `search`'s single `useEffect` (dependency `[nearMe, coords, radiusKm]`) fires once on mount (initial values `false`/`null`/`10`) and again any time `toggleNearMe` changes `nearMe`/`coords`, or the user taps a different radius pill — no separate mount-only effect needed, and no stale-closure risk, since `search` itself is a `useCallback` that always captures the latest `nearMe`/`coords`/`radiusKm`.
- Turning "Perto de mim" off (`nearMe` → `false`, `coords` → `null`) also re-triggers the effect, which correctly re-runs a normal (non-geo) search.

- [ ] **Step 2: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "mobile/app/(tabs)/index.tsx"
git commit -m "feat: add Perto de mim proximity filter to property search"
```

- [ ] **Step 4: Manual smoke test (recommended before pushing)**

Run the backend against a local Postgres (with real or placeholder Cloudinary env vars — photo upload isn't touched by this feature) and the Expo dev server on a physical device or emulator with location services enabled. Create a property with a real, geocodable address, confirm `latitude`/`longitude` come back non-null on the detail/edit screens. In the search tab, tap "Perto de mim", grant location permission, and confirm nearby listings appear sorted by distance with a "X.X km" label; change the radius and confirm the result set updates; toggle it off and confirm the search reverts to normal.

---

## Final Step: Push and verify CI

After all 4 tasks are committed:

```bash
git push
```

Then check `https://github.com/celiooliveir/meu-imovel/actions` — `Backend — Unit + E2E` should run the extended `property.e2e-spec.ts` (including the new geocoding-on-create assertion and the 3 radius-search tests) against a real Postgres/PostGIS, and `Mobile — TypeScript` should pass `tsc --noEmit`.
