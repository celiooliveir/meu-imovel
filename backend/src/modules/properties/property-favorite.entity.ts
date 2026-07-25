import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';
import { Property } from './property.entity';
import { User } from '../users/user.entity';

@Entity('property_favorites')
@Index(['userId', 'propertyId'], { unique: true })
export class PropertyFavorite extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  propertyId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Property)
  @JoinColumn({ name: 'propertyId' })
  property: Property;
}
