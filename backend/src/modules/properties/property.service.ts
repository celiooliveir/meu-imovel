import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Property } from './property.entity';
import { CreatePropertyDto } from './dto/create-property.dto';

@Injectable()
export class PropertyService {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
  ) {}

  async create(dto: CreatePropertyDto, ownerId: string): Promise<Property> {
    const property = this.propertyRepo.create({ ...dto, ownerId });
    return this.propertyRepo.save(property);
  }
}
