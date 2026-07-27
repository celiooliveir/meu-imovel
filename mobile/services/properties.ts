import { api } from './api';

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

export enum PropertyStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CLOSED = 'closed',
}

export interface PropertyPhoto {
  id: string;
  url: string;
}

export interface Property {
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
  latitude: number | null;
  longitude: number | null;
  status: PropertyStatus;
  ownerId: string;
  createdAt: string;
  photos: PropertyPhoto[];
  distanceKm?: number;
}

export interface PropertySearchFilters {
  city?: string;
  type?: PropertyType;
  transactionType?: TransactionType;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  q?: string;
  page?: number;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export interface PropertySearchResult {
  items: Property[];
  total: number;
  page: number;
  limit: number;
}

export interface PropertyInput {
  title: string;
  description: string;
  type: PropertyType;
  transactionType: TransactionType;
  price: number;
  bedrooms?: number;
  bathrooms?: number;
  areaM2?: number;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface UpdatePropertyInput extends Partial<PropertyInput> {
  status?: PropertyStatus;
}

export interface UploadablePhoto {
  uri: string;
  name: string;
  type: string;
}

export const propertyApi = {
  search: (filters: PropertySearchFilters = {}) =>
    api.get<PropertySearchResult>('/properties', { params: filters }),

  getById: (id: string) => api.get<Property>(`/properties/${id}`),

  getMine: (page?: number) =>
    api.get<PropertySearchResult>('/properties/mine', { params: { page } }),

  create: (dto: PropertyInput) => api.post<Property>('/properties', dto),

  update: (id: string, dto: UpdatePropertyInput) => api.patch<Property>(`/properties/${id}`, dto),

  remove: (id: string) => api.delete(`/properties/${id}`),

  uploadPhotos: (id: string, photos: UploadablePhoto[]) => {
    const formData = new FormData();
    photos.forEach((photo) => {
      // React Native's FormData accepts { uri, name, type } for file fields at
      // runtime, but its TS type only declares string | Blob — the cast is a
      // known, unavoidable mismatch between the RN polyfill and its types.
      formData.append('photos', { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob);
    });
    return api.post<PropertyPhoto[]>(`/properties/${id}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  deletePhoto: (id: string, photoId: string) => api.delete(`/properties/${id}/photos/${photoId}`),

  favorite: (id: string) => api.post(`/properties/${id}/favorite`),

  unfavorite: (id: string) => api.delete(`/properties/${id}/favorite`),

  getFavorites: (page?: number) =>
    api.get<PropertySearchResult>('/properties/favorites', { params: { page } }),

  getFavoriteIds: () => api.get<string[]>('/properties/favorites/ids'),
};
