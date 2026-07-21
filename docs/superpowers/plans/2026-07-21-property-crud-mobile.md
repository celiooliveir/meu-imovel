# Cadastro/Edição de Imóveis no Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `owner`/`broker` users create, edit, and delete their own property listings from the mobile app (today only possible via direct API calls), with a dedicated "Meus anúncios" tab and CEP-based address autofill.

**Architecture:** One new backend endpoint (`GET /properties/mine`) reusing the existing `PropertyService`/`PropertyController`/guards from the property module. Three new/modified mobile pieces: the API client gains `create`/`update`/`remove`/`getMine`, a new tab lists the user's own listings (active and inactive), and a single form screen handles both create and edit, with CEP autofill via the public ViaCEP API.

**Tech Stack:** Same as the existing property module — NestJS 11, TypeORM 0.3, class-validator (backend); Expo Router ~56, React Native, axios (mobile). No new dependencies.

## Global Constraints

- `GET /properties/mine` sits behind `JwtAuthGuard` + `RolesGuard` with `@Roles(UserRole.OWNER, UserRole.BROKER)` — same authorization as `POST /properties`.
- `ownerId` for `/properties/mine` comes from `@CurrentUser().id` (the JWT), never from a query parameter — a user must never be able to list another user's properties.
- `/properties/mine` returns **both active and inactive** listings (no `isActive` filter) — it's a management view, not the public search. Soft-deleted properties are still excluded automatically (TypeORM's default behavior with `@DeleteDateColumn`).
- **Route order matters:** `GET('mine')` must be declared before `GET(':id')` in `PropertyController`, or Nest matches `/properties/mine` against the `:id` route and `ParseUUIDPipe` rejects it with 400.
- No new mobile dependencies — CEP lookup uses a plain `fetch` call to `https://viacep.com.br/ws/{cep}/json/`, no library.
- No new Zustand store — form state is local to `app/property/form.tsx`.
- Reuse the `Input`/`Button` components from `components/ui/` as-is. **Do not pass a `style` prop to `<Button>` or `<Input>`** — both spread `{...props}` after their own internal `style` array in JSX, so a caller-supplied `style` prop silently replaces (not merges with) the component's built-in styling (color, padding, variant). Control layout spacing with a wrapping `<View>` instead.
- Follow the existing card-selection UI pattern from `app/(auth)/profile-select.tsx` for the `type`/`transactionType` pickers — there is no dropdown component in this app; don't introduce one for a single use site.
- Backend testing follows the same two-level convention as the rest of the module: unit tests mock the repository via `getRepositoryToken(Property)` (`property.service.spec.ts`), e2e tests extend `test/property.e2e-spec.ts`.
- **Sandbox note for whoever implements this:** if there is no local Postgres/Docker available, e2e tests cannot be executed (they need a live DB to boot the app) — write them carefully, self-review by comparing against the already-passing tests in the same file, and rely on unit tests + `tsc --noEmit` as the runnable local gate. Full e2e validation happens via CI after push.

---

## Task 1: Backend `GET /properties/mine`

**Files:**
- Modify: `backend/src/modules/properties/property.service.ts`
- Modify: `backend/src/modules/properties/property.service.spec.ts`
- Modify: `backend/src/modules/properties/property.controller.ts`
- Modify: `backend/test/property.e2e-spec.ts`

**Interfaces:**
- Consumes: `Property` entity, `PropertyResponseDto.fromEntity`, `SearchPropertyQueryDto` (reused for its `page`/`limit` fields only), `RolesGuard`/`Roles`/`CurrentUser` — all existing, unmodified.
- Produces: `PropertyService.findMine(ownerId: string, page: number, limit: number): Promise<{ items: Property[]; total: number; page: number; limit: number }>` — consumed only by the controller in this task; Task 2 (mobile) consumes the HTTP response shape, not this method directly.

- [ ] **Step 1: Write the failing e2e tests**

Modify `backend/test/property.e2e-spec.ts`:

1. Add `inactivePropertyId` to the `let` declarations block at the top of the `describe`:

```ts
  let spFlatId: string;
  let spHouseId: string;
  let rioFlatId: string;
  let curitibaLandId: string;
  let mutableId: string;
  let inactivePropertyId: string;
```

2. Right after the `mutableId = mutableProperty.body.id;` line inside `beforeAll` (before the closing `});` of `beforeAll`), add a fixture that is created then immediately deactivated:

