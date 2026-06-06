import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';

export enum UserRole {
  BUYER_TENANT = 'buyer_tenant',
  OWNER = 'owner',
  BROKER = 'broker',
}

export enum KycStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('users')
export class User extends BaseEntity {
  @Column()
  name: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column({ nullable: true, type: 'varchar' })
  phone: string | null;

  @Column({ nullable: true, type: 'varchar' })
  avatarUrl: string | null;

  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.PENDING })
  kycStatus: KycStatus;

  @Column({ nullable: true, type: 'varchar' })
  kycReferenceId: string | null;

  @Column({ nullable: true, type: 'varchar', select: false })
  refreshToken: string | null;

  @Column({ default: true })
  lgpdConsent: boolean;

  @Column({ nullable: true, type: 'timestamptz' })
  lgpdConsentAt: Date | null;
}
