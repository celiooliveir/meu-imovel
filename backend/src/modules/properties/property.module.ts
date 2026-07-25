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