```ts

    const inactiveProperty = await createAsOwner({
      title: 'Sala comercial fechada temporariamente',
      description: 'Sala comercial atualmente fora do mercado, aguardando reforma.',
      type: 'commercial',
      transactionType: 'rent',
      price: 3000,
      street: 'Rua Sete de Setembro',
      number: '45',
      neighborhood: 'Centro',
      city: 'Porto Alegre',
      state: 'RS',
      zipCode: '90010-000',
    });
    inactivePropertyId = inactiveProperty.body.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/properties/${inactivePropertyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false });
```

3. Add these `it` blocks right after the `it('GET /api/v1/properties/:id — 400 para id malformado', ...)` block and before the `it('PATCH /api/v1/properties/:id — dono edita com sucesso', ...)` block:

```ts

  it('GET /api/v1/properties/mine — retorna os imóveis do dono autenticado, incluindo inativos', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties/mine')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([spFlatId, spHouseId, rioFlatId, curitibaLandId, inactivePropertyId]),
    );
  });

  it('GET /api/v1/properties/mine — não retorna imóveis de outro usuário', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties/mine')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(spFlatId);
    expect(ids).not.toContain(inactivePropertyId);
  });

  it('GET /api/v1/properties/mine — buyer_tenant recebe 403', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/properties/mine')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(403);
  });

  it('GET /api/v1/properties/mine — sem token recebe 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/properties/mine').expect(401);
  });
```

