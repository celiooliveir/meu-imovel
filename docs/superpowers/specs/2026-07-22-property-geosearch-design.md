# Busca Geoespacial — Design

Data: 2026-07-22

## Contexto

O Postgres do projeto já roda com PostGIS (`postgis/postgis:15-3.4`) desde o início, mas nunca foi usado. Esta fase adiciona busca por proximidade: geocodificação automática do endereço do imóvel e um filtro "perto de mim" na busca do mobile.

## Escopo

- Geocodificação automática (endereço → lat/lng) via Nominatim/OpenStreetMap ao criar ou editar um anúncio.
- `GET /properties` ganha filtro por raio (`lat`, `lng`, `radiusKm`), ordenando por distância.
- Mobile: filtro "Perto de mim" na tela de busca, com raio selecionável, usando a localização do dispositivo.

Fora de escopo: mapa interativo com pinos, edição manual da localização no mapa, geocodificação reversa (lat/lng → endereço).

## Backend

### Colunas novas em `Property`

```ts
latitude: number | null;
longitude: number | null;
location: string | null; // geography(Point, 4326), nullable — usado só para a busca espacial
```

`latitude`/`longitude` como colunas simples (fáceis de ler/exibir); `location` como coluna `geography(Point, 4326)` com índice GiST, usada só internamente pelas queries de proximidade (TypeORM não faz parsing automático de tipos espaciais — leitura/escrita de `location` é feita via SQL bruto no `QueryBuilder`, `latitude`/`longitude` continuam a fonte de leitura simples pro resto da aplicação).

Confirmei que o TypeORM (versão instalada) suporta `spatialFeatureType`/`srid` como opções de coluna, gerando o DDL correto (`geography(Point,4326)`) via `synchronize`.

### `GeocodingService`

`backend/src/shared/geocoding/geocoding.module.ts` + `geocoding.service.ts` — encapsula a chamada ao Nominatim (`GET https://nominatim.openstreetmap.org/search?q={endereço}&format=json&limit=1`, com header `User-Agent` identificando o app, conforme a política de uso deles). Expõe `geocode(address: string): Promise<{ latitude: number; longitude: number } | null>` — retorna `null` (não lança erro) se o endereço não for encontrado ou a API falhar, para nunca bloquear o cadastro.

### Geocodificação em `PropertyService`

- `create()`: monta o endereço completo a partir dos campos do DTO, chama `GeocodingService.geocode()`, salva `latitude`/`longitude` e a coluna `location` (via SQL bruto) se encontrado; se não, salva sem coordenadas.
- `update()`: só re-geocodifica se algum campo de endereço (`street`, `number`, `neighborhood`, `city`, `state`, `zipCode`) mudou — evita chamada desnecessária quando só preço ou descrição são editados.

### `GET /properties` — filtro por raio

Novos parâmetros opcionais em `SearchPropertyQueryDto`: `lat`, `lng`, `radiusKm`. Quando `lat`+`lng` presentes (com `radiusKm` default de 10 se omitido):
- Filtra com `ST_DWithin(property.location, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography, :radiusMeters)`.
- Ordena por `ST_Distance(...)` crescente em vez de `createdAt DESC`.
- Cada item da resposta ganha `distanceKm: number` (calculado na mesma query).

Sem `lat`/`lng`, o comportamento da busca é idêntico ao atual — nenhuma mudança pros filtros existentes (cidade, tipo, preço etc., que continuam combináveis com o filtro de raio).

## Mobile

### Nova dependência: `expo-location`

Pega a posição atual do dispositivo (`getCurrentPositionAsync`), com pedido de permissão (`requestForegroundPermissionsAsync`) antes de usar. Como a API do Expo muda entre versões (aviso já conhecido do `mobile/AGENTS.md`), a implementação vai conferir a documentação da versão instalada (SDK 56) antes de escrever essas chamadas, mesmo processo já usado para `expo-image-picker`/`expo-image-manipulator`.

### Tela de busca (`app/(tabs)/index.tsx`)

Ganha um filtro "Perto de mim" (toggle ou botão) com seletor de raio (5/10/20 km). Ao ativar: pede permissão de localização, pega a posição atual, envia `lat`/`lng`/`radiusKm` junto dos filtros já existentes (`q`, `city`). Se a permissão for negada, mostra uma mensagem e mantém a busca normal sem o filtro de proximidade (não trava a tela). Cards de resultado mostram a distância (`"3,2 km"`) quando a busca é geoespacial.

### `services/properties.ts`

`PropertySearchFilters` ganha `lat?`, `lng?`, `radiusKm?`; `Property`/item de resultado ganha `distanceKm?: number`.

## Testes

- Backend: unit tests em `geocoding.service.spec.ts` (mockando `fetch`) e extensão de `property.service.spec.ts` (geocodificação chamada em `create`, só re-chamada em `update` quando endereço muda); e2e em `property.e2e-spec.ts` cobrindo busca por raio com fixtures em cidades/coordenadas conhecidas (a suíte mocka `GeocodingService` via `.overrideProvider`, igual ao padrão já usado pro `CloudinaryService`, pra não depender do Nominatim de verdade nos testes).
- Mobile: sem suíte automatizada — verificação via `tsc --noEmit`.

## Riscos / decisões em aberto

- Nominatim tem limite de 1 req/s e política de uso que desaconselha volume alto sem self-hosting — aceitável pro volume esperado nesta fase; se o app crescer muito, migrar pra um provedor pago fica como evolução futura.
- Imóveis cadastrados antes desta fase não têm coordenadas — não há backfill automático nesta fase (ficariam de fora da busca por proximidade até serem editados, o que já re-dispara a geocodificação).
