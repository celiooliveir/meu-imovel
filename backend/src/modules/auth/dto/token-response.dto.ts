import { UserResponseDto } from '../../users/dto/user-response.dto';

export class TokenResponseDto {
  accessToken: string;
  refreshToken: string;
  user: UserResponseDto;
}
