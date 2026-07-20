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
