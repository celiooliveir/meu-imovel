# Favoritos de Imóveis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any authenticated user favorite/unfavorite a property, see a dedicated "Favoritos" list, and see filled-heart indicators on search/detail/favorites cards.

**Architecture:** A new `PropertyFavorite` join entity (userId + propertyId, unique together) backs a small `PropertyFavoriteService`/`PropertyFavoriteController` pair, mirroring the existing photos module's structure. `GET /properties/favorites` (paginated, full property data) and `GET /properties/favorites/ids` (lightweight id list) live on the existing `PropertyController` — same fix as `/mine` needed for route ordering. Mobile keeps favorited ids in a small Zustand store (`useFavoritesStore`, same pattern as the existing `useAuthStore`) loaded once when the tabs layout mounts, so the heart state stays in sync across the search screen, detail screen, and the new Favoritos tab without each screen tracking its own copy.

**Tech Stack:** Same as the rest of the property module — NestJS 11, TypeORM 0.3 (backend); Expo Router ~56, Zustand (mobile). No new dependencies.

## Global Constraints

- No role restriction on favoriting — any authenticated user (`owner`, `broker`, `buyer_tenant`) can favorite any property, including their own.
- `POST /properties/:propertyId/favorite` and `DELETE /properties/:propertyId/favorite` are both idempotent and both return `204 No Content` — favoriting an already-favorited property (or unfavoriting one that isn't) is a no-op, not an error.
- `GET /properties/favorites` and `GET /properties/favorites/ids` must be declared on `PropertyController` **before** `@Get(':id')` — same route-ordering fix already applied for `/mine` (`GET /properties/favorites` would otherwise be swallowed by `:id` and rejected by `ParseUUIDPipe`).
- The favorites list does **not** filter by `isActive` — a favorited property that later goes inactive still appears (with the existing "Inativo" badge treatment already used in "Meus anúncios").
- No cascade cleanup when a property is deleted — an orphaned `PropertyFavorite` row for a soft-deleted property is harmless (the property already stops appearing anywhere reads are filtered), consistent with the same accepted trade-off already made for photos.
- Backend testing follows the established convention: unit tests mock repositories/services via `getRepositoryToken`/DI; e2e tests get their **own dedicated file** (`backend/test/property-favorite.e2e-spec.ts`, self-contained with its own users/property fixture in `beforeAll`), mirroring `property-photo.e2e-spec.ts` rather than growing the already-large `property.e2e-spec.ts`.
- Do not pass a `style` prop to `<Button>`/`<Input>` (both spread `{...props}` after their own internal `style` array, silently replacing it).
- Mobile has no test runner beyond `tsc --noEmit` — the only required gate for mobile tasks.

---

## Task 1: Backend — `PropertyFavorite` entity, service, controller

**Files:**
- Create: `backend/src/modules/properties/property-favorite.entity.ts`
- Create: `backend/src/modules/properties/property-favorite.service.ts`
- Create: `backend/src/modules/properties/property-favorite.controller.ts`
- Create: `backend/src/modules/properties/property-favorite.service.spec.ts`
- Create: `backend/test/property-favorite.e2e-spec.ts`
- Modify: `backend/src/modules/properties/property.controller.ts`
- Modify: `backend/src/modules/properties/property.module.ts`

**Interfaces:**
- Produces: `PropertyFavoriteService.add(propertyId, userId): Promise<void>`, `.remove(propertyId, userId): Promise<void>`, `.findFavorites(userId, page, limit): Promise<{items: Property[]; total; page; limit}>`, `.findFavoriteIds(userId): Promise<string[]>` — the last two consumed by `PropertyController`, not `PropertyFavoriteController`.

- [ ] **Step 1: Write the failing unit tests**

Create `backend/src/modules/properties/property-favorite.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertyFavoriteService } from './property-favorite.service';
import { PropertyFavorite } from './property-favorite.entity';
import { Property } from './property.entity';
import { PropertyService } from './property.service';

describe('PropertyFavoriteService', () => {
  let service: PropertyFavoriteService;

  const mockFavoriteRepo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    findAndCount: jest.fn(),
    find: jest.fn(),
  };

  const mockPropertyRepo = {
    find: jest.fn(),
  };

  const mockPropertyService = {
    findByIdOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PropertyFavoriteService,
        { provide: getRepositoryToken(PropertyFavorite), useValue: mockFavoriteRepo },
        { provide: getRepositoryToken(Property), useValue: mockPropertyRepo },
        { provide: PropertyService, useValue: mockPropertyService },
      ],
    }).compile();
    service = module.get(PropertyFavoriteService);
    jest.clearAllMocks();
  });

  describe('add', () => {
    it('should throw NotFoundException when the property does not exist', async () => {
      mockPropertyService.findByIdOrThrow.mockRejectedValue(new Error('not found'));

      await expect(service.add('prop-missing', 'user-1')).rejects.toThrow();
      expect(mockFavoriteRepo.create).not.toHaveBeenCalled();
    });

    it('should create a favorite when none exists yet', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1' } as Property);
      mockFavoriteRepo.findOneBy.mockResolvedValue(null);
      mockFavoriteRepo.create.mockReturnValue({ propertyId: 'prop-1', userId: 'user-1' });

      await service.add('prop-1', 'user-1');

      expect(mockFavoriteRepo.create).toHaveBeenCalledWith({ propertyId: 'prop-1', userId: 'user-1' });
      expect(mockFavoriteRepo.save).toHaveBeenCalled();
    });

    it('should be idempotent when the favorite already exists', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1' } as Property);
      mockFavoriteRepo.findOneBy.mockResolvedValue({ id: 'fav-1', propertyId: 'prop-1', userId: 'user-1' });

      await service.add('prop-1', 'user-1');

      expect(mockFavoriteRepo.create).not.toHaveBeenCalled();
      expect(mockFavoriteRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete the favorite by propertyId and userId', async () => {
      await service.remove('prop-1', 'user-1');
      expect(mockFavoriteRepo.delete).toHaveBeenCalledWith({ propertyId: 'prop-1', userId: 'user-1' });
    });
  });

  describe('findFavorites', () => {
    it('should return properties in favorited order with pagination metadata', async () => {
      mockFavoriteRepo.findAndCount.mockResolvedValue([
        [
          { propertyId: 'prop-2', userId: 'user-1' },
          { propertyId: 'prop-1', userId: 'user-1' },
        ],
        2,
      ]);
      mockPropertyRepo.find.mockResolvedValue([
        { id: 'prop-1' } as Property,
        { id: 'prop-2' } as Property,
      ]);

      const result = await service.findFavorites('user-1', 1, 20);

      expect(result.items.map((p) => p.id)).toEqual(['prop-2', 'prop-1']);
      expect(result).toEqual(expect.objectContaining({ total: 2, page: 1, limit: 20 }));
    });

    it('should return an empty result without querying properties when there are no favorites', async () => {
      mockFavoriteRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findFavorites('user-1', 1, 20);

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
      expect(mockPropertyRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('findFavoriteIds', () => {
    it('should return the property ids favorited by the user', async () => {
      mockFavoriteRepo.find.mockResolvedValue([
        { propertyId: 'prop-1' },
        { propertyId: 'prop-2' },
      ]);

      const result = await service.findFavoriteIds('user-1');

      expect(result).toEqual(['prop-1', 'prop-2']);
      expect(mockFavoriteRepo.find).toHaveBeenCalledWith({ where: { userId: 'user-1' }, select: ['propertyId'] });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend
npx jest --no-coverage property-favorite.service.spec.ts
```

Expected: FAIL — `Cannot find module './property-favorite.service'`.

- [ ] **Step 3: Create the `PropertyFavorite` entity**

Create `backend/src/modules/properties/property-favorite.entity.ts`:

```ts
import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';
import { Property } from './property.entity';
import { User } from '../users/user.entity';

@Entity('property_favorites')
@Index(['userId', 'propertyId'], { unique: true })
export class PropertyFavorite extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  propertyId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Property)
  @JoinColumn({ name: 'propertyId' })
  property: Property;
}
```

- [ ] **Step 4: Implement `PropertyFavoriteService`**

Create `backend/src/modules/properties/property-favorite.service.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend
npx jest --no-coverage property-favorite.service.spec.ts
```

Expected: PASS — 7 tests green.

- [ ] **Step 6: Create `PropertyFavoriteController`**

Create `backend/src/modules/properties/property-favorite.controller.ts`:

```ts
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
```

- [ ] **Step 7: Add `GET /properties/favorites` and `GET /properties/favorites/ids` to `PropertyController`**

Modify `backend/src/modules/properties/property.controller.ts` — inject `PropertyFavoriteService` and add the two new handlers **before** `@Get(':id')`. Full file:

```ts
import {
  Controller, Post, Get, Patch, Delete, Param, Query, Body,
  UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { PropertyService } from './property.service';
import { PropertyFavoriteService } from './property-favorite.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyResponseDto } from './dto/property-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@Controller('properties')
export class PropertyController {
  constructor(
    private readonly propertyService: PropertyService,
    private readonly favoriteService: PropertyFavoriteService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  async create(@Body() dto: CreatePropertyDto, @CurrentUser() user: { id: string }) {
    const property = await this.propertyService.create(dto, user.id);
    return PropertyResponseDto.fromEntity(property);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async search(@Query() query: SearchPropertyQueryDto) {
    const { items, total, page, limit } = await this.propertyService.search(query);
    return { items: items.map(PropertyResponseDto.fromEntity), total, page, limit };
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  async findMine(@Query() query: SearchPropertyQueryDto, @CurrentUser() user: { id: string }) {
    const { items, total, page, limit } = await this.propertyService.findMine(
      user.id,
      query.page ?? 1,
      query.limit ?? 20,
    );
    return { items: items.map(PropertyResponseDto.fromEntity), total, page, limit };
  }

  @Get('favorites')
  @UseGuards(JwtAuthGuard)
  async findFavorites(@Query() query: SearchPropertyQueryDto, @CurrentUser() user: { id: string }) {
    const { items, total, page, limit } = await this.favoriteService.findFavorites(
      user.id,
      query.page ?? 1,
      query.limit ?? 20,
    );
    return { items: items.map(PropertyResponseDto.fromEntity), total, page, limit };
  }

  @Get('favorites/ids')
  @UseGuards(JwtAuthGuard)
  async findFavoriteIds(@CurrentUser() user: { id: string }) {
    return this.favoriteService.findFavoriteIds(user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const property = await this.propertyService.findByIdOrThrow(id);
    return PropertyResponseDto.fromEntity(property);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePropertyDto,
    @CurrentUser() user: { id: string },
  ) {
    const property = await this.propertyService.update(id, user.id, dto);
    return PropertyResponseDto.fromEntity(property);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: { id: string }) {
    await this.propertyService.remove(id, user.id);
  }
}
```

Note: `favorites/ids` must be declared **after** `favorites` in the file (it is above) — this is fine either way since `Get('favorites')` and `Get('favorites/ids')` are distinct literal paths with no param ambiguity between them, but both must come before `Get(':id')`.

- [ ] **Step 8: Wire everything into `PropertyModule`**

Modify `backend/src/modules/properties/property.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from './property.entity';
import { PropertyPhoto } from './property-photo.entity';
import { PropertyFavorite } from './property-favorite.entity';
import { PropertyService } from './property.service';
import { PropertyController } from './property.controller';
import { PropertyPhotoService } from './property-photo.service';
import { PropertyPhotoController } from './property-photo.controller';
import { PropertyFavoriteService } from './property-favorite.service';
import { PropertyFavoriteController } from './property-favorite.controller';
import { CloudinaryModule } from '../../shared/cloudinary/cloudinary.module';
import { GeocodingModule } from '../../shared/geocoding/geocoding.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Property, PropertyPhoto, PropertyFavorite]),
    CloudinaryModule,
    GeocodingModule,
  ],
  providers: [PropertyService, PropertyPhotoService, PropertyFavoriteService],
  controllers: [PropertyController, PropertyPhotoController, PropertyFavoriteController],
})
export class PropertyModule {}
```

- [ ] **Step 9: Run `tsc` to catch compile issues (can't execute e2e without a DB)**

```bash
cd backend
npx tsc --noEmit -p tsconfig.spec.json
```

Expected: fails right now, because Step 10 hasn't created the e2e test file yet — that's fine, do Step 10 next, then re-run this.

- [ ] **Step 10: Write the e2e tests**

Create `backend/test/property-favorite.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

describe('Property Favorites (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let tenantToken: string;
  let propertyId: string;

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
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const ownerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Ana Owner', email: 'ana.owner@teste.com', password: 'senha1234', role: 'owner' });
    ownerToken = ownerRes.body.accessToken;

    const tenantRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Bruno Tenant', email: 'bruno.tenant@teste.com', password: 'senha1234', role: 'buyer_tenant' });
    tenantToken = tenantRes.body.accessToken;

    const propertyRes = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Cobertura com terraço gourmet',
        description: 'Cobertura ampla com terraço gourmet e vista panorâmica da cidade.',
        type: 'apartment',
        transactionType: 'sale',
        price: 750000,
        street: 'Rua das Orquídeas',
        number: '88',
        neighborhood: 'Batel',
        city: 'Curitiba',
        state: 'PR',
        zipCode: '80420-000',
      });
    propertyId = propertyRes.body.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('POST /api/v1/properties/:id/favorite — sem token recebe 401', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/favorite`)
      .expect(401);
  });

  it('POST /api/v1/properties/:id/favorite — favorita e retorna 204', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/favorite`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(204);

    const res = await request(app.getHttpServer())
      .get('/api/v1/properties/favorites/ids')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    expect(res.body).toEqual([propertyId]);
  });

  it('POST /api/v1/properties/:id/favorite — favoritar de novo é idempotente', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/favorite`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(204);

    const res = await request(app.getHttpServer())
      .get('/api/v1/properties/favorites')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('GET /api/v1/properties/favorites — retorna o imóvel favoritado com dados completos', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties/favorites')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    expect(res.body.items[0].id).toBe(propertyId);
    expect(res.body.items[0].title).toBe('Cobertura com terraço gourmet');
  });

  it('GET /api/v1/properties/favorites — não retorna favoritos de outro usuário', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties/favorites')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('DELETE /api/v1/properties/:id/favorite — desfavorita e retorna 204', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${propertyId}/favorite`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(204);

    const res = await request(app.getHttpServer())
      .get('/api/v1/properties/favorites/ids')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('DELETE /api/v1/properties/:id/favorite — desfavoritar sem estar favoritado é idempotente', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${propertyId}/favorite`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(204);
  });

  it('POST /api/v1/properties/:id/favorite — id de imóvel inexistente recebe 404', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/properties/00000000-0000-0000-0000-000000000000/favorite')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(404);
  });
});
```

- [ ] **Step 11: Run `tsc` again to confirm everything compiles**

```bash
cd backend
npx tsc --noEmit -p tsconfig.spec.json
```

Expected: no errors.

- [ ] **Step 12: Run the e2e tests to verify they pass**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test CLOUDINARY_CLOUD_NAME=test CLOUDINARY_API_KEY=test CLOUDINARY_API_SECRET=test NODE_OPTIONS=--experimental-vm-modules npx jest --config test/jest-e2e.json --no-coverage --forceExit -t "Property Favorites"
```

Expected: PASS — 9 tests green.

- [ ] **Step 13: Run the full backend suite to check for regressions**

```bash
cd backend
npx jest --no-coverage
```

Expected: PASS — all suites green, including `property.service.spec.ts` (the `PropertyController` constructor now takes a second argument — if any unit test directly instantiates `PropertyController`, it isn't affected here since only `property.service.spec.ts` tests `PropertyService` directly, not the controller).

- [ ] **Step 14: Commit**

```bash
git add backend/src/modules/properties/property-favorite.entity.ts backend/src/modules/properties/property-favorite.service.ts backend/src/modules/properties/property-favorite.controller.ts backend/src/modules/properties/property-favorite.service.spec.ts backend/src/modules/properties/property.controller.ts backend/src/modules/properties/property.module.ts backend/test/property-favorite.e2e-spec.ts
git commit -m "feat: add property favorites"
```

---

## Task 2: Mobile — extend `services/properties.ts` + `favorites.store.ts`

**Files:**
- Modify: `mobile/services/properties.ts`
- Create: `mobile/stores/favorites.store.ts`

**Interfaces:**
- Produces: `propertyApi.favorite(id)`, `.unfavorite(id)`, `.getFavorites(page?)`, `.getFavoriteIds()`; `useFavoritesStore` with `{ ids: Set<string>; loaded: boolean; load(): Promise<void>; toggle(propertyId: string): Promise<void> }` — consumed by Tasks 3 and 4.

- [ ] **Step 1: Add favorites methods to the properties API client**

Modify `mobile/services/properties.ts` — add these four methods to the `propertyApi` object, after `deletePhoto`:

```ts
  favorite: (id: string) => api.post(`/properties/${id}/favorite`),

  unfavorite: (id: string) => api.delete(`/properties/${id}/favorite`),

  getFavorites: (page?: number) =>
    api.get<PropertySearchResult>('/properties/favorites', { params: { page } }),

  getFavoriteIds: () => api.get<string[]>('/properties/favorites/ids'),
```

- [ ] **Step 2: Create the favorites store**

Create `mobile/stores/favorites.store.ts`:

```ts
import { create } from 'zustand';
import { Alert } from 'react-native';
import { propertyApi } from '../services/properties';

interface FavoritesState {
  ids: Set<string>;
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (propertyId: string) => Promise<void>;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  ids: new Set(),
  loaded: false,

  load: async () => {
    try {
      const { data } = await propertyApi.getFavoriteIds();
      set({ ids: new Set(data), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  toggle: async (propertyId: string) => {
    const wasFavorited = get().ids.has(propertyId);
    const optimisticIds = new Set(get().ids);
    if (wasFavorited) optimisticIds.delete(propertyId);
    else optimisticIds.add(propertyId);
    set({ ids: optimisticIds });

    try {
      if (wasFavorited) {
        await propertyApi.unfavorite(propertyId);
      } else {
        await propertyApi.favorite(propertyId);
      }
    } catch {
      const revertedIds = new Set(get().ids);
      if (wasFavorited) revertedIds.add(propertyId);
      else revertedIds.delete(propertyId);
      set({ ids: revertedIds });
      Alert.alert('Erro', 'Não foi possível atualizar o favorito');
    }
  },
}));
```

- [ ] **Step 3: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/services/properties.ts mobile/stores/favorites.store.ts
git commit -m "feat: add favorites API client methods and store"
```

---

## Task 3: Mobile — "Favoritos" tab

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/favorites.tsx`

**Interfaces:**
- Consumes: `propertyApi.getFavorites`, `useFavoritesStore` from Task 2.

- [ ] **Step 1: Add the tab and load favorites once when the tabs layout mounts**

Overwrite `mobile/app/(tabs)/_layout.tsx`:

```tsx
import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { useAuthStore } from '../../stores/auth.store';
import { useFavoritesStore } from '../../stores/favorites.store';

export default function TabsLayout() {
  const role = useAuthStore((s) => s.user?.role);
  const canManageListings = role === 'owner' || role === 'broker';
  const loadFavorites = useFavoritesStore((s) => s.load);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#1a56db' }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen name="favorites" options={{ title: 'Favoritos' }} />
      <Tabs.Screen
        name="my-listings"
        options={{ title: 'Meus anúncios', href: canManageListings ? undefined : null }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 2: Create the Favoritos screen**

Create `mobile/app/(tabs)/favorites.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Image } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { propertyApi, Property } from '../../services/properties';
import { useFavoritesStore } from '../../stores/favorites.store';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };

function formatPrice(price: number, transactionType: string) {
  const value = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return transactionType === 'rent' ? `${value}/mês` : value;
}

export default function FavoritesScreen() {
  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const requestIdRef = useRef(0);
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  const load = useCallback(async (targetPage: number, replace: boolean) => {
    const requestId = ++requestIdRef.current;
    if (replace) setLoading(true);
    else setLoadingMore(true);
    try {
      const { data } = await propertyApi.getFavorites(targetPage);
      if (requestId !== requestIdRef.current) return;
      setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
      setPage(data.page);
      setHasMore(data.page * data.limit < data.total);
    } catch {
      if (requestId === requestIdRef.current) {
        Alert.alert('Erro', 'Não foi possível carregar seus favoritos');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    setHasMore(true);
    load(1, true);
  }, [load]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    load(page + 1, false);
  }, [loading, loadingMore, hasMore, page, load]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const handleRemove = (propertyId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== propertyId));
    toggleFavorite(propertyId);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Favoritos</Text>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.list}
        onRefresh={refresh}
        refreshing={loading}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Você ainda não tem favoritos</Text> : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerLoader} color="#1a56db" /> : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.isActive && styles.cardInactive]}
            onPress={() => router.push({ pathname: '/property/[id]', params: { id: item.id } })}
          >
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
            <TouchableOpacity style={styles.heartButton} onPress={() => handleRemove(item.id)}>
              <Text style={styles.heartIcon}>♥</Text>
            </TouchableOpacity>
            {!item.isActive ? <Text style={styles.badge}>Inativo</Text> : null}
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSub}>{item.city} • {TRANSACTION_LABEL[item.transactionType]}</Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price, item.transactionType)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  list: { marginTop: 16 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 32 },
  footerLoader: { marginVertical: 16 },
  card: {
    padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 12,
  },
  cardImage: { width: '100%', height: 140, borderRadius: 8, marginBottom: 8 },
  cardInactive: { opacity: 0.6 },
  heartButton: {
    position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center',
  },
  heartIcon: { fontSize: 18, color: '#ef4444' },
  badge: {
    alignSelf: 'flex-start', backgroundColor: '#fee2e2', color: '#b91c1c',
    fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginBottom: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '700', color: '#1a56db', marginTop: 8 },
});
```

- [ ] **Step 3: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(tabs)/_layout.tsx" "mobile/app/(tabs)/favorites.tsx"
git commit -m "feat: add Favoritos tab"
```

---

## Task 4: Mobile — heart toggle on search and detail screens

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`
- Modify: `mobile/app/property/[id].tsx`

**Interfaces:**
- Consumes: `useFavoritesStore` from Task 2.

- [ ] **Step 1: Add the heart toggle to search result cards**

Modify `mobile/app/(tabs)/index.tsx` — add the `useFavoritesStore` import and two hook calls near the top of the component, and the heart button inside `renderItem`, plus the two new style entries. Full file:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Image } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../stores/auth.store';
import { useFavoritesStore } from '../../stores/favorites.store';
import { propertyApi, Property } from '../../services/properties';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };
const RADIUS_OPTIONS = [5, 10, 20];

function formatPrice(price: number, transactionType: string) {
  const value = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return transactionType === 'rent' ? `${value}/mês` : value;
}

export default function SearchScreen() {
  const user = useAuthStore((s) => s.user);
  const favoriteIds = useFavoritesStore((s) => s.ids);
  const toggleFavorite = useFavoritesStore((s) => s.toggle);
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
    try {
      const position = await Location.getCurrentPositionAsync({});
      setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
      setNearMe(true);
    } catch {
      Alert.alert('Erro', 'Não foi possível obter sua localização');
    }
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
            <TouchableOpacity style={styles.heartButton} onPress={() => toggleFavorite(item.id)}>
              <Text style={styles.heartIcon}>{favoriteIds.has(item.id) ? '♥' : '♡'}</Text>
            </TouchableOpacity>
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
  heartButton: {
    position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center',
  },
  heartIcon: { fontSize: 18, color: '#ef4444' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '700', color: '#1a56db', marginTop: 8 },
});
```

- [ ] **Step 2: Add the heart toggle to the detail screen**

Modify `mobile/app/property/[id].tsx` — add the `useFavoritesStore` import/hooks and a favorite button between the price/badge block and the "Endereço" section, plus one new style entry. Full file:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Image, TouchableOpacity } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { propertyApi, Property } from '../../services/properties';
import { useFavoritesStore } from '../../stores/favorites.store';

const TYPE_LABEL: Record<string, string> = {
  apartment: 'Apartamento', house: 'Casa', commercial: 'Comercial', land: 'Terreno',
};
const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };

function formatPrice(price: number, transactionType: string) {
  const value = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return transactionType === 'rent' ? `${value}/mês` : value;
}

export default function PropertyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const favoriteIds = useFavoritesStore((s) => s.ids);
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  useEffect(() => {
    propertyApi
      .getById(id)
      .then(({ data }) => setProperty(data))
      .catch(() => Alert.alert('Erro', 'Não foi possível carregar o imóvel'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#1a56db" />
      </View>
    );
  }

  if (!property) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Imóvel não encontrado</Text>
      </View>
    );
  }

  const isFavorited = favoriteIds.has(property.id);

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
      <Text style={styles.price}>{formatPrice(property.price, property.transactionType)}</Text>
      <Text style={styles.badge}>
        {TYPE_LABEL[property.type]} • {TRANSACTION_LABEL[property.transactionType]}
      </Text>
      <TouchableOpacity style={styles.favoriteButton} onPress={() => toggleFavorite(property.id)}>
        <Text style={styles.favoriteButtonText}>
          {isFavorited ? '♥ Favoritado' : '♡ Favoritar'}
        </Text>
      </TouchableOpacity>
      <Text style={styles.section}>Endereço</Text>
      <Text style={styles.text}>
        {property.street}, {property.number} — {property.neighborhood}{'\n'}
        {property.city}/{property.state} — {property.zipCode}
      </Text>
      <Text style={styles.section}>Detalhes</Text>
      <Text style={styles.text}>
        {property.bedrooms !== null ? `${property.bedrooms} quarto(s) • ` : ''}
        {property.bathrooms !== null ? `${property.bathrooms} banheiro(s) • ` : ''}
        {property.areaM2 !== null ? `${property.areaM2} m²` : ''}
      </Text>
      <Text style={styles.section}>Descrição</Text>
      <Text style={styles.text}>{property.description}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff' },
  carousel: { marginBottom: 16, marginHorizontal: -24 },
  carouselImage: { width: 280, height: 200, borderRadius: 12, marginLeft: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  empty: { color: '#6b7280', fontSize: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  price: { fontSize: 20, fontWeight: '700', color: '#1a56db', marginTop: 8 },
  badge: { fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 16 },
  favoriteButton: {
    alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#ef4444', marginBottom: 8,
  },
  favoriteButtonText: { fontSize: 14, fontWeight: '600', color: '#ef4444' },
  section: { fontSize: 14, fontWeight: '700', color: '#374151', marginTop: 16, marginBottom: 4 },
  text: { fontSize: 15, color: '#111827', lineHeight: 22 },
});
```

- [ ] **Step 3: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(tabs)/index.tsx" "mobile/app/property/[id].tsx"
git commit -m "feat: add heart toggle to search results and detail screen"
```

- [ ] **Step 5: Manual smoke test (recommended before pushing)**

Run the backend against a local Postgres and the Expo dev server. Log in, favorite a property from the search screen (heart fills in), open the detail screen and confirm the favorite button shows "Favoritado", open the Favoritos tab and confirm the property appears, tap its heart to remove it and confirm it disappears from the list and the search screen's heart un-fills on next visit, log in as a different user and confirm they don't see the first user's favorites.

---

## Final Step: Push and verify CI

After all 4 tasks are committed:

```bash
git push
```

Then check `https://github.com/celiooliveir/meu-imovel/actions` — `Backend — Unit + E2E` should run the new `property-favorite.e2e-spec.ts` against a real Postgres, and `Mobile — TypeScript` should pass `tsc --noEmit`.