- [ ] **Step 2: Run the e2e tests to verify the new ones fail**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test npx jest --config test/jest-e2e.json --no-coverage --forceExit -t "Properties"
```

Expected: the existing tests still PASS; the 4 new `/properties/mine` tests FAIL (404 — route doesn't exist yet).

- [ ] **Step 3: Add `findMine` to the service**

Modify `backend/src/modules/properties/property.service.ts` — add the method at the end of the class:

```ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Property } from './property.entity';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@Injectable()
export class PropertyService {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
  ) {}

  async create(dto: CreatePropertyDto, ownerId: string): Promise<Property> {
    const property = this.propertyRepo.create({ ...dto, ownerId });
    return this.propertyRepo.save(property);
  }

  async findByIdOrThrow(id: string): Promise<Property> {
    const property = await this.propertyRepo.findOneBy({ id });
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
}
```

- [ ] **Step 4: Add the `GET /properties/mine` route to the controller**

Modify `backend/src/modules/properties/property.controller.ts` — add the `findMine` handler **before** `findOne` (route order matters, see Global Constraints):

```ts
import {
  Controller, Post, Get, Patch, Delete, Param, Query, Body,
  UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { PropertyService } from './property.service';
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
  constructor(private readonly propertyService: PropertyService) {}

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

- [ ] **Step 5: Add the `findMine` unit test**

Modify `backend/src/modules/properties/property.service.spec.ts` — add `findAndCount` to `mockRepo` and add a `describe('findMine', ...)` block after `describe('search', ...)`:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PropertyService } from './property.service';
import { Property, PropertyType, TransactionType } from './property.entity';
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
    findOneBy: jest.fn(),
    findAndCount: jest.fn(),
    softRemove: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PropertyService,
        { provide: getRepositoryToken(Property), useValue: mockRepo },
      ],
    }).compile();
    service = module.get(PropertyService);
    jest.clearAllMocks();
    Object.values(mockQueryBuilder).forEach((fn) => {
      if (fn !== mockQueryBuilder.getManyAndCount) fn.mockReturnThis();
    });
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
    it('should return the property when found', async () => {
      mockRepo.findOneBy.mockResolvedValue({ id: 'prop-1' } as Property);
      const result = await service.findByIdOrThrow('prop-1');
      expect(result.id).toBe('prop-1');
    });

    it('should throw NotFoundException when not found', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);
      await expect(service.findByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('search', () => {
    it('should apply filters and return paginated results', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[{ id: 'prop-1' } as Property], 1]);

      const query: SearchPropertyQueryDto = { city: 'São Paulo', page: 2, limit: 10 };
      const result = await service.search(query);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('property.city ILIKE :city', { city: 'São Paulo' });
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result).toEqual({ items: [{ id: 'prop-1' }], total: 1, page: 2, limit: 10 });
    });

    it('should default to page 1 and limit 20 when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.search({});

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
    });
  });

  describe('findMine', () => {
    it('should return paginated properties owned by the given user', async () => {
      mockRepo.findAndCount.mockResolvedValue([[{ id: 'prop-1', ownerId: 'owner-1' } as Property], 1]);

      const result = await service.findMine('owner-1', 1, 20);

      expect(mockRepo.findAndCount).toHaveBeenCalledWith({
        where: { ownerId: 'owner-1' },
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({ items: [{ id: 'prop-1', ownerId: 'owner-1' }], total: 1, page: 1, limit: 20 });
    });

    it('should compute skip from page and limit', async () => {
      mockRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findMine('owner-1', 3, 10);

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('update', () => {
    it('should update and save when the requester owns the property', async () => {
      const existing = { id: 'prop-1', ownerId: 'owner-1', price: 100 } as Property;
      mockRepo.findOneBy.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.update('prop-1', 'owner-1', { price: 200 });

      expect(result.price).toBe(200);
      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'prop-1', price: 200 }));
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockRepo.findOneBy.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.update('prop-1', 'owner-2', { price: 200 })).rejects.toThrow(ForbiddenException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft-remove when the requester owns the property', async () => {
      const existing = { id: 'prop-1', ownerId: 'owner-1' } as Property;
      mockRepo.findOneBy.mockResolvedValue(existing);
      mockRepo.softRemove.mockResolvedValue(existing);

      await service.remove('prop-1', 'owner-1');

      expect(mockRepo.softRemove).toHaveBeenCalledWith(existing);
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockRepo.findOneBy.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.remove('prop-1', 'owner-2')).rejects.toThrow(ForbiddenException);
      expect(mockRepo.softRemove).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 6: Run the unit tests to verify they pass**

```bash
cd backend
npx jest --no-coverage property.service.spec.ts
```

Expected: PASS — 11 tests green (1 create + 2 findByIdOrThrow + 2 search + 2 findMine + 2 update + 2 remove).

- [ ] **Step 7: Run the e2e tests to verify they pass**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test npx jest --config test/jest-e2e.json --no-coverage --forceExit -t "Properties"
```

Expected: PASS — all tests green, including the 4 new `/properties/mine` cases.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/properties/property.service.ts backend/src/modules/properties/property.service.spec.ts backend/src/modules/properties/property.controller.ts backend/test/property.e2e-spec.ts
git commit -m "feat: add GET /properties/mine endpoint"
```

---

## Task 2: Mobile — extend `services/properties.ts`

**Files:**
- Modify: `mobile/services/properties.ts`

**Interfaces:**
- Produces: `PropertyInput` type, `UpdatePropertyInput` type, `propertyApi.getMine(page?)`, `propertyApi.create(dto)`, `propertyApi.update(id, dto)`, `propertyApi.remove(id)` — consumed by Tasks 3 and 4.

- [ ] **Step 1: Extend the properties API client**

Overwrite `mobile/services/properties.ts` with the full file:

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

export const propertyApi = {
  search: (filters: PropertySearchFilters = {}) =>
    api.get<PropertySearchResult>('/properties', { params: filters }),

  getById: (id: string) => api.get<Property>(`/properties/${id}`),

  getMine: (page?: number) =>
    api.get<PropertySearchResult>('/properties/mine', { params: { page } }),

  create: (dto: PropertyInput) => api.post<Property>('/properties', dto),

  update: (id: string, dto: UpdatePropertyInput) => api.patch<Property>(`/properties/${id}`, dto),

  remove: (id: string) => api.delete(`/properties/${id}`),
};
```

- [ ] **Step 2: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/services/properties.ts
git commit -m "feat: add create/update/remove/getMine to properties API client"
```

---

## Task 3: Mobile — "Meus anúncios" tab

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/my-listings.tsx`

**Interfaces:**
- Consumes: `propertyApi.getMine`, `Property` from Task 2's `services/properties.ts`.
- Produces: navigation to `/property/form` (with or without an `id` param) — the destination screen is built in Task 4; this task only needs the route string to exist as a valid path, which `tsc` does not type-check since typed routes are not enabled in this project (`mobile/app.json` has no `experiments.typedRoutes`).

- [ ] **Step 1: Add the conditional tab**

Overwrite `mobile/app/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from 'expo-router';
import { useAuthStore } from '../../stores/auth.store';

export default function TabsLayout() {
  const role = useAuthStore((s) => s.user?.role);
  const canManageListings = role === 'owner' || role === 'broker';

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#1a56db' }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen
        name="my-listings"
        options={{ title: 'Meus anúncios', href: canManageListings ? undefined : null }}
      />
    </Tabs>
  );
}
```

`href: null` hides the tab from the bar (and from direct navigation) for `buyer_tenant` without unregistering the route — the standard Expo Router pattern for conditionally-visible tabs.

- [ ] **Step 2: Create the "Meus anúncios" screen**

Create `mobile/app/(tabs)/my-listings.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { propertyApi, Property } from '../../services/properties';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };

function formatPrice(price: number, transactionType: string) {
  const value = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return transactionType === 'rent' ? `${value}/mês` : value;
}

export default function MyListingsScreen() {
  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await propertyApi.getMine();
      setItems(data.items);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar seus anúncios');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Meus anúncios</Text>
      <Button title="+ Novo anúncio" onPress={() => router.push('/property/form')} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.list}
        onRefresh={load}
        refreshing={loading}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Você ainda não tem anúncios</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.isActive && styles.cardInactive]}
            onPress={() => router.push({ pathname: '/property/form', params: { id: item.id } })}
          >
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
  card: {
    padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 12,
  },
  cardInactive: { opacity: 0.6 },
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
git add "mobile/app/(tabs)/_layout.tsx" "mobile/app/(tabs)/my-listings.tsx"
git commit -m "feat: add Meus anúncios tab for owner/broker"
```

---

## Task 4: Mobile — property create/edit form with CEP autofill

**Files:**
- Create: `mobile/app/property/form.tsx`

**Interfaces:**
- Consumes: `propertyApi.create`, `propertyApi.update`, `propertyApi.remove`, `propertyApi.getById`, `PropertyInput`, `UpdatePropertyInput`, `PropertyType`, `TransactionType` from Task 2's `services/properties.ts`.

- [ ] **Step 1: Create the form screen**

Create `mobile/app/property/form.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { propertyApi, PropertyType, TransactionType } from '../../services/properties';

const TYPE_OPTIONS = [
  { key: PropertyType.APARTMENT, label: 'Apartamento' },
  { key: PropertyType.HOUSE, label: 'Casa' },
  { key: PropertyType.COMMERCIAL, label: 'Comercial' },
  { key: PropertyType.LAND, label: 'Terreno' },
];

const TRANSACTION_OPTIONS = [
  { key: TransactionType.SALE, label: 'Venda' },
  { key: TransactionType.RENT, label: 'Aluguel' },
];

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

export default function PropertyForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!id;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<PropertyType>(PropertyType.APARTMENT);
  const [transactionType, setTransactionType] = useState<TransactionType>(TransactionType.SALE);
  const [price, setPrice] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [areaM2, setAreaM2] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingProperty, setLoadingProperty] = useState(isEditing);

  useEffect(() => {
    if (!id) return;
    propertyApi
      .getById(id)
      .then(({ data }) => {
        setTitle(data.title);
        setDescription(data.description);
        setType(data.type);
        setTransactionType(data.transactionType);
        setPrice(String(data.price));
        setBedrooms(data.bedrooms !== null ? String(data.bedrooms) : '');
        setBathrooms(data.bathrooms !== null ? String(data.bathrooms) : '');
        setAreaM2(data.areaM2 !== null ? String(data.areaM2) : '');
        setStreet(data.street);
        setNumber(data.number);
        setNeighborhood(data.neighborhood);
        setCity(data.city);
        setState(data.state);
        setZipCode(data.zipCode);
        setIsActive(data.isActive);
      })
      .catch(() => Alert.alert('Erro', 'Não foi possível carregar o imóvel'))
      .finally(() => setLoadingProperty(false));
  }, [id]);

  const handleZipCodeBlur = async () => {
    const digits = zipCode.replace(/\D/g, '');
    if (digits.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data: ViaCepResponse = await res.json();
      if (data.erro) return;
      if (data.logradouro) setStreet(data.logradouro);
      if (data.bairro) setNeighborhood(data.bairro);
      if (data.localidade) setCity(data.localidade);
      if (data.uf) setState(data.uf);
    } catch {
      // CEP inválido ou API fora do ar: segue com preenchimento manual
    }
  };

  const buildPayload = () => ({
    title,
    description,
    type,
    transactionType,
    price: Number(price),
    bedrooms: bedrooms ? Number(bedrooms) : undefined,
    bathrooms: bathrooms ? Number(bathrooms) : undefined,
    areaM2: areaM2 ? Number(areaM2) : undefined,
    street,
    number,
    neighborhood,
    city,
    state,
    zipCode,
  });

  const handleSubmit = async () => {
    if (!title || !description || !price || !street || !number || !neighborhood || !city || !state || !zipCode) {
      return;
    }
    setSaving(true);
    try {
      if (isEditing && id) {
        await propertyApi.update(id, { ...buildPayload(), isActive });
      } else {
        await propertyApi.create(buildPayload());
      }
      router.back();
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar o anúncio');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!id) return;
    Alert.alert('Excluir anúncio', 'Tem certeza? Essa ação não pode ser desfeita.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            await propertyApi.remove(id);
            router.back();
          } catch {
            Alert.alert('Erro', 'Não foi possível excluir o anúncio');
          }
        },
      },
    ]);
  };

  if (loadingProperty) {
    return (
      <View style={styles.center}>
        <Text>Carregando...</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{isEditing ? 'Editar anúncio' : 'Novo anúncio'}</Text>

      <Input label="Título" value={title} onChangeText={setTitle} />
      <Input label="Descrição" value={description} onChangeText={setDescription} multiline />

      <Text style={styles.sectionLabel}>Tipo</Text>
      <View style={styles.optionsRow}>
        {TYPE_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.option, type === opt.key && styles.optionSelected]}
            onPress={() => setType(opt.key)}
          >
            <Text style={[styles.optionText, type === opt.key && styles.optionTextSelected]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Transação</Text>
      <View style={styles.optionsRow}>
        {TRANSACTION_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.option, transactionType === opt.key && styles.optionSelected]}
            onPress={() => setTransactionType(opt.key)}
          >
            <Text style={[styles.optionText, transactionType === opt.key && styles.optionTextSelected]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Input label="Preço" value={price} onChangeText={setPrice} keyboardType="numeric" />
      <Input label="Quartos" value={bedrooms} onChangeText={setBedrooms} keyboardType="numeric" />
      <Input label="Banheiros" value={bathrooms} onChangeText={setBathrooms} keyboardType="numeric" />
      <Input label="Área (m²)" value={areaM2} onChangeText={setAreaM2} keyboardType="numeric" />
      <Input
        label="CEP"
        value={zipCode}
        onChangeText={setZipCode}
        onBlur={handleZipCodeBlur}
        keyboardType="numeric"
        placeholder="00000-000"
      />
      <Input label="Rua" value={street} onChangeText={setStreet} />
      <Input label="Número" value={number} onChangeText={setNumber} />
      <Input label="Bairro" value={neighborhood} onChangeText={setNeighborhood} />
      <Input label="Cidade" value={city} onChangeText={setCity} />
      <Input label="Estado (UF)" value={state} onChangeText={setState} maxLength={2} autoCapitalize="characters" />

      {isEditing ? (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Anúncio ativo</Text>
          <Switch value={isActive} onValueChange={setIsActive} />
        </View>
      ) : null}

      <Button title={isEditing ? 'Salvar' : 'Publicar'} onPress={handleSubmit} loading={saving} />

      {isEditing ? (
        <View style={styles.deleteButtonWrapper}>
          <Button title="Excluir anúncio" variant="outline" onPress={handleDelete} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 16 },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  option: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: '#d1d5db',
  },
  optionSelected: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  optionText: { fontSize: 14, color: '#374151' },
  optionTextSelected: { color: '#fff', fontWeight: '700' },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, paddingVertical: 8,
  },
  switchLabel: { fontSize: 15, color: '#111827', fontWeight: '600' },
  deleteButtonWrapper: { marginTop: 4 },
});
```

- [ ] **Step 2: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "mobile/app/property/form.tsx"
git commit -m "feat: add property create/edit form with CEP autofill"
```

- [ ] **Step 4: Manual smoke test (recommended before pushing)**

Run the backend against a local Postgres and the Expo dev server. Log in as an `owner`, confirm the "Meus anúncios" tab appears (and doesn't for a `buyer_tenant` login), create a listing (verify CEP autofill by typing a real CEP like `01310-100`), confirm it appears in the list, edit it (toggle inactive, confirm the badge appears in the list), then delete it and confirm it disappears.

---

## Final Step: Push and verify CI

After all 4 tasks are committed:

```bash
git push
```

Then check `https://github.com/celiooliveir/meu-imovel/actions` — the `Backend — Unit + E2E` job should run the extended `property.e2e-spec.ts` (including the new `/properties/mine` cases), and `Mobile — TypeScript` should pass `tsc --noEmit`.
