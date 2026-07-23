# Upload de Fotos de Imóveis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `owner`/`broker` upload up to 10 photos per listing (backend-mediated to Cloudinary), display a cover photo on cards and a carousel on the detail screen, and manage/delete photos from a dedicated mobile screen.

**Architecture:** Backend: a new `CloudinaryService` (thin wrapper around the official SDK) plus a `PropertyPhoto` entity/service/controller nested under `properties/:propertyId/photos`, reusing the existing `JwtAuthGuard`/`RolesGuard`/ownership-check pattern. Mobile: `expo-image-picker` for multi-select, `expo-image-manipulator` to resize/compress before upload, a new photo-management screen, and small additions to the existing search/listing/detail screens to show photos.

**Tech Stack:** Backend adds `cloudinary` (official Node SDK) and `multer`/`@types/multer` (file upload, memory storage) to the existing NestJS/TypeORM stack. Mobile adds `expo-image-picker` and `expo-image-manipulator` (installed via `npx expo install` for SDK-56-compatible versions) to the existing Expo Router stack.

## Global Constraints

- Upload is backend-mediated: mobile sends multipart to our API, our API uploads to Cloudinary via `CloudinaryService`, mobile never talks to Cloudinary directly.
- Max 10 photos per property, enforced server-side (existing count + new files > 10 → 400) — this is the authoritative check; the mobile UI also prevents selecting more than the remaining slots, but the server check is what actually protects data integrity.
- Accepted file types: `image/jpeg`, `image/png`, `image/webp`. Max 10MB per file (server-enforced regardless of client-side compression, since a client could bypass it).
- `multer` uses **memory storage** (buffers, no disk writes) — the interceptor must be configured with `storage: memoryStorage()` explicitly, since NestJS's `FilesInterceptor` defaults to disk storage otherwise.
- `CloudinaryService` must be **mocked/overridden** in e2e tests via `.overrideProvider(CloudinaryService).useValue(...)` — tests must never make a real network call to Cloudinary. Unit tests mock it the normal way (constructor injection).
- **A known TypeORM pitfall drives a specific design choice:** `getManyAndCount()`/`findAndCount()` combined with a `leftJoinAndSelect`/`relations` on a one-to-many collection (like `photos`) can multiply/miscount rows for paginated queries. `PropertyService.search()` and `findMine()` therefore do **not** join photos in the paginated query — they fetch the page of properties first, then run one separate query to fetch all photos for those property IDs and attach them in memory (see `attachPhotos` in Task 1). `findByIdOrThrow()` (single-entity, no pagination) can safely use `relations: ['photos']` directly — there's no count/multiplication risk for a single row.
- Cover photo = first photo uploaded (ordered by `createdAt` ascending) — no explicit ordering field, no reordering feature in this phase.
- Client-side compression before upload (mobile): resize to max 1920px width, JPEG, quality 0.8, via `expo-image-manipulator`.
- **`mobile/AGENTS.md` requires verifying the Expo API against the installed package before writing code that uses it.** This plan's `expo-image-manipulator` code is based on documentation that gave two different import styles for the same API across two fetches — Task 3's first step is to resolve this by reading the actually-installed package's type definitions before finalizing the import. Do not skip this.
- Do **not** pass a `style` prop to `<Button>` or `<Input>` — both spread `{...props}` after their own internal `style` array, silently replacing the built-in styling.
- Backend behavior covered at two levels (existing convention): unit tests mock repositories/services via `getRepositoryToken`/DI overrides; e2e tests hit the real HTTP/DB stack (with `CloudinaryService` mocked, per above).
- Mobile has no test runner beyond `tsc --noEmit` — the only required gate for mobile tasks.
- **Sandbox note for whoever implements this:** if there is no local Postgres/Docker available, e2e tests cannot be executed (they need a live DB to boot the app) — write them carefully, self-review against the existing passing tests, and rely on unit tests + `tsc --noEmit` as the runnable local gate. Full e2e validation happens via CI after push. The user has also confirmed they will need to create a Cloudinary account and provide `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` before manual end-to-end testing (on a real device) will work — this is not needed for the automated test suite, since `CloudinaryService` is mocked there.

---

## Task 1: Backend — Cloudinary infra, PropertyPhoto entity/service/controller, tests

