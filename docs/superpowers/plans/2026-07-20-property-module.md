# Módulo de Imóveis (Property) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CRUD + filtered search for property listings to the backend, and a search/detail experience to the mobile app, replacing the "Busca de imóveis em breve" placeholder.

**Architecture:** New `PropertyModule` in the NestJS backend, mirroring the existing `AuthModule`/`UsersModule` structure (controller → service → TypeORM repository), plus a new reusable `RolesGuard` for role-based authorization (only `JwtAuthGuard`/authentication exists today, no authorization-by-role). Mobile gets a new `services/properties.ts` API client, a rewritten search screen at `app/(tabs)/index.tsx`, and a new detail screen at `app/property/[id].tsx`.

**Tech Stack:** NestJS 11, TypeORM 0.3 (Postgres), class-validator/class-transformer, Jest + Supertest (e2e only — no unit test precedent in this repo). Mobile: Expo Router ~56, React Native, axios, Zustand (not needed for this feature — search state is local to the screen).

## Global Constraints

- All property endpoints sit behind `JwtAuthGuard` — there is no public/unauthenticated endpoint in this phase.
- Only `owner`/`broker` roles may create/edit/delete; a user may only edit/delete their **own** listing (`ownerId === request.user.id`), enforced in the service layer, not just by role.
- Scope is CRUD + text/filter search only. No photos, no PostGIS/geosearch, no favorites, no mobile create/edit screen, no draft/sold/rented status workflow (`isActive: boolean` only) — all explicitly deferred per `docs/superpowers/specs/2026-07-20-property-module-design.md`.
- Pagination is offset-based (`page`/`limit`, default 20, max 50).
- Follow existing module conventions exactly: `entity.ts` co-locates its enums (see `user.entity.ts`), DTOs use `class-validator` decorators, response DTOs use a static `fromEntity()` mapper (see `UserResponseDto`), error messages are Portuguese strings (see `'Credenciais inválidas'`, `'E-mail já cadastrado'`).
- Backend behavior is covered at two levels, matching the existing precedent found in `src/modules/auth/auth.service.spec.ts`, `src/modules/users/users.service.spec.ts`, and `src/shared/middleware/lgpd.middleware.spec.ts`: unit tests mock the TypeORM repository via `getRepositoryToken(Entity)` (services) or construct the class directly with mocked collaborators (guards/middleware) and live next to the source file as `*.spec.ts`; `test/property.e2e-spec.ts` (matching `test/auth.e2e-spec.ts`) covers the full HTTP/DB integration, including authorization end-to-end. Every task that adds service or guard logic adds/extends both.
- `backend/test/jest-e2e.json` already forces `maxWorkers: 1` — the new e2e spec file runs serially with `auth.e2e-spec.ts` automatically, no config changes needed.
- Mobile has no test runner beyond `tsc --noEmit` (see `.github/workflows/ci.yml`) — verification for mobile tasks is `npx tsc --noEmit` passing cleanly, plus the code following `mobile/AGENTS.md`'s instruction to match current Expo Router (~56) APIs.

---

## Task 1: Roles guard + Property entity + `POST /properties`

**Files:**
- Create: `backend/src/shared/decorators/roles.decorator.ts`
- Create: `backend/src/shared/guards/roles.guard.ts`
- Create: `backend/src/shared/guards/roles.guard.spec.ts`
- Create: `backend/src/modules/properties/property.entity.ts`
- Create: `backend/src/modules/properties/dto/create-property.dto.ts`
- Create: `backend/src/modules/properties/dto/property-response.dto.ts`
- Create: `backend/src/modules/properties/property.service.ts`
- Create: `backend/src/modules/properties/property.service.spec.ts`
- Create: `backend/src/modules/properties/property.controller.ts`
- Create: `backend/src/modules/properties/property.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/property.e2e-spec.ts` (new file)

**Interfaces:**
- Produces: `Property` entity (`backend/src/modules/properties/property.entity.ts`) with `PropertyType` enum (`apartment`, `house`, `commercial`, `land`) and `TransactionType` enum (`sale`, `rent`); `PropertyService.create(dto: CreatePropertyDto, ownerId: string): Promise<Property>`; `PropertyResponseDto.fromEntity(property: Property): PropertyResponseDto`; `Roles(...roles: UserRole[])` decorator and `RolesGuard` — both reused unmodified by Tasks 2 and 3.
- Unit tests follow the repo's existing convention (see `src/modules/users/users.service.spec.ts` and `src/shared/middleware/lgpd.middleware.spec.ts`): `property.service.spec.ts` mocks the repository via `getRepositoryToken(Property)`; `roles.guard.spec.ts` constructs `RolesGuard` directly with a mocked `Reflector`.

