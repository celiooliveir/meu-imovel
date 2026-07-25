import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PropertyService } from './property.service';
import { Property, PropertyType, TransactionType } from './property.entity';
import { PropertyPhoto } from './property-photo.entity';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';
import { GeocodingService } from '../../shared/geocoding/geocoding.service';

describe('PropertyService', () => {
  let service: PropertyService;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    // Update-query-builder chain, reused for the location raw update (create/update paths).
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    softRemove: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockPhotoRepo = {
    find: jest.fn(),
  };

  const mockGeocodingService = {
    geocode: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PropertyService,
        { provide: getRepositoryToken(Property), useValue: mockRepo },
        { provide: getRepositoryToken(PropertyPhoto), useValue: mockPhotoRepo },
        { provide: GeocodingService, useValue: mockGeocodingService },
      ],
    }).compile();
    service = module.get(PropertyService);
    jest.clearAllMocks();
    Object.values(mockQueryBuilder).forEach((fn) => {
      if (fn !== mockQueryBuilder.getManyAndCount && fn !== mockQueryBuilder.execute) fn.mockReturnThis();
    });
    mockQueryBuilder.execute.mockResolvedValue(undefined);
    mockPhotoRepo.find.mockResolvedValue([]);
    mockGeocodingService.geocode.mockResolvedValue(null);
  });

  describe('create', () => {
    const dto: CreatePropertyDto = {
      title: 'Casa térrea',
      description: 'Descrição com mais de dez caracteres',
      type: PropertyType.HOUSE,
      transactionType: TransactionType.SALE,
      price: 100000,
      street: 'Rua A',
      number: '1',
      neighborhood: 'Centro',
      city: 'Curitiba',
      state: 'PR',
      zipCode: '80000-000',
    };

    it('should attach ownerId and save the property', async () => {
      const created = { ...dto, ownerId: 'owner-1', id: 'prop-1', latitude: null, longitude: null } as Property;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.create(dto, 'owner-1');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...dto, ownerId: 'owner-1', latitude: null, longitude: null }),
      );
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(result.ownerId).toBe('owner-1');
    });

    it('should geocode the address and save the coordinates when found', async () => {
      mockGeocodingService.geocode.mockResolvedValue({ latitude: -25.4284, longitude: -49.2733 });
      const created = {
        ...dto, ownerId: 'owner-1', id: 'prop-1', latitude: -25.4284, longitude: -49.2733,
      } as Property;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      await service.create(dto, 'owner-1');

      expect(mockGeocodingService.geocode).toHaveBeenCalledWith('Rua A, 1, Centro, Curitiba, PR, 80000-000');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: -25.4284, longitude: -49.2733 }),
      );
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(Property);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        location: expect.any(Function),
      });
      expect(mockQueryBuilder.setParameters).toHaveBeenCalledWith({ lng: -49.2733, lat: -25.4284 });
    });

    it('should save with null coordinates when geocoding finds nothing', async () => {
      mockGeocodingService.geocode.mockResolvedValue(null);
      const created = { ...dto, ownerId: 'owner-1', id: 'prop-1', latitude: null, longitude: null } as Property;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      await service.create(dto, 'owner-1');

      expect(mockRepo.update).toHaveBeenCalledWith('prop-1', { location: null });
    });
  });

  describe('findByIdOrThrow', () => {
    it('should return the property with photos when found', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'prop-1' } as Property);
      const result = await service.findByIdOrThrow('prop-1');
      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'prop-1' }, relations: ['photos'] });
      expect(result.id).toBe('prop-1');
    });

    it('should throw NotFoundException when not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('search', () => {
    it('should apply filters, return paginated results, and attach photos', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[{ id: 'prop-1' } as Property], 1]);
      mockPhotoRepo.find.mockResolvedValue([
        { id: 'photo-1', propertyId: 'prop-1', createdAt: new Date('2026-01-01') } as PropertyPhoto,
      ]);

      const query: SearchPropertyQueryDto = { city: 'São Paulo', page: 2, limit: 10 };
      const result = await service.search(query);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('property.city ILIKE :city', { city: 'São Paulo' });
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.items[0].photos).toEqual([
        { id: 'photo-1', propertyId: 'prop-1', createdAt: new Date('2026-01-01') },
      ]);
      expect(result).toEqual(expect.objectContaining({ total: 1, page: 2, limit: 10 }));
    });

    it('should default to page 1 and limit 20 when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.search({});

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
      expect(mockPhotoRepo.find).not.toHaveBeenCalled();
    });

    it('should add the radius filter and order by distance when lat/lng are provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [{ id: 'prop-1', latitude: -23.55, longitude: -46.63 } as Property],
        1,
      ]);

      const query: SearchPropertyQueryDto = { lat: -23.55, lng: -46.63, radiusKm: 25 };
      const result = await service.search(query);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('property.location IS NOT NULL');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ST_DWithin(property.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)',
        { lng: -46.63, lat: -23.55, radiusMeters: 25000 },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'ST_Distance(property.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)',
        'ASC',
      );
      expect(result.items[0].distanceKm).toBeCloseTo(0, 1);
    });

    it('should default the radius to 10km when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.search({ lat: -23.55, lng: -46.63 });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ST_DWithin(property.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)',
        { lng: -46.63, lat: -23.55, radiusMeters: 10000 },
      );
    });
  });

  describe('findMine', () => {
    it('should return paginated properties owned by the given user, with photos attached', async () => {
      mockRepo.findAndCount.mockResolvedValue([[{ id: 'prop-1', ownerId: 'owner-1' } as Property], 1]);
      mockPhotoRepo.find.mockResolvedValue([
        { id: 'photo-1', propertyId: 'prop-1', createdAt: new Date('2026-01-01') } as PropertyPhoto,
      ]);

      const result = await service.findMine('owner-1', 1, 20);

      expect(mockRepo.findAndCount).toHaveBeenCalledWith({
        where: { ownerId: 'owner-1' },
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result.items[0].photos).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should compute skip from page and limit', async () => {
      mockRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findMine('owner-1', 3, 10);

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    });
  });

  describe('update', () => {
    it('should update and save when the requester owns the property', async () => {
      const existing = {
        id: 'prop-1', ownerId: 'owner-1', price: 100,
        street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipCode: '80000-000',
      } as Property;
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.update('prop-1', 'owner-1', { price: 200 });

      expect(result.price).toBe(200);
      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'prop-1', price: 200 }));
      expect(mockGeocodingService.geocode).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.update('prop-1', 'owner-2', { price: 200 })).rejects.toThrow(ForbiddenException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('should re-geocode when an address field changes', async () => {
      const existing = {
        id: 'prop-1', ownerId: 'owner-1',
        street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipCode: '80000-000',
      } as Property;
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockGeocodingService.geocode.mockResolvedValue({ latitude: -23.5505, longitude: -46.6333 });

      await service.update('prop-1', 'owner-1', { city: 'São Paulo', state: 'SP' });

      expect(mockGeocodingService.geocode).toHaveBeenCalledWith(
        'Rua A, 1, Centro, São Paulo, SP, 80000-000',
      );
      expect(mockQueryBuilder.setParameters).toHaveBeenCalledWith({ lng: -46.6333, lat: -23.5505 });
    });
  });

  describe('remove', () => {
    it('should soft-remove when the requester owns the property', async () => {
      const existing = { id: 'prop-1', ownerId: 'owner-1' } as Property;
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.softRemove.mockResolvedValue(existing);

      await service.remove('prop-1', 'owner-1');

      expect(mockRepo.softRemove).toHaveBeenCalledWith(existing);
    });

    it('should throw ForbiddenException when the requester does not own the property', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'prop-1', ownerId: 'owner-1' } as Property);

      await expect(service.remove('prop-1', 'owner-2')).rejects.toThrow(ForbiddenException);
      expect(mockRepo.softRemove).not.toHaveBeenCalled();
    });
  });
});
