import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertyService } from './property.service';
import { Property, PropertyType, TransactionType } from './property.entity';
import { CreatePropertyDto } from './dto/create-property.dto';

describe('PropertyService', () => {
  let service: PropertyService;
  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PropertyService,
        { provide: getRepositoryToken(Property), useValue: mockRepo },
      ],
    }).compile();
    service = module.get(PropertyService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should attach ownerId and save the property', async () => {
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
      const created = { ...dto, ownerId: 'owner-1' } as Property;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.create(dto, 'owner-1');

      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ ...dto, ownerId: 'owner-1' }));
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(result.ownerId).toBe('owner-1');
    });
  });
});