- [ ] **Step 1: Write the failing e2e test file**

Create `backend/test/property.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

describe('Properties (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let brokerToken: string;
  let tenantToken: string;

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

    const brokerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Duda Broker', email: 'duda.broker@teste.com', password: 'senha1234', role: 'broker' });
    brokerToken = brokerRes.body.accessToken;

    const tenantRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Bruno Tenant', email: 'bruno.tenant@teste.com', password: 'senha1234', role: 'buyer_tenant' });
    tenantToken = tenantRes.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const validProperty = {
    title: 'Apartamento reformado com vaga',
    description: 'Apartamento reformado, próximo ao metrô, com vaga de garagem.',
    type: 'apartment',
    transactionType: 'sale',
    price: 350000,
    bedrooms: 2,
    bathrooms: 1,
    areaM2: 65,
    street: 'Rua das Flores',
    number: '123',
    neighborhood: 'Centro',
    city: 'Belo Horizonte',
    state: 'MG',
    zipCode: '30130-000',
  };

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
  });

  it('POST /api/v1/properties — broker também pode criar', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${brokerToken}`)
      .send(validProperty)
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  it('POST /api/v1/properties — buyer_tenant recebe 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${tenantToken}`)
      .send(validProperty)
      .expect(403);
  });

  it('POST /api/v1/properties — sem token recebe 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/properties')
      .send(validProperty)
      .expect(401);
  });

  it('POST /api/v1/properties — corpo inválido recebe 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validProperty, title: undefined })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (with a real Postgres reachable at `DATABASE_URL`, e.g. via `docker-compose -f backend/docker-compose.test.yml up -d`):

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test npx jest --config test/jest-e2e.json --no-coverage --forceExit -t "Properties"
```

Expected: FAIL — first test gets 404 (route `/api/v1/properties` doesn't exist yet).

- [ ] **Step 3: Create the roles decorator**

Create `backend/src/shared/decorators/roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../modules/users/user.entity';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 4: Create the roles guard**

Create `backend/src/shared/guards/roles.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../modules/users/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user?.role);
  }
}
```

- [ ] **Step 5: Create the Property entity**

Create `backend/src/modules/properties/property.entity.ts`:

```ts
import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';
import { User } from '../users/user.entity';

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
}
```

- [ ] **Step 6: Create the create-property DTO**

Create `backend/src/modules/properties/dto/create-property.dto.ts`:

```ts
import {
  IsString, IsEnum, IsNumber, IsInt, IsOptional, Min, Length, Matches, MinLength,
} from 'class-validator';
import { PropertyType, TransactionType } from '../property.entity';

export class CreatePropertyDto {
  @IsString()
  @MinLength(3)
  title: string;

  @IsString()
  @MinLength(10)
  description: string;

  @IsEnum(PropertyType)
  type: PropertyType;

  @IsEnum(TransactionType)
  transactionType: TransactionType;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  areaM2?: number;

  @IsString()
  street: string;

  @IsString()
  number: string;

  @IsString()
  neighborhood: string;

  @IsString()
  city: string;

  @IsString()
  @Length(2, 2)
  state: string;

  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'zipCode deve estar no formato CEP (00000-000)' })
  zipCode: string;
}
```

- [ ] **Step 7: Create the property response DTO**

Create `backend/src/modules/properties/dto/property-response.dto.ts`:

```ts
import { Property, PropertyType, TransactionType } from '../property.entity';

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
    return dto;
  }
}
```

- [ ] **Step 8: Create the property service (create only for now)**

Create `backend/src/modules/properties/property.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Property } from './property.entity';
import { CreatePropertyDto } from './dto/create-property.dto';

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
}
```

- [ ] **Step 9: Create the property controller (POST only for now)**

Create `backend/src/modules/properties/property.controller.ts`:

```ts
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { PropertyService } from './property.service';
import { CreatePropertyDto } from './dto/create-property.dto';
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
}
```

- [ ] **Step 10: Create the property module**

Create `backend/src/modules/properties/property.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from './property.entity';
import { PropertyService } from './property.service';
import { PropertyController } from './property.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Property])],
  providers: [PropertyService],
  controllers: [PropertyController],
})
export class PropertyModule {}
```

- [ ] **Step 11: Wire PropertyModule into AppModule**

Modify `backend/src/app.module.ts` — add the import and the module to the `imports` array:

```ts
import { Module, MiddlewareConsumer } from '@nestjs/common';
import type { NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './shared/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { PropertyModule } from './modules/properties/property.module';
import { LgpdMiddleware } from './shared/middleware/lgpd.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    PropertyModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LgpdMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 12: Run the e2e test to verify it passes**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test npx jest --config test/jest-e2e.json --no-coverage --forceExit -t "Properties"
```

Expected: PASS — all 5 tests green (owner create, broker create, tenant 403, no-token 401, invalid-body 400).

- [ ] **Step 13: Write the roles guard unit test**

Create `backend/src/shared/guards/roles.guard.spec.ts`, following the mocked-collaborator pattern from `src/shared/middleware/lgpd.middleware.spec.ts`:

```ts
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../modules/users/user.entity';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  const mockReflector = { getAllAndOverride: jest.fn() };

  beforeEach(() => {
    guard = new RolesGuard(mockReflector as unknown as Reflector);
    jest.clearAllMocks();
  });

  const buildContext = (user?: { role: UserRole }): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('should allow access when no roles are required', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(buildContext({ role: UserRole.BUYER_TENANT }))).toBe(true);
  });

  it('should allow access when the user has a required role', () => {
    mockReflector.getAllAndOverride.mockReturnValue([UserRole.OWNER, UserRole.BROKER]);
    expect(guard.canActivate(buildContext({ role: UserRole.OWNER }))).toBe(true);
  });

  it('should deny access when the user does not have a required role', () => {
    mockReflector.getAllAndOverride.mockReturnValue([UserRole.OWNER, UserRole.BROKER]);
    expect(guard.canActivate(buildContext({ role: UserRole.BUYER_TENANT }))).toBe(false);
  });
});
```

- [ ] **Step 14: Write the property service unit test (create only)**

Create `backend/src/modules/properties/property.service.spec.ts`, following the mocked-repository pattern from `src/modules/users/users.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertyService } from './property.service';
import { Property, PropertyType, TransactionType } from './property.entity';
import { CreatePropertyDto } from './dto/create-property.dto';

describe('PropertyService', () => {
  let service: PropertyService;
  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
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
});
```

- [ ] **Step 15: Run the unit tests to verify they pass**

```bash
cd backend
npx jest --no-coverage roles.guard.spec.ts property.service.spec.ts
```

Expected: PASS — 4 tests green (3 guard + 1 service).

- [ ] **Step 16: Commit**

```bash
git add backend/src/shared/decorators/roles.decorator.ts backend/src/shared/guards/roles.guard.ts backend/src/shared/guards/roles.guard.spec.ts backend/src/modules/properties backend/src/app.module.ts backend/test/property.e2e-spec.ts
git commit -m "feat: add property entity, roles guard, and POST /properties"
```

---

## Task 2: `GET /properties` (search) and `GET /properties/:id`

**Files:**
- Create: `backend/src/modules/properties/dto/search-property-query.dto.ts`
- Modify: `backend/src/modules/properties/property.service.ts`
- Modify: `backend/src/modules/properties/property.service.spec.ts`
- Modify: `backend/src/modules/properties/property.controller.ts`
- Modify: `backend/test/property.e2e-spec.ts`

**Interfaces:**
- Consumes: `Property`, `PropertyType`, `TransactionType` from Task 1's `property.entity.ts`; `PropertyResponseDto.fromEntity` from Task 1.
- Produces: `PropertyService.search(query: SearchPropertyQueryDto): Promise<{ items: Property[]; total: number; page: number; limit: number }>`; `PropertyService.findByIdOrThrow(id: string): Promise<Property>` — both reused by Task 3.

- [ ] **Step 1: Write the failing e2e tests**

Modify `backend/test/property.e2e-spec.ts` — add seed users/properties to `beforeAll`, and add new `it` blocks after the existing ones. Replace the whole file with:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

describe('Properties (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let brokerToken: string;
  let tenantToken: string;

  let spFlatId: string;
  let spHouseId: string;
  let rioFlatId: string;
  let curitibaLandId: string;

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

    const brokerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Duda Broker', email: 'duda.broker@teste.com', password: 'senha1234', role: 'broker' });
    brokerToken = brokerRes.body.accessToken;

    const tenantRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Bruno Tenant', email: 'bruno.tenant@teste.com', password: 'senha1234', role: 'buyer_tenant' });
    tenantToken = tenantRes.body.accessToken;

    const createAsOwner = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(body);

    const spFlat = await createAsOwner({
      title: 'Studio moderno na Vila Mariana',
      description: 'Studio compacto e bem localizado, ideal para solteiros.',
      type: 'apartment',
      transactionType: 'sale',
      price: 350000,
      bedrooms: 2,
      bathrooms: 1,
      areaM2: 45,
      street: 'Rua Vergueiro',
      number: '500',
      neighborhood: 'Vila Mariana',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '04101-000',
    });
    spFlatId = spFlat.body.id;

    const spHouse = await createAsOwner({
      title: 'Casa térrea com quintal amplo',
      description: 'Casa térrea com quintal grande, ótima para famílias com crianças.',
      type: 'house',
      transactionType: 'rent',
      price: 2800,
      bedrooms: 3,
      bathrooms: 2,
      areaM2: 120,
      street: 'Rua das Palmeiras',
      number: '80',
      neighborhood: 'Jardim América',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01440-000',
    });
    spHouseId = spHouse.body.id;

    const rioFlat = await createAsOwner({
      title: 'Cobertura duplex com vista mar',
      description: 'Cobertura duplex com vista panorâmica para o mar.',
      type: 'apartment',
      transactionType: 'sale',
      price: 900000,
      bedrooms: 4,
      bathrooms: 3,
      areaM2: 180,
      street: 'Avenida Atlântica',
      number: '2000',
      neighborhood: 'Copacabana',
      city: 'Rio de Janeiro',
      state: 'RJ',
      zipCode: '22021-001',
    });
    rioFlatId = rioFlat.body.id;

    const curitibaLand = await createAsOwner({
      title: 'Terreno plano em condomínio fechado',
      description: 'Terreno plano pronto para construir, em condomínio fechado.',
      type: 'land',
      transactionType: 'sale',
      price: 150000,
      street: 'Alameda dos Ipês',
      number: '10',
      neighborhood: 'Santa Felicidade',
      city: 'Curitiba',
      state: 'PR',
      zipCode: '82015-000',
    });
    curitibaLandId = curitibaLand.body.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const validProperty = {
    title: 'Apartamento reformado com vaga',
    description: 'Apartamento reformado, próximo ao metrô, com vaga de garagem.',
    type: 'apartment',
    transactionType: 'sale',
    price: 350000,
    bedrooms: 2,
    bathrooms: 1,
    areaM2: 65,
    street: 'Rua das Flores',
    number: '123',
    neighborhood: 'Centro',
    city: 'Belo Horizonte',
    state: 'MG',
    zipCode: '30130-000',
  };

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
  });

  it('POST /api/v1/properties — broker também pode criar', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${brokerToken}`)
      .send(validProperty)
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  it('POST /api/v1/properties — buyer_tenant recebe 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${tenantToken}`)
      .send(validProperty)
      .expect(403);
  });

  it('POST /api/v1/properties — sem token recebe 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/properties')
      .send(validProperty)
      .expect(401);
  });

  it('POST /api/v1/properties — corpo inválido recebe 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validProperty, title: undefined })
      .expect(400);
  });

  it('GET /api/v1/properties — sem token recebe 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/properties').expect(401);
  });

  it('GET /api/v1/properties?city= — filtra por cidade', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .query({ city: 'São Paulo' })
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([spFlatId, spHouseId]));
    expect(ids).not.toContain(rioFlatId);
    expect(res.body.items.every((p: { city: string }) => p.city === 'São Paulo')).toBe(true);
  });

  it('GET /api/v1/properties?type=&transactionType= — filtros combinados', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .query({ type: 'apartment', transactionType: 'sale' })
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([spFlatId, rioFlatId]));
    expect(ids).not.toContain(spHouseId);
    expect(ids).not.toContain(curitibaLandId);
  });

  it('GET /api/v1/properties?minPrice= — filtra por preço mínimo', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .query({ minPrice: 500000 })
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(rioFlatId);
    expect(ids).not.toContain(spFlatId);
    expect(ids).not.toContain(curitibaLandId);
  });

  it('GET /api/v1/properties?maxPrice= — filtra por preço máximo', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .query({ maxPrice: 200000 })
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(curitibaLandId);
    expect(ids).not.toContain(spFlatId);
    expect(ids).not.toContain(rioFlatId);
  });

  it('GET /api/v1/properties?bedrooms= — filtra por número mínimo de quartos', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .query({ bedrooms: 3 })
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([spHouseId, rioFlatId]));
    expect(ids).not.toContain(spFlatId);
    expect(ids).not.toContain(curitibaLandId);
  });

  it('GET /api/v1/properties?q= — busca textual', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .query({ q: 'quintal' })
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual([spHouseId]);
  });

  it('GET /api/v1/properties/:id — retorna o imóvel', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/properties/${spFlatId}`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    expect(res.body.id).toBe(spFlatId);
    expect(res.body.title).toBe('Studio moderno na Vila Mariana');
  });

  it('GET /api/v1/properties/:id — 404 para id inexistente', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/properties/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(404);
  });

  it('GET /api/v1/properties/:id — 400 para id malformado', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/properties/not-a-uuid')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test npx jest --config test/jest-e2e.json --no-coverage --forceExit -t "Properties"
```

Expected: the 4 Task 1 tests still PASS; the new `GET` tests FAIL (404, route doesn't exist).

- [ ] **Step 3: Create the search query DTO**

Create `backend/src/modules/properties/dto/search-property-query.dto.ts`:

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

- [ ] **Step 4: Add search and findByIdOrThrow to the service**

Modify `backend/src/modules/properties/property.service.ts` — add `NotFoundException` to the import, and add the two new methods:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Property } from './property.entity';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';

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
}
```

- [ ] **Step 5: Add the GET routes to the controller**

Modify `backend/src/modules/properties/property.controller.ts` — add the imports and the two new handlers:

```ts
import {
  Controller, Post, Get, Param, Query, Body, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { PropertyService } from './property.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';
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

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const property = await this.propertyService.findByIdOrThrow(id);
    return PropertyResponseDto.fromEntity(property);
  }
}
```

- [ ] **Step 6: Run the e2e tests to verify they pass**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test npx jest --config test/jest-e2e.json --no-coverage --forceExit -t "Properties"
```

