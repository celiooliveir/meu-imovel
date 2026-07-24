import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PropertyPhoto } from './property-photo.entity';
import { PropertyService } from './property.service';
import { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';

const MAX_PHOTOS_PER_PROPERTY = 10;

@Injectable()
export class PropertyPhotoService {
  constructor(
    @InjectRepository(PropertyPhoto)
    private readonly photoRepo: Repository<PropertyPhoto>,
    private readonly propertyService: PropertyService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async upload(propertyId: string, ownerId: string, files: Express.Multer.File[]): Promise<PropertyPhoto[]> {
    const property = await this.propertyService.findByIdOrThrow(propertyId);
    if (property.ownerId !== ownerId) {
      throw new ForbiddenException('Você não pode adicionar fotos a um imóvel de outro usuário');
    }

    const existingCount = await this.photoRepo.count({ where: { propertyId } });
    if (existingCount + files.length > MAX_PHOTOS_PER_PROPERTY) {
      throw new BadRequestException(`Limite de ${MAX_PHOTOS_PER_PROPERTY} fotos por imóvel excedido`);
    }

    return Promise.all(
      files.map(async (file) => {
        const { url, publicId } = await this.cloudinary.upload(file.buffer, `properties/${propertyId}`);
        const photo = this.photoRepo.create({ url, publicId, propertyId });
        return this.photoRepo.save(photo);
      }),
    );
  }

  async remove(propertyId: string, photoId: string, ownerId: string): Promise<void> {
    const property = await this.propertyService.findByIdOrThrow(propertyId);
    if (property.ownerId !== ownerId) {
      throw new ForbiddenException('Você não pode excluir uma foto de um imóvel de outro usuário');
    }

    const photo = await this.photoRepo.findOneBy({ id: photoId, propertyId });
    if (!photo) throw new NotFoundException('Foto não encontrada');

    await this.cloudinary.destroy(photo.publicId);
    await this.photoRepo.remove(photo);
  }
}
