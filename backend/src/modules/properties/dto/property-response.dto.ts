import { Property, PropertyType, TransactionType } from '../property.entity';

export interface PropertyPhotoResponse {
  id: string;
  url: string;
}

export class PropertyResponseDto {
  id: string;
  title: string;
  description: string;
  type: PropertyType;
  transactionType: TransactionType;
  price: number;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  isActive: boolean;
  ownerId: string;
  createdAt: Date;
  photos: PropertyPhotoResponse[];

  static fromEntity(property: Property): PropertyResponseDto {
    const dto = new PropertyResponseDto();
    dto.id = property.id;
    dto.title = property.title;
    dto.description = property.description;
    dto.type = property.type;
    dto.transactionType = property.transactionType;
    dto.price = property.price;
    dto.bedrooms = property.bedrooms;
    dto.bathrooms = property.bathrooms;
    dto.areaM2 = property.areaM2;
    dto.street = property.street;
    dto.number = property.number;
    dto.neighborhood = property.neighborhood;
    dto.city = property.city;
    dto.state = property.state;
    dto.zipCode = property.zipCode;
    dto.isActive = property.isActive;
    dto.ownerId = property.ownerId;
    dto.createdAt = property.createdAt;
    dto.photos = [...(property.photos ?? [])]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((photo) => ({ id: photo.id, url: photo.url }));
    return dto;
  }
}