**Files:**
- Create: `backend/src/shared/cloudinary/cloudinary.service.ts`
- Create: `backend/src/shared/cloudinary/cloudinary.module.ts`
- Create: `backend/src/modules/properties/property-photo.entity.ts`
- Create: `backend/src/modules/properties/property-photo.service.ts`
- Create: `backend/src/modules/properties/property-photo.service.spec.ts`
- Create: `backend/src/modules/properties/property-photo.controller.ts`
- Create: `backend/test/property-photo.e2e-spec.ts`
- Modify: `backend/src/modules/properties/property.entity.ts`
- Modify: `backend/src/modules/properties/property.service.ts`
- Modify: `backend/src/modules/properties/property.service.spec.ts`
- Modify: `backend/src/modules/properties/dto/property-response.dto.ts`
- Modify: `backend/src/modules/properties/property.module.ts`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces: `CloudinaryService.upload(buffer, folder): Promise<{url, publicId}>`, `CloudinaryService.destroy(publicId): Promise<void>`; `PropertyPhoto` entity; `PropertyPhotoService.upload(propertyId, ownerId, files): Promise<PropertyPhoto[]>`, `PropertyPhotoService.remove(propertyId, photoId, ownerId): Promise<void>`; `POST/DELETE properties/:propertyId/photos`; `PropertyResponseDto.photos: {id, url}[]` — all consumed by mobile starting in Task 2.

- [ ] **Step 1: Install new backend dependencies**

```bash
cd backend
npm install cloudinary multer
npm install --save-dev @types/multer
```

- [ ] **Step 2: Add Cloudinary env vars to `.env.example`**

Modify `backend/.env.example` — add at the end:

```
# Cloudinary
CLOUDINARY_CLOUD_NAME=seu-cloud-name
CLOUDINARY_API_KEY=sua-api-key
CLOUDINARY_API_SECRET=seu-api-secret
```

- [ ] **Step 3: Create the Cloudinary service and module**

Create `backend/src/shared/cloudinary/cloudinary.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  constructor(config: ConfigService) {
    cloudinary.config({
      cloud_name: config.getOrThrow('CLOUDINARY_CLOUD_NAME'),
      api_key: config.getOrThrow('CLOUDINARY_API_KEY'),
      api_secret: config.getOrThrow('CLOUDINARY_API_SECRET'),
    });
  }

  upload(buffer: Buffer, folder: string): Promise<{ url: string; publicId: string }> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error('Falha no upload para o Cloudinary'));
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      uploadStream.end(buffer);
    });
  }

  async destroy(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}
```

Create `backend/src/shared/cloudinary/cloudinary.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';

@Module({
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}
```

- [ ] **Step 4: Create the PropertyPhoto entity**

Create `backend/src/modules/properties/property-photo.entity.ts`:

```ts
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';
import { Property } from './property.entity';

@Entity('property_photos')
export class PropertyPhoto extends BaseEntity {
  @Column()
  url: string;

  @Column()
  publicId: string;

  @Column({ type: 'uuid' })
  propertyId: string;

  @ManyToOne(() => Property, (property) => property.photos)
  @JoinColumn({ name: 'propertyId' })
  property: Property;
}
```

- [ ] **Step 5: Add the `photos` relation to Property**

Modify `backend/src/modules/properties/property.entity.ts` — add the import and the relation at the end of the class:

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

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @OneToMany(() => PropertyPhoto, (photo) => photo.property)
  photos: PropertyPhoto[];
}
```

- [ ] **Step 6: Update `PropertyService` to attach photos (without breaking pagination counts)**

Modify `backend/src/modules/properties/property.service.ts` — full replacement:

```ts
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
```

- [ ] **Step 7: Update the `PropertyResponseDto` to include photos**

Modify `backend/src/modules/properties/dto/property-response.dto.ts` — full replacement:

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
  isActive: boolean;
  ownerId: string;
  createdAt: Date;
  photos: PropertyPhotoResponse[];

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
    dto.isActive = property.isActive;
    dto.ownerId = property.ownerId;
    dto.createdAt = property.createdAt;
    dto.photos = [...(property.photos ?? [])]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((photo) => ({ id: photo.id, url: photo.url }));
    return dto;
  }
}
```

- [ ] **Step 8: Create the PropertyPhotoService**

Create `backend/src/modules/properties/property-photo.service.ts`:

