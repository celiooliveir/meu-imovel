import { User, UserRole, KycStatus } from '../user.entity';

export class UserResponseDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string | null;
  avatarUrl: string | null;
  kycStatus: KycStatus;
  createdAt: Date;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.name = user.name;
    dto.email = user.email;
    dto.role = user.role;
    dto.phone = user.phone;
    dto.avatarUrl = user.avatarUrl;
    dto.kycStatus = user.kycStatus;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