Expected: PASS — all tests green.

- [ ] **Step 7: Extend the property service unit test with search and findByIdOrThrow**

Overwrite `backend/src/modules/properties/property.service.spec.ts` with the full file (adds a `mockQueryBuilder`, wires it into `mockRepo.createQueryBuilder`, and adds `findByIdOrThrow`/`search` coverage on top of Task 1's `create` test):

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
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
});
```

- [ ] **Step 8: Run the unit tests to verify they pass**

```bash
cd backend
npx jest --no-coverage property.service.spec.ts
```

Expected: PASS — 5 tests green (1 create + 2 findByIdOrThrow + 2 search).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/properties backend/test/property.e2e-spec.ts
git commit -m "feat: add property search and detail endpoints"
```

---

## Task 3: `PATCH /properties/:id` and `DELETE /properties/:id` with ownership enforcement

**Files:**
- Create: `backend/src/modules/properties/dto/update-property.dto.ts`
- Modify: `backend/src/modules/properties/property.service.ts`
- Modify: `backend/src/modules/properties/property.service.spec.ts`
- Modify: `backend/src/modules/properties/property.controller.ts`
- Modify: `backend/test/property.e2e-spec.ts`

**Interfaces:**
- Consumes: `PropertyService.findByIdOrThrow` from Task 2; `Property` entity from Task 1.
- Produces: `PropertyService.update(id: string, ownerId: string, dto: UpdatePropertyDto): Promise<Property>`; `PropertyService.remove(id: string, ownerId: string): Promise<void>`.