```ts
import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PropertyPhoto } from './property-photo.entity';
import { PropertyService } from './property.service';
import { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';

const MAX_PHOTOS_PER_PROPERTY = 10;

@Injectable()
export class PropertyPhotoService {
  constructor(
    @InjectRepository(PropertyPhoto)
    private readonly photoRepo: Repository<PropertyPhoto>,
    private readonly propertyService: PropertyService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async upload(propertyId: string, ownerId: string, files: Express.Multer.File[]): Promise<PropertyPhoto[]> {
    const property = await this.propertyService.findByIdOrThrow(propertyId);
    if (property.ownerId !== ownerId) {
      throw new ForbiddenException('Você não pode adicionar fotos a um imóvel de outro usuário');
    }

    const existingCount = await this.photoRepo.count({ where: { propertyId } });
    if (existingCount + files.length > MAX_PHOTOS_PER_PROPERTY) {
      throw new BadRequestException(`Limite de ${MAX_PHOTOS_PER_PROPERTY} fotos por imóvel excedido`);
    }

    return Promise.all(
      files.map(async (file) => {
        const { url, publicId } = await this.cloudinary.upload(file.buffer, `properties/${propertyId}`);
        const photo = this.photoRepo.create({ url, publicId, propertyId });
        return this.photoRepo.save(photo);
      }),
    );
  }

  async remove(propertyId: string, photoId: string, ownerId: string): Promise<void> {
    const property = await this.propertyService.findByIdOrThrow(propertyId);
    if (property.ownerId !== ownerId) {
      throw new ForbiddenException('Você não pode excluir uma foto de um imóvel de outro usuário');
    }

    const photo = await this.photoRepo.findOneBy({ id: photoId, propertyId });
    if (!photo) throw new NotFoundException('Foto não encontrada');

    await this.cloudinary.destroy(photo.publicId);
    await this.photoRepo.remove(photo);
  }
}
```

- [ ] **Step 9: Create the PropertyPhotoController**

Create `backend/src/modules/properties/property-photo.controller.ts`:

```ts
import {
  Controller, Post, Delete, Param, UseGuards, UseInterceptors, UploadedFiles,
  ParseUUIDPipe, ParseFilePipeBuilder, HttpStatus, HttpCode,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PropertyPhotoService } from './property-photo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

@Controller('properties/:propertyId/photos')
export class PropertyPhotoController {
  constructor(private readonly photoService: PropertyPhotoService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  @UseInterceptors(FilesInterceptor('photos', 10, { storage: memoryStorage() }))
  async upload(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @UploadedFiles(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
        .addMaxSizeValidator({ maxSize: MAX_FILE_SIZE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    files: Express.Multer.File[],
    @CurrentUser() user: { id: string },
  ) {
    const photos = await this.photoService.upload(propertyId, user.id, files);
    return photos.map((photo) => ({ id: photo.id, url: photo.url }));
  }

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  async remove(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.photoService.remove(propertyId, photoId, user.id);
  }
}
```

- [ ] **Step 10: Wire everything into PropertyModule**

Modify `backend/src/modules/properties/property.module.ts` — full replacement:

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

