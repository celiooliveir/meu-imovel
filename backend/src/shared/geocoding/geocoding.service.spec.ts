import { GeocodingService } from './geocoding.service';

describe('GeocodingService', () => {
  let service: GeocodingService;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    service = new GeocodingService();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('should return coordinates when Nominatim finds a match', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ lat: '-23.5505', lon: '-46.6333' }]),
    } as Response);

    const result = await service.geocode('Rua Vergueiro, 500, São Paulo, SP');

    expect(result).toEqual({ latitude: -23.5505, longitude: -46.6333 });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org'),
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) }),
    );
  });

  it('should return null when no results are found', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) } as Response);
    const result = await service.geocode('Endereço inexistente 99999');
    expect(result).toBeNull();
  });

  it('should return null when the request fails', async () => {
    fetchSpy.mockResolvedValue({ ok: false } as Response);
    const result = await service.geocode('Qualquer endereço');
    expect(result).toBeNull();
  });

  it('should return null when fetch throws', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    const result = await service.geocode('Qualquer endereço');
    expect(result).toBeNull();
  });
});
