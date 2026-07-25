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
