import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from './property.entity';
import { PropertyPhoto } from './property-photo.entity';
import { PropertyService } from './property.service';
import { PropertyController } from './property.controller';
import { PropertyPhotoService } from './property-photo.service';
import { PropertyPhotoController } from './property-photo.controller';
import { CloudinaryModule } from '../../shared/cloudinary/cloudinary.module';
import { GeocodingModule } from '../../shared/geocoding/geocoding.module';

@Module({
  imports: [TypeOrmModule.forFeature([Property, PropertyPhoto]), CloudinaryModule, GeocodingModule],
  providers: [PropertyService, PropertyPhotoService],
  controllers: [PropertyController, PropertyPhotoController],
})
export class PropertyModule {}
