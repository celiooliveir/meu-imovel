import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../modules/users/user.entity';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  const mockReflector = { getAllAndOverride: jest.fn() };

  beforeEach(() => {
    guard = new RolesGuard(mockReflector as unknown as Reflector);
    jest.clearAllMocks();
  });

  const buildContext = (user?: { role: UserRole }): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('should allow access when no roles are required', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(buildContext({ role: UserRole.BUYER_TENANT }))).toBe(true);
  });

  it('should allow access when the user has a required role', () => {
    mockReflector.getAllAndOverride.mockReturnValue([UserRole.OWNER, UserRole.BROKER]);
    expect(guard.canActivate(buildContext({ role: UserRole.OWNER }))).toBe(true);
  });

  it('should deny access when the user does not have a required role', () => {
    mockReflector.getAllAndOverride.mockReturnValue([UserRole.OWNER, UserRole.BROKER]);
    expect(guard.canActivate(buildContext({ role: UserRole.BUYER_TENANT }))).toBe(false);
  });
});
