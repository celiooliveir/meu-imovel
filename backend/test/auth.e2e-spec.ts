import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Drop and recreate public schema before bootstrapping so TypeORM
    // synchronize never hits "already exists" errors for enums or tables.
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
  });

  afterAll(async () => {
    await app.close();
  });

  const user = {
    name: 'Maria Oliveira',
    email: 'maria@teste.com',
    password: 'senha1234',
    role: 'buyer_tenant',
  };

  let accessToken: string;

  it('POST /api/v1/auth/register — cria usuário e retorna tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(user)
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.passwordHash).toBeUndefined();
    accessToken = res.body.accessToken;
  });

  it('POST /api/v1/auth/login — retorna tokens para credenciais válidas', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    accessToken = res.body.accessToken;
  });

  it('POST /api/v1/auth/login — retorna 401 para senha errada', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'errada123' })
      .expect(401);
  });

  it('POST /api/v1/auth/logout — revoga o refresh token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });
});
