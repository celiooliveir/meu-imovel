import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';
import { User } from '../users/user.entity';
import { PropertyPhoto } from './property-photo.entity';

export enum PropertyType {
  APARTMENT = 'apartment',
  HOUSE = 'house',
  COMMERCIAL = 'commercial',
  LAND = 'land',
}

export enum TransactionType {
  SALE = 'sale',
  RENT = 'rent',
}

const decimalTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : parseFloat(value)),
};

@Entity('properties')
export class Property extends BaseEntity {
  @Column()
  title: string;

  @Column('text')
  description: string;

  @Index()
  @Column({ type: 'enum', enum: PropertyType })
  type: PropertyType;

  @Column({ type: 'enum', enum: TransactionType })
  transactionType: TransactionType;

  @Column('decimal', { precision: 12, scale: 2, transformer: decimalTransformer })
  price: number;

  @Column({ type: 'int', nullable: true })
  bedrooms: number | null;

  @Column({ type: 'int', nullable: true })
  bathrooms: number | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true, transformer: decimalTransformer })
  areaM2: number | null;

  @Column()
  street: string;

  @Column()
  number: string;

  @Column()
  neighborhood: string;

  @Index()
  @Column()
  city: string;

  @Column({ type: 'varchar', length: 2 })
  state: string;

  @Column()
  zipCode: string;

  @Column('decimal', { precision: 10, scale: 7, nullable: true, transformer: decimalTransformer })
  latitude: number | null;

  @Column('decimal', { precision: 10, scale: 7, nullable: true, transformer: decimalTransformer })
  longitude: number | null;

  // PostGIS geography point, used only by ST_DWithin/ST_Distance in raw SQL.
  // Never read directly and never written via plain save() — see property.service.ts.
  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true, select: false })
  location: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @OneToMany(() => PropertyPhoto, (photo) => photo.property)
  photos: PropertyPhoto[];

  // Transient — populated only by PropertyService.search() when a geo filter is active. Not a DB column.
  distanceKm?: number;
}