- [ ] **Step 1: Write the failing e2e tests**

Modify `backend/test/property.e2e-spec.ts`:

1. Add a second owner and a mutable fixture to `beforeAll`. Change the `let` declarations at the top of the `describe` block to:

```ts
  let app: INestApplication;
  let ownerToken: string;
  let brokerToken: string;
  let ownerBToken: string;
  let tenantToken: string;

  let spFlatId: string;
  let spHouseId: string;
  let rioFlatId: string;
  let curitibaLandId: string;
  let mutableId: string;
```

2. Inside `beforeAll`, right after the `tenantToken` registration block (i.e. after `tenantToken = tenantRes.body.accessToken;`, before the `const createAsOwner = ...` line), register the second owner:

```ts
    const ownerBRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Carla OwnerB', email: 'carla.ownerb@teste.com', password: 'senha1234', role: 'owner' });
    ownerBToken = ownerBRes.body.accessToken;
```

3. At the end of `beforeAll`, right after `curitibaLandId = curitibaLand.body.id;`, add the mutable fixture:

```ts

    const mutableProperty = await createAsOwner({
      title: 'Loja comercial no centro histórico',
      description: 'Loja comercial térrea, ampla vitrine, ótimo fluxo de pessoas.',
      type: 'commercial',
      transactionType: 'rent',
      price: 5000,
      street: 'Rua XV de Novembro',
      number: '300',
      neighborhood: 'Centro Histórico',
      city: 'Salvador',
      state: 'BA',
      zipCode: '40010-000',
    });
    mutableId = mutableProperty.body.id;
```

