import {
  Controller, Post, Delete, Param, UseGuards, UseInterceptors, UploadedFiles,
  ParseUUIDPipe, ParseFilePipeBuilder, HttpStatus, HttpCode,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PropertyPhotoService } from './property-photo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

@Controller('properties/:propertyId/photos')
export class PropertyPhotoController {
  constructor(private readonly photoService: PropertyPhotoService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  @UseInterceptors(FilesInterceptor('photos', 10, { storage: memoryStorage(), limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  async upload(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @UploadedFiles(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
        .addMaxSizeValidator({ maxSize: MAX_FILE_SIZE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    files: Express.Multer.File[],
    @CurrentUser() user: { id: string },
  ) {
    const photos = await this.photoService.upload(propertyId, user.id, files);
    return photos.map((photo) => ({ id: photo.id, url: photo.url }));
  }

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  async remove(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.photoService.remove(propertyId, photoId, user.id);
  }
}
