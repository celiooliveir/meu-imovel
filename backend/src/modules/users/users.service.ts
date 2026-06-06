import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepo.findOneBy({ email: dto.email });
    if (existing) throw new ConflictException('E-mail já cadastrado');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.usersRepo.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      role: dto.role,
      phone: dto.phone ?? null,
      lgpdConsent: true,
      lgpdConsentAt: new Date(),
    });
    return this.usersRepo.save(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepo.findOneBy({ id });
  }

  async findByEmail(email: string, withPassword = false): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { email },
      select: withPassword
        ? ['id', 'email', 'name', 'role', 'passwordHash', 'kycStatus', 'refreshToken',
           'phone', 'avatarUrl', 'createdAt', 'updatedAt', 'deletedAt']
        : undefined,
    });
  }

  async updateRefreshToken(id: string, token: string | null): Promise<void> {
    await this.usersRepo.update(id, { refreshToken: token });
  }
}
