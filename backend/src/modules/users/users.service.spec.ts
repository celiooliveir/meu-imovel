import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User, UserRole } from './user.entity';

const mockUser: Partial<User> = {
  id: 'uuid-1',
  name: 'João Silva',
  email: 'joao@email.com',
  role: UserRole.BUYER_TENANT,
  phone: null,
  avatarUrl: null,
};

describe('UsersService', () => {
  let service: UsersService;
  const mockRepo = {
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockRepo },
      ],
    }).compile();
    service = module.get(UsersService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should hash password and save user', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);
      mockRepo.create.mockReturnValue(mockUser);
      mockRepo.save.mockResolvedValue(mockUser);

      const result = await service.create({
        name: 'João Silva',
        email: 'joao@email.com',
        password: 'senha1234',
        role: UserRole.BUYER_TENANT,
      });

      expect(mockRepo.save).toHaveBeenCalled();
      expect(result.email).toBe('joao@email.com');
    });

    it('should throw ConflictException when email already exists', async () => {
      mockRepo.findOneBy.mockResolvedValue(mockUser);

      await expect(
        service.create({
          name: 'João',
          email: 'joao@email.com',
          password: 'senha1234',
          role: UserRole.BUYER_TENANT,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByEmail', () => {
    it('should return user with passwordHash when withPassword is true', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockUser, passwordHash: 'hash123' });
      const user = await service.findByEmail('joao@email.com', true);
      expect(user?.passwordHash).toBe('hash123');
    });
  });
});
