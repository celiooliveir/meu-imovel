import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CloudinaryService } from '../src/shared/cloudinary/cloudinary.service';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fakePngBuffer = () => Buffer.concat([PNG_SIGNATURE, Buffer.from('rest-of-fake-png-content')]);

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
      .attach('photos', fakePngBuffer(), { filename: 'photo.png', contentType: 'image/png' })
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
      .attach('photos', fakePngBuffer(), { filename: 'photo.png', contentType: 'image/png' })
      .expect(403);

    expect(mockCloudinaryService.upload).not.toHaveBeenCalled();
  });

  it('POST /api/v1/properties/:id/photos — outro owner recebe 403', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .attach('photos', fakePngBuffer(), { filename: 'photo.png', contentType: 'image/png' })
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
      req.attach('photos', fakePngBuffer(), { filename: `photo${i}.png`, contentType: 'image/png' });
    }

    await req.expect(400);
    expect(mockCloudinaryService.upload).not.toHaveBeenCalled();
  });

  it('DELETE /api/v1/properties/:id/photos/:photoId — outro owner recebe 403', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post(`/api/v1/properties/${propertyId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('photos', fakePngBuffer(), { filename: 'photo.png', contentType: 'image/png' })
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
      .attach('photos', fakePngBuffer(), { filename: 'photo.png', contentType: 'image/png' })
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
      .attach('photos', fakePngBuffer(), { filename: 'photo.png', contentType: 'image/png' })
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
