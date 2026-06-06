import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserRole, KycStatus } from '../users/user.entity';
import * as bcrypt from 'bcrypt';

const buildMockUser = (passwordHash: string) => ({
  id: 'uuid-1',
  name: 'João',
  email: 'joao@email.com',
  role: UserRole.BUYER_TENANT,
  kycStatus: KycStatus.PENDING,
  phone: null,
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  passwordHash,
  refreshToken: null,
});

describe('AuthService', () => {
  let service: AuthService;
  const mockUsersService = {
    findByEmail: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    updateRefreshToken: jest.fn(),
  };
  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
  };
  const mockConfig = {
    getOrThrow: jest.fn().mockReturnValue('secret'),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(AuthService);
    jest.clearAllMocks();
    mockJwtService.signAsync.mockResolvedValue('signed-token');
    mockUsersService.updateRefreshToken.mockResolvedValue(undefined);
  });

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      const hash = await bcrypt.hash('senha1234', 12);
      mockUsersService.findByEmail.mockResolvedValue(buildMockUser(hash));

      const result = await service.login({ email: 'joao@email.com', password: 'senha1234' });

      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
      expect(result.user.email).toBe('joao@email.com');
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('senha1234', 12);
      mockUsersService.findByEmail.mockResolvedValue(buildMockUser(hash));

      await expect(
        service.login({ email: 'joao@email.com', password: 'errada' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'naoexiste@email.com', password: 'senha' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
