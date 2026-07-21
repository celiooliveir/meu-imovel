import {
  Controller, Post, Get, Patch, Delete, Param, Query, Body,
  UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { PropertyService } from './property.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertyQueryDto } from './dto/search-property-query.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyResponseDto } from './dto/property-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@Controller('properties')
export class PropertyController {
  constructor(private readonly propertyService: PropertyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  async create(@Body() dto: CreatePropertyDto, @CurrentUser() user: { id: string }) {
    const property = await this.propertyService.create(dto, user.id);
    return PropertyResponseDto.fromEntity(property);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async search(@Query() query: SearchPropertyQueryDto) {
    const { items, total, page, limit } = await this.propertyService.search(query);
    return { items: items.map(PropertyResponseDto.fromEntity), total, page, limit };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const property = await this.propertyService.findByIdOrThrow(id);
    return PropertyResponseDto.fromEntity(property);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePropertyDto,
    @CurrentUser() user: { id: string },
  ) {
    const property = await this.propertyService.update(id, user.id, dto);
    return PropertyResponseDto.fromEntity(property);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: { id: string }) {
    await this.propertyService.remove(id, user.id);
  }
}
