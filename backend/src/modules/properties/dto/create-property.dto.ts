import {
  IsString, IsEnum, IsNumber, IsInt, IsOptional, Min, Length, Matches, MinLength,
} from 'class-validator';
import { PropertyType, TransactionType } from '../property.entity';

export class CreatePropertyDto {
  @IsString()
  @MinLength(3)
  title: string;

  @IsString()
  @MinLength(10)
  description: string;

  @IsEnum(PropertyType)
  type: PropertyType;

  @IsEnum(TransactionType)
  transactionType: TransactionType;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  areaM2?: number;

  @IsString()
  street: string;

  @IsString()
  number: string;

  @IsString()
  neighborhood: string;

  @IsString()
  city: string;

  @IsString()
  @Length(2, 2)
  state: string;

  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'zipCode deve estar no formato CEP (00000-000)' })
  zipCode: string;
}