@Module({
  imports: [TypeOrmModule.forFeature([Property, PropertyPhoto]), CloudinaryModule],
  providers: [PropertyService, PropertyPhotoService],
  controllers: [PropertyController, PropertyPhotoController],
})
export class PropertyModule {}
```

- [ ] **Step 11: Update the `PropertyService` unit test for the new constructor dependency and `attachPhotos` behavior**

Modify `backend/src/modules/properties/property.service.spec.ts` — full replacement:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PropertyService } from './property.service';
import { Property, PropertyType, TransactionType } from './property.entity';
import { PropertyPhoto } from './property-photo.entity';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';

describe('PropertyService', () => {
  let service: PropertyService;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    softRemove: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockPhotoRepo = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PropertyService,
        { provide: getRepositoryToken(Property), useValue: mockRepo },
        { provide: getRepositoryToken(PropertyPhoto), useValue: mockPhotoRepo },
      ],
    }).compile();
    service = module.get(PropertyService);
    jest.clearAllMocks();
    Object.values(mockQueryBuilder).forEach((fn) => {
      if (fn !== mockQueryBuilder.getManyAndCount) fn.mockReturnThis();
    });
    mockPhotoRepo.find.mockResolvedValue([]);
  });

  describe('create', () => {
    it('should attach ownerId and save the property', async () => {
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
      const created = { ...dto, ownerId: 'owner-1' } as Property;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.create(dto, 'owner-1');

      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ ...dto, ownerId: 'owner-1' }));
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(result.ownerId).toBe('owner-1');
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
      const existing = { id: 'prop-1', ownerId: 'owner-1', price: 100 } as Property;
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.update('prop-1', 'owner-1', { price: 200 });

      expect(result.price).toBe(200);
      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'prop-1', price: 200 }));
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.update('prop-1', 'owner-2', { price: 200 })).rejects.toThrow(ForbiddenException);
      expect(mockRepo.save).not.toHaveBeenCalled();
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

- [ ] **Step 12: Create the PropertyPhotoService unit test**

Create `backend/src/modules/properties/property-photo.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PropertyPhotoService } from './property-photo.service';
import { PropertyPhoto } from './property-photo.entity';
import { Property } from './property.entity';
import { PropertyService } from './property.service';
import { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';

describe('PropertyPhotoService', () => {
  let service: PropertyPhotoService;

  const mockPhotoRepo = {
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
    remove: jest.fn(),
  };

  const mockPropertyService = {
    findByIdOrThrow: jest.fn(),
  };

  const mockCloudinary = {
    upload: jest.fn(),
    destroy: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PropertyPhotoService,
        { provide: getRepositoryToken(PropertyPhoto), useValue: mockPhotoRepo },
        { provide: PropertyService, useValue: mockPropertyService },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();
    service = module.get(PropertyPhotoService);
    jest.clearAllMocks();
  });

  describe('upload', () => {
    const file = { buffer: Buffer.from('fake-image') } as Express.Multer.File;

    it('should upload files to Cloudinary and save photo records when the requester owns the property', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);
      mockPhotoRepo.count.mockResolvedValue(0);
      mockCloudinary.upload.mockResolvedValue({
        url: 'https://cloudinary/img.jpg',
        publicId: 'properties/prop-1/img',
      });
      mockPhotoRepo.create.mockReturnValue({ id: 'photo-1' } as PropertyPhoto);
      mockPhotoRepo.save.mockResolvedValue({ id: 'photo-1' } as PropertyPhoto);

      const result = await service.upload('prop-1', 'owner-1', [file]);

      expect(mockCloudinary.upload).toHaveBeenCalledWith(file.buffer, 'properties/prop-1');
      expect(mockPhotoRepo.create).toHaveBeenCalledWith({
        url: 'https://cloudinary/img.jpg',
        publicId: 'properties/prop-1/img',
        propertyId: 'prop-1',
      });
      expect(result).toEqual([{ id: 'photo-1' }]);
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.upload('prop-1', 'owner-2', [file])).rejects.toThrow(ForbiddenException);
      expect(mockCloudinary.upload).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the photo limit would be exceeded', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);
      mockPhotoRepo.count.mockResolvedValue(9);

      await expect(service.upload('prop-1', 'owner-1', [file, file])).rejects.toThrow(BadRequestException);
      expect(mockCloudinary.upload).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should destroy the Cloudinary asset and remove the record when the requester owns the property', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);
      const photo = { id: 'photo-1', propertyId: 'prop-1', publicId: 'properties/prop-1/img' } as PropertyPhoto;
      mockPhotoRepo.findOneBy.mockResolvedValue(photo);

      await service.remove('prop-1', 'photo-1', 'owner-1');

      expect(mockCloudinary.destroy).toHaveBeenCalledWith('properties/prop-1/img');
      expect(mockPhotoRepo.remove).toHaveBeenCalledWith(photo);
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.remove('prop-1', 'photo-1', 'owner-2')).rejects.toThrow(ForbiddenException);
      expect(mockCloudinary.destroy).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the photo does not exist', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);
      mockPhotoRepo.findOneBy.mockResolvedValue(null);

      await expect(service.remove('prop-1', 'missing', 'owner-1')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 13: Run the unit tests to verify they pass**

```bash
cd backend
npx jest --no-coverage property.service.spec.ts property-photo.service.spec.ts
```

Expected: PASS — 11 tests in `property.service.spec.ts` + 6 tests in `property-photo.service.spec.ts`.

- [ ] **Step 14: Create the e2e test file**

Create `backend/test/property-photo.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CloudinaryService } from '../src/shared/cloudinary/cloudinary.service';

describe('Property Photos (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let ownerBToken: string;
  let tenantToken: string;
  let propertyId: string;

  const mockCloudinaryService = {
    upload: jest.fn().mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/fake.jpg',
      publicId: 'fake-public-id',
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const tempDs = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
    });
    await tempDs.initialize();
    await tempDs.query('DROP SCHEMA public CASCADE');
    await tempDs.query('CREATE SCHEMA public');
    await tempDs.destroy();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CloudinaryService)
      .useValue(mockCloudinaryService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const ownerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Ana Owner', email: 'ana.owner@teste.com', password: 'senha1234', role: 'owner' });
    ownerToken = ownerRes.body.accessToken;

    const ownerBRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Carla OwnerB', email: 'carla.ownerb@teste.com', password: 'senha1234', role: 'owner' });
    ownerBToken = ownerBRes.body.accessToken;

    const tenantRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Bruno Tenant', email: 'bruno.tenant@teste.com', password: 'senha1234', role: 'buyer_tenant' });
    tenantToken = tenantRes.body.accessToken;

    const propertyRes = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Apartamento com vista para o parque',
        description: 'Apartamento amplo, bem iluminado, próximo ao parque municipal.',
        type: 'apartment',
        transactionType: 'sale',
        price: 400000,
        street: 'Rua das Acácias',
        number: '200',
        neighborhood: 'Jardim Botânico',
        city: 'Curitiba',
        state: 'PR',
        zipCode: '80210-000',
      });
    propertyId = propertyRes.body.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    mockCloudinaryService.upload.mockClear();
    mockCloudinaryService.destroy.mockClear();
  });

  it('POST /api/v1/properties/:id/photos — dono envia foto e recebe 201', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('photos', Buffer.from('fake-image-content'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBeDefined();
    expect(res.body[0].url).toBe('https://res.cloudinary.com/demo/image/upload/fake.jpg');
    expect(mockCloudinaryService.upload).toHaveBeenCalledTimes(1);
  });

  it('POST /api/v1/properties/:id/photos — buyer_tenant recebe 403', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .attach('photos', Buffer.from('fake-image-content'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(403);

    expect(mockCloudinaryService.upload).not.toHaveBeenCalled();
  });

  it('POST /api/v1/properties/:id/photos — outro owner recebe 403', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .attach('photos', Buffer.from('fake-image-content'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(403);

    expect(mockCloudinaryService.upload).not.toHaveBeenCalled();
  });

  it('POST /api/v1/properties/:id/photos — tipo de arquivo inválido recebe 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('photos', Buffer.from('not-an-image'), { filename: 'file.txt', contentType: 'text/plain' })
      .expect(400);

    expect(mockCloudinaryService.upload).not.toHaveBeenCalled();
  });

  it('POST /api/v1/properties/:id/photos — excede o limite de 10 fotos recebe 400', async () => {
    const req = request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`);

    for (let i = 0; i < 10; i += 1) {
      req.attach('photos', Buffer.from(`fake-image-${i}`), { filename: `photo${i}.jpg`, contentType: 'image/jpeg' });
    }

    await req.expect(400);
    expect(mockCloudinaryService.upload).not.toHaveBeenCalled();
  });

  it('DELETE /api/v1/properties/:id/photos/:photoId — outro owner recebe 403', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('photos', Buffer.from('fake-image-content'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const photoId = uploadRes.body[0].id;

    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${propertyId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(403);

    expect(mockCloudinaryService.destroy).not.toHaveBeenCalled();
  });

  it('DELETE /api/v1/properties/:id/photos/:photoId — dono exclui com sucesso', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('photos', Buffer.from('fake-image-content'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const photoId = uploadRes.body[0].id;

    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${propertyId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    expect(mockCloudinaryService.destroy).toHaveBeenCalledWith('fake-public-id');

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/properties/${propertyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(detail.body.photos.find((p: { id: string }) => p.id === photoId)).toBeUndefined();
  });

  it('GET /api/v1/properties/:id — inclui as fotos do imóvel', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('photos', Buffer.from('fake-image-content'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/properties/${propertyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body.photos.length).toBeGreaterThanOrEqual(1);
    expect(res.body.photos[0]).toHaveProperty('id');
    expect(res.body.photos[0]).toHaveProperty('url');
  });
});
```

- [ ] **Step 15: Run the e2e tests to verify they pass**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d CLOUDINARY_CLOUD_NAME=test CLOUDINARY_API_KEY=test CLOUDINARY_API_SECRET=test NODE_ENV=test npx jest --config test/jest-e2e.json --no-coverage --forceExit
```

Note: `CLOUDINARY_*` env vars are passed here for safety (in case any other part of app bootstrap touches `ConfigService.getOrThrow` for them outside the overridden test), even though `CloudinaryService` itself is overridden and its real constructor never runs in this test file. Expected: PASS — `auth.e2e-spec.ts`, `property.e2e-spec.ts`, and the new `property-photo.e2e-spec.ts` all green.

- [ ] **Step 16: Commit**

```bash
git add backend/src/shared/cloudinary backend/src/modules/properties backend/test/property-photo.e2e-spec.ts backend/.env.example backend/package.json backend/package-lock.json
git commit -m "feat: add property photo upload via Cloudinary"
```

---

## Task 2: Mobile — install image deps, extend API client

**Files:**
- Modify: `mobile/package.json` (via `npx expo install`)
- Modify: `mobile/services/properties.ts`

**Interfaces:**
- Produces: `Property.photos: PropertyPhoto[]`, `PropertyPhoto {id, url}`, `propertyApi.uploadPhotos(id, photos): Promise<...>`, `propertyApi.deletePhoto(id, photoId): Promise<void>` — consumed by Tasks 3 and 4.

- [ ] **Step 1: Install the new mobile dependencies**

```bash
cd mobile
npx expo install expo-image-picker expo-image-manipulator
```

`expo install` (not `npm install`) resolves the versions compatible with the installed Expo SDK (~56), which is important since blindly installing "latest" would pull SDK 57-targeted versions.

- [ ] **Step 2: Extend the properties API client**

Modify `mobile/services/properties.ts` — full replacement:

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
  isActive: boolean;
  ownerId: string;
  createdAt: string;
  photos: PropertyPhoto[];
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

- [ ] **Step 3: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/services/properties.ts
git commit -m "feat: add image deps and photo upload/delete to properties API client"
```

---

## Task 3: Mobile — photo management screen

**Files:**
- Create: `mobile/app/property/photos.tsx`

**Interfaces:**
- Consumes: `propertyApi.getById`, `propertyApi.uploadPhotos`, `propertyApi.deletePhoto`, `PropertyPhoto` from Task 2.

- [ ] **Step 1: Verify the exact `expo-image-manipulator` API before writing code that uses it**

Per `mobile/AGENTS.md` and this plan's Global Constraints: documentation fetched while designing this plan gave **two different import styles** for the same context-based `manipulate()` API (`import * as ImageManipulator from 'expo-image-manipulator'` vs `import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'`). Before writing Step 2, resolve this by inspecting the actually-installed package (after Task 2's `npx expo install`):

```bash
cd mobile
cat node_modules/expo-image-manipulator/build/index.d.ts
```

Confirm: (a) whether `manipulate` is a named export or reached via a namespace/default import, (b) the exact name and shape of `SaveFormat`, (c) that `.resize({ width })`, `.renderAsync()`, and `.saveAsync({ format, compress })` exist with those names. Adjust Step 2's import line to match what you find — the rest of the call chain in Step 2 is written to match the plan author's best-verified understanding, but the import statement is the part most likely to need correcting against the real package.

- [ ] **Step 2: Create the photo management screen**

Create `mobile/app/property/photos.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Alert } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Button } from '../../components/ui/Button';
import { propertyApi, PropertyPhoto } from '../../services/properties';

const MAX_PHOTOS = 10;

export default function PropertyPhotosScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [photos, setPhotos] = useState<PropertyPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await propertyApi.getById(id);
      setPhotos(data.photos);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar as fotos');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleAddPhotos = async () => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      Alert.alert('Limite atingido', `Você já tem o máximo de ${MAX_PHOTOS} fotos.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permissão necessária', 'Autorize o acesso às fotos para adicionar imagens.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
    });
    if (result.canceled || !result.assets.length) return;

    setUploading(true);
    try {
      const compressed = await Promise.all(
        result.assets.map(async (asset) => {
          const context = ImageManipulator.manipulate(asset.uri);
          context.resize({ width: 1920 });
          const imageRef = await context.renderAsync();
          const saved = await imageRef.saveAsync({
            format: ImageManipulator.SaveFormat.JPEG,
            compress: 0.8,
          });
          return { uri: saved.uri, name: `${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`, type: 'image/jpeg' };
        }),
      );

      await propertyApi.uploadPhotos(id, compressed);
      await load();
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar as fotos');
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = (photoId: string) => {
    Alert.alert('Excluir foto', 'Tem certeza?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            await propertyApi.deletePhoto(id, photoId);
            setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
          } catch {
            Alert.alert('Erro', 'Não foi possível excluir a foto');
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fotos do anúncio</Text>
      <Text style={styles.subtitle}>{photos.length} de {MAX_PHOTOS} fotos</Text>
      <Button
        title={uploading ? 'Enviando...' : '+ Adicionar fotos'}
        onPress={handleAddPhotos}
        loading={uploading}
      />
      <FlatList
        data={photos}
        keyExtractor={(photo) => photo.id}
        numColumns={2}
        style={styles.list}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Nenhuma foto ainda</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.photoCard}>
            <Image source={{ uri: item.url }} style={styles.photo} />
            <TouchableOpacity style={styles.deleteBadge} onPress={() => handleDeletePhoto(item.id)}>
              <Text style={styles.deleteBadgeText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      <Button title="Concluído" variant="outline" onPress={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 16 },
  list: { marginTop: 16, flex: 1 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 32 },
  photoCard: { flex: 1, margin: 6, aspectRatio: 1, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  photo: { width: '100%', height: '100%' },
  deleteBadge: {
    position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
  },
  deleteBadgeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
```

- [ ] **Step 3: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors. If Step 1's investigation showed a different import shape than what Step 2 used, fix the import line now and re-run this check.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/property/photos.tsx"
git commit -m "feat: add property photo management screen"
```

---

## Task 4: Mobile — navigation wiring and cover photo/carousel display

**Files:**
- Modify: `mobile/app/property/form.tsx`
- Modify: `mobile/app/(tabs)/index.tsx`
- Modify: `mobile/app/(tabs)/my-listings.tsx`
- Modify: `mobile/app/property/[id].tsx`

**Interfaces:**
- Consumes: `Property.photos` from Task 2; the `/property/photos` route from Task 3.

- [ ] **Step 1: Navigate to the photos screen after creating a listing, and add a "Gerenciar fotos" button when editing**

Modify `mobile/app/property/form.tsx` — replace the `handleSubmit` function:

```ts
  const handleSubmit = async () => {
    setErrors({});

    if (!title || !description || !price || !street || !number || !neighborhood || !city || !state || !zipCode) {
      return;
    }

    const newErrors: Record<string, string> = {};

    if (title.length < 3) {
      newErrors.title = 'Título deve ter no mínimo 3 caracteres';
    }
    if (description.length < 10) {
      newErrors.description = 'Descrição deve ter no mínimo 10 caracteres';
    }
    const parsedPrice = Number(price);
    if (!price || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      newErrors.price = 'Preço inválido';
    }
    if (!/^\d{5}-?\d{3}$/.test(zipCode)) {
      newErrors.zipCode = 'CEP deve estar no formato 00000-000';
    }
    if (state.length !== 2) {
      newErrors.state = 'Estado deve ter 2 letras (UF)';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      if (isEditing && id) {
        await propertyApi.update(id, { ...buildPayload(), isActive });
        router.back();
      } else {
        const { data } = await propertyApi.create(buildPayload());
        router.replace({ pathname: '/property/photos', params: { id: data.id } });
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar o anúncio');
    } finally {
      setSaving(false);
    }
  };
```

Then add a "Gerenciar fotos" button — insert it between the "Salvar"/"Publicar" button and the delete button:

```tsx
      <Button title={isEditing ? 'Salvar' : 'Publicar'} onPress={handleSubmit} loading={saving} />

      {isEditing ? (
        <View style={styles.manageButtonWrapper}>
          <Button
            title="Gerenciar fotos"
            variant="outline"
            onPress={() => id && router.push({ pathname: '/property/photos', params: { id } })}
          />
        </View>
      ) : null}

      {isEditing ? (
        <View style={styles.deleteButtonWrapper}>
          <Button title="Excluir anúncio" variant="outline" onPress={handleDelete} />
        </View>
      ) : null}
```

And add the matching style — in the `StyleSheet.create({...})` block, add right after `deleteButtonWrapper`:

```ts
  deleteButtonWrapper: { marginTop: 4 },
  manageButtonWrapper: { marginTop: 4 },
```

(only `manageButtonWrapper` is new; `deleteButtonWrapper` already exists — this shows where to insert the new line relative to it)

- [ ] **Step 2: Show the cover photo on search result cards**

Modify `mobile/app/(tabs)/index.tsx`:

Add `Image` to the `react-native` import:

```ts
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Image } from 'react-native';
```

Then update the `renderItem` to show the cover photo when present:

```tsx
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: '/property/[id]', params: { id: item.id } })}
          >
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSub}>{item.city} • {TRANSACTION_LABEL[item.transactionType]}</Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price, item.transactionType)}</Text>
          </TouchableOpacity>
        )}
```

Add `cardImage` to the styles, right after `card`:

```ts
  card: {
    padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 12,
  },
  cardImage: { width: '100%', height: 140, borderRadius: 8, marginBottom: 8 },
```

- [ ] **Step 3: Show the cover photo on "Meus anúncios" cards**

Modify `mobile/app/(tabs)/my-listings.tsx`:

Add `Image` to the `react-native` import:

```ts
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Image } from 'react-native';
```

Then update the `renderItem` the same way:

```tsx
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.isActive && styles.cardInactive]}
            onPress={() => router.push({ pathname: '/property/form', params: { id: item.id } })}
          >
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
            {!item.isActive ? <Text style={styles.badge}>Inativo</Text> : null}
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSub}>{item.city} • {TRANSACTION_LABEL[item.transactionType]}</Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price, item.transactionType)}</Text>
          </TouchableOpacity>
        )}
```

Add `cardImage` to the styles, right after `card`:

```ts
  card: {
    padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 12,
  },
  cardImage: { width: '100%', height: 140, borderRadius: 8, marginBottom: 8 },
```

- [ ] **Step 4: Show a photo carousel on the detail screen**

Modify `mobile/app/property/[id].tsx`:

Add `Image` to the `react-native` import:

```ts
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
```

Insert the carousel right after the outer `<ScrollView contentContainerStyle={styles.container}>` opening tag, before the title:

```tsx
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {property.photos.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carousel}>
          {property.photos.map((photo) => (
            <Image key={photo.id} source={{ uri: photo.url }} style={styles.carouselImage} />
          ))}
        </ScrollView>
      ) : null}
      <Text style={styles.title}>{property.title}</Text>
```

Add `carousel`/`carouselImage` to the styles, right after `container`:

```ts
  container: { padding: 24, backgroundColor: '#fff' },
  carousel: { marginBottom: 16, marginHorizontal: -24 },
  carouselImage: { width: 280, height: 200, borderRadius: 12, marginLeft: 12 },
```

(`marginHorizontal: -24` cancels the outer `container`'s padding so the carousel can scroll edge-to-edge; `marginLeft` on each image gives consistent spacing including before the first image.)

- [ ] **Step 5: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/property/form.tsx" "mobile/app/(tabs)/index.tsx" "mobile/app/(tabs)/my-listings.tsx" "mobile/app/property/[id].tsx"
git commit -m "feat: wire photo navigation and display cover photo/carousel"
```

- [ ] **Step 7: Manual smoke test (recommended before pushing)**

Requires real Cloudinary credentials in `backend/.env` (the user needs to have created a Cloudinary account and provided `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` by this point), a running backend with Postgres, and the Expo dev server on a real device or emulator. Log in as an `owner`, create a new listing, confirm it navigates straight to the photo screen, add 2-3 photos (confirm they appear, confirm the "X of 10" counter updates), go back to "Meus anúncios" and confirm the cover photo shows on the card, open the listing's detail screen and confirm the carousel shows all photos, delete one photo and confirm it's gone, and confirm a `buyer_tenant` login cannot reach any of the photo-management UI (no "Meus anúncios" tab, and the API would 403 if reached directly).

---

## Final Step: Push and verify CI

After all 4 tasks are committed:

```bash
git push
```

Then check `https://github.com/celiooliveir/meu-imovel/actions` — `Backend — Unit + E2E` should run all three e2e spec files (including the new `property-photo.e2e-spec.ts`, with `CloudinaryService` mocked so no real Cloudinary account is needed for CI to pass), and `Mobile — TypeScript` should pass `tsc --noEmit`.