4. Add these `it` blocks at the end of the `describe` block, right before the final closing `});`:

```ts

  it('PATCH /api/v1/properties/:id — dono edita com sucesso', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/properties/${mutableId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ price: 5500 })
      .expect(200);

    expect(res.body.price).toBe(5500);
  });

  it('PATCH /api/v1/properties/:id — outro owner recebe 403', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/properties/${mutableId}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ price: 6000 })
      .expect(403);
  });

  it('PATCH /api/v1/properties/:id — buyer_tenant recebe 403', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/properties/${mutableId}`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({ price: 6000 })
      .expect(403);
  });

  it('DELETE /api/v1/properties/:id — outro owner recebe 403', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${mutableId}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(403);
  });

  it('DELETE /api/v1/properties/:id — dono exclui com sucesso', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${mutableId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/properties/${mutableId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test npx jest --config test/jest-e2e.json --no-coverage --forceExit -t "Properties"
```

Expected: earlier tests still PASS; the new `PATCH`/`DELETE` tests FAIL (404, routes don't exist).

- [ ] **Step 3: Create the update-property DTO**

Create `backend/src/modules/properties/dto/update-property.dto.ts`:

```ts
import {
  IsString, IsEnum, IsNumber, IsInt, IsOptional, IsBoolean, Min, Length, Matches, MinLength,
} from 'class-validator';
import { PropertyType, TransactionType } from '../property.entity';

export class UpdatePropertyDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  description?: string;

  @IsOptional()
  @IsEnum(PropertyType)
  type?: PropertyType;

  @IsOptional()
  @IsEnum(TransactionType)
  transactionType?: TransactionType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  areaM2?: number;

  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'zipCode deve estar no formato CEP (00000-000)' })
  zipCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

- [ ] **Step 4: Add update and remove to the service**

Modify `backend/src/modules/properties/property.service.ts` — add `ForbiddenException` to the import, `UpdatePropertyDto` import, and the two new methods at the end of the class:

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

- [ ] **Step 5: Add the PATCH and DELETE routes to the controller**

Modify `backend/src/modules/properties/property.controller.ts` — add `Patch`, `Delete` to the imports, `UpdatePropertyDto`, and the two new handlers at the end of the class:

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

- [ ] **Step 6: Run the full property + auth e2e suite to verify everything passes**

```bash
cd backend
DATABASE_URL=postgresql://meu_imovel:password@localhost:5432/meu_imovel_test JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx JWT_EXPIRES_IN=15m JWT_REFRESH_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy JWT_REFRESH_EXPIRES_IN=30d NODE_ENV=test npx jest --config test/jest-e2e.json --no-coverage --forceExit
```

Expected: PASS — both `test/auth.e2e-spec.ts` and `test/property.e2e-spec.ts` fully green.

- [ ] **Step 7: Extend the property service unit test with update and remove**

Overwrite `backend/src/modules/properties/property.service.spec.ts` with the full file (adds `ForbiddenException` import, `softRemove` to `mockRepo`, and `update`/`remove` coverage on top of Tasks 1–2's tests):

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

- [ ] **Step 8: Run the unit tests to verify they pass**

```bash
cd backend
npx jest --no-coverage property.service.spec.ts
```

Expected: PASS — 9 tests green (1 create + 2 findByIdOrThrow + 2 search + 2 update + 2 remove).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/properties backend/test/property.e2e-spec.ts
git commit -m "feat: add property update and delete with ownership checks"
```

---

## Task 4: Mobile — `services/properties.ts` and search screen

**Files:**
- Create: `mobile/services/properties.ts`
- Modify: `mobile/app/(tabs)/index.tsx` (replaces the placeholder entirely)

**Interfaces:**
- Consumes: `api` (axios instance) from `mobile/services/api.ts`.
- Produces: `propertyApi.search(filters): Promise<AxiosResponse<PropertySearchResult>>`, `propertyApi.getById(id): Promise<AxiosResponse<Property>>`, `Property` and `PropertyType`/`TransactionType` types — reused by Task 5.

- [ ] **Step 1: Create the properties API client**

Create `mobile/services/properties.ts`:

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

export const propertyApi = {
  search: (filters: PropertySearchFilters = {}) =>
    api.get<PropertySearchResult>('/properties', { params: filters }),

  getById: (id: string) => api.get<Property>(`/properties/${id}`),
};
```

- [ ] **Step 2: Replace the home screen placeholder with the search screen**

Overwrite `mobile/app/(tabs)/index.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../stores/auth.store';
import { propertyApi, Property } from '../../services/properties';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };

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

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await propertyApi.search({ q: q || undefined, city: city || undefined });
      setItems(data.items);
    } catch {
      Alert.alert('Erro', 'Não foi possível buscar os imóveis');
    } finally {
      setLoading(false);
    }
  }, [q, city]);

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Olá, {user?.name} 👋</Text>
      <Input label="Buscar" value={q} onChangeText={setQ} placeholder="Título ou descrição" />
      <Input label="Cidade" value={city} onChangeText={setCity} placeholder="Ex: São Paulo" />
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
  greeting: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  list: { marginTop: 16 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 32 },
  card: {
    padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 12,
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

Expected: no errors. (This mirrors the `mobile-typecheck` CI job — there is no mobile test runner in this repo.)

- [ ] **Step 4: Commit**

```bash
git add mobile/services/properties.ts "mobile/app/(tabs)/index.tsx"
git commit -m "feat: add property search screen to mobile home tab"
```

---

## Task 5: Mobile — property detail screen

**Files:**
- Create: `mobile/app/property/[id].tsx`

**Interfaces:**
- Consumes: `propertyApi.getById`, `Property` from `mobile/services/properties.ts` (Task 4).

- [ ] **Step 1: Create the detail screen**

Create `mobile/app/property/[id].tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { propertyApi, Property } from '../../services/properties';

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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{property.title}</Text>
      <Text style={styles.price}>{formatPrice(property.price, property.transactionType)}</Text>
      <Text style={styles.badge}>
        {TYPE_LABEL[property.type]} • {TRANSACTION_LABEL[property.transactionType]}
      </Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  empty: { color: '#6b7280', fontSize: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  price: { fontSize: 20, fontWeight: '700', color: '#1a56db', marginTop: 8 },
  badge: { fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 16 },
  section: { fontSize: 14, fontWeight: '700', color: '#374151', marginTop: 16, marginBottom: 4 },
  text: { fontSize: 15, color: '#111827', lineHeight: 22 },
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
git add "mobile/app/property/[id].tsx"
git commit -m "feat: add property detail screen to mobile"
```

- [ ] **Step 4: Manual smoke test (recommended before pushing)**

Run the backend against a local Postgres and the Expo dev server, then: log in as an `owner`, create a property via `POST /api/v1/properties` (e.g. with `curl` or a REST client), open the app, confirm it appears in the search tab, tap it, and confirm the detail screen renders all fields correctly.

---

## Final Step: Push and verify CI

After all 5 tasks are committed:

```bash
git push
```

Then check `https://github.com/celiooliveir/meu-imovel/actions` — the `Backend — Unit + E2E` job should run both `auth.e2e-spec.ts` and `property.e2e-spec.ts` (serialized via `maxWorkers: 1`), and `Mobile — TypeScript` should pass `tsc --noEmit`.
