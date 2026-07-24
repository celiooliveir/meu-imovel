import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';
import { Property } from './property.entity';

@Entity('property_photos')
export class PropertyPhoto extends BaseEntity {
  @Column()
  url: string;

  @Column()
  publicId: string;

  @Column({ type: 'uuid' })
  propertyId: string;

  @ManyToOne(() => Property, (property) => property.photos)
  @JoinColumn({ name: 'propertyId' })
  property: Property;
}
