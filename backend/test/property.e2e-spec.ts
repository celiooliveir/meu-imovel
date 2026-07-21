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
