import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertyFavoriteService } from './property-favorite.service';
import { PropertyFavorite } from './property-favorite.entity';
import { Property } from './property.entity';
import { PropertyService } from './property.service';

describe('PropertyFavoriteService', () => {
  let service: PropertyFavoriteService;

  const mockFavoriteRepo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    findAndCount: jest.fn(),
    find: jest.fn(),
  };

  const mockPropertyRepo = {
    find: jest.fn(),
  };

  const mockPropertyService = {
    findByIdOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PropertyFavoriteService,
        { provide: getRepositoryToken(PropertyFavorite), useValue: mockFavoriteRepo },
        { provide: getRepositoryToken(Property), useValue: mockPropertyRepo },
        { provide: PropertyService, useValue: mockPropertyService },
      ],
    }).compile();
    service = module.get(PropertyFavoriteService);
    jest.clearAllMocks();
  });

  describe('add', () => {
    it('should throw NotFoundException when the property does not exist', async () => {
      mockPropertyService.findByIdOrThrow.mockRejectedValue(new Error('not found'));

      await expect(service.add('prop-missing', 'user-1')).rejects.toThrow();
      expect(mockFavoriteRepo.create).not.toHaveBeenCalled();
    });

    it('should create a favorite when none exists yet', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1' } as Property);
      mockFavoriteRepo.findOneBy.mockResolvedValue(null);
      mockFavoriteRepo.create.mockReturnValue({ propertyId: 'prop-1', userId: 'user-1' });

      await service.add('prop-1', 'user-1');

      expect(mockFavoriteRepo.create).toHaveBeenCalledWith({ propertyId: 'prop-1', userId: 'user-1' });
      expect(mockFavoriteRepo.save).toHaveBeenCalled();
    });

    it('should be idempotent when the favorite already exists', async () => {
      mockPropertyService.findByIdOrThrow.mockResolvedValue({ id: 'prop-1' } as Property);
      mockFavoriteRepo.findOneBy.mockResolvedValue({ id: 'fav-1', propertyId: 'prop-1', userId: 'user-1' });

      await service.add('prop-1', 'user-1');

      expect(mockFavoriteRepo.create).not.toHaveBeenCalled();
      expect(mockFavoriteRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete the favorite by propertyId and userId', async () => {
      await service.remove('prop-1', 'user-1');
      expect(mockFavoriteRepo.delete).toHaveBeenCalledWith({ propertyId: 'prop-1', userId: 'user-1' });
    });
  });

  describe('findFavorites', () => {
    it('should return properties in favorited order with pagination metadata', async () => {
      mockFavoriteRepo.findAndCount.mockResolvedValue([
        [
          { propertyId: 'prop-2', userId: 'user-1' },
          { propertyId: 'prop-1', userId: 'user-1' },
        ],
        2,
      ]);
      mockPropertyRepo.find.mockResolvedValue([
        { id: 'prop-1' } as Property,
        { id: 'prop-2' } as Property,
      ]);

      const result = await service.findFavorites('user-1', 1, 20);

      expect(result.items.map((p) => p.id)).toEqual(['prop-2', 'prop-1']);
      expect(result).toEqual(expect.objectContaining({ total: 2, page: 1, limit: 20 }));
    });

    it('should return an empty result without querying properties when there are no favorites', async () => {
      mockFavoriteRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findFavorites('user-1', 1, 20);

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
      expect(mockPropertyRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('findFavoriteIds', () => {
    it('should return the property ids favorited by the user', async () => {
      mockFavoriteRepo.find.mockResolvedValue([
        { propertyId: 'prop-1' },
        { propertyId: 'prop-2' },
      ]);

      const result = await service.findFavoriteIds('user-1');

      expect(result).toEqual(['prop-1', 'prop-2']);
      expect(mockFavoriteRepo.find).toHaveBeenCalledWith({ where: { userId: 'user-1' }, select: ['propertyId'] });
    });
  });
});
