import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PropertyPhotoService } from './property-photo.service';
import { PropertyPhoto } from './property-photo.entity';
import { Property } from './property.entity';
import { PropertyService } from './property.service';
import { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';

describe('PropertyPhotoService', () => {
  let service: PropertyPhotoService;

  const mockPhotoRepo = {
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
    remove: jest.fn(),
  };

  const mockPropertyService = {
    findByIdOrThrow: jest.fn(),
  };

  const mockCloudinary = {
    upload: jest.fn(),
    destroy: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PropertyPhotoService,
        { provide: getRepositoryToken(PropertyPhoto), useValue: mockPhotoRepo },
        { provide: PropertyService, useValue: mockPropertyService },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();
    service = module.get(PropertyPhotoService);
    jest.clearAllMocks();
  });

  describe('upload', () => {
    const file = { buffer: Buffer.from('fake-image') } as Express.Multer.File;

    it('should upload files to Cloudinary and save photo records when the requester owns the property', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);
      mockPhotoRepo.count.mockResolvedValue(0);
      mockCloudinary.upload.mockResolvedValue({
        url: 'https://cloudinary/img.jpg',
        publicId: 'properties/prop-1/img',
      });
      mockPhotoRepo.create.mockReturnValue({ id: 'photo-1' } as PropertyPhoto);
      mockPhotoRepo.save.mockResolvedValue({ id: 'photo-1' } as PropertyPhoto);

      const result = await service.upload('prop-1', 'owner-1', [file]);

      expect(mockCloudinary.upload).toHaveBeenCalledWith(file.buffer, 'properties/prop-1');
      expect(mockPhotoRepo.create).toHaveBeenCalledWith({
        url: 'https://cloudinary/img.jpg',
        publicId: 'properties/prop-1/img',
        propertyId: 'prop-1',
      });
      expect(result).toEqual([{ id: 'photo-1' }]);
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.upload('prop-1', 'owner-2', [file])).rejects.toThrow(ForbiddenException);
      expect(mockCloudinary.upload).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the photo limit would be exceeded', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);
      mockPhotoRepo.count.mockResolvedValue(9);

      await expect(service.upload('prop-1', 'owner-1', [file, file])).rejects.toThrow(BadRequestException);
      expect(mockCloudinary.upload).not.toHaveBeenCalled();
    });

    it('should upload successfully when the count reaches exactly the limit (existing 9 + 1 new = 10)', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);
      mockPhotoRepo.count.mockResolvedValue(9);
      mockCloudinary.upload.mockResolvedValue({
        url: 'https://cloudinary/img.jpg',
        publicId: 'properties/prop-1/img',
      });
      mockPhotoRepo.create.mockReturnValue({ id: 'photo-1' } as PropertyPhoto);
      mockPhotoRepo.save.mockResolvedValue({ id: 'photo-1' } as PropertyPhoto);

      const result = await service.upload('prop-1', 'owner-1', [file]);

      expect(mockCloudinary.upload).toHaveBeenCalledWith(file.buffer, 'properties/prop-1');
      expect(result).toEqual([{ id: 'photo-1' }]);
    });
  });

  describe('remove', () => {
    it('should destroy the Cloudinary asset and remove the record when the requester owns the property', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);
      const photo = { id: 'photo-1', propertyId: 'prop-1', publicId: 'properties/prop-1/img' } as PropertyPhoto;
      mockPhotoRepo.findOneBy.mockResolvedValue(photo);

      await service.remove('prop-1', 'photo-1', 'owner-1');

      expect(mockCloudinary.destroy).toHaveBeenCalledWith('properties/prop-1/img');
      expect(mockPhotoRepo.remove).toHaveBeenCalledWith(photo);
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.remove('prop-1', 'photo-1', 'owner-2')).rejects.toThrow(ForbiddenException);
      expect(mockCloudinary.destroy).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the photo does not exist', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);
      mockPhotoRepo.findOneBy.mockResolvedValue(null);

      await expect(service.remove('prop-1', 'missing', 'owner-1')).rejects.toThrow(NotFoundException);
    });
  });
});
