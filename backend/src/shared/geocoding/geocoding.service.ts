import { Injectable } from '@nestjs/common';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

@Injectable()
export class GeocodingService {
  async geocode(address: string): Promise<GeocodeResult | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'meu-imovel-app (contato@meuimovel.com.br)' },
      });
      if (!response.ok) return null;

      const results = (await response.json()) as Array<{ lat: string; lon: string }>;
      if (results.length === 0) return null;

      return { latitude: parseFloat(results[0].lat), longitude: parseFloat(results[0].lon) };
    } catch {
      return null;
    }
  }
}
