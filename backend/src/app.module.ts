import { Module, MiddlewareConsumer } from '@nestjs/common';
import type { NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './shared/database/database.module';
import { LgpdMiddleware } from './shared/middleware/lgpd.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LgpdMiddleware).forRoutes('*');
  }
}
