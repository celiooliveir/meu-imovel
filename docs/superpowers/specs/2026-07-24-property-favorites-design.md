# Favoritos — Design

Data: 2026-07-24

## Contexto

Primeira de cinco fases pequenas planejadas em sequência (favoritos, status mais rico, KYC, chat/notificações, reordenar fotos). Esta fase deixa qualquer usuário autenticado salvar imóveis pra ver depois.

## Escopo

- Favoritar/desfavoritar um imóvel.
- Listar os imóveis favoritados (aba dedicada no mobile).
- Indicar visualmente (coração preenchido) quais imóveis já favoritados nos cards de busca e na tela de detalhe.

Fora de escopo: notificar o dono quando alguém favorita, ordenar/organizar favoritos em coleções, favoritar sem estar logado.

## Backend

### Nova entidade `PropertyFavorite`

```ts
@Entity('property_favorites')
@Index(['userId', 'propertyId'], { unique: true })
export class PropertyFavorite extends BaseEntity {
  userId: string;
  propertyId: string;
}
```

Sem role restrito — qualquer usuário autenticado (`owner`, `broker`, `buyer_tenant`) pode favoritar qualquer imóvel, incluindo os próprios.

### Endpoints

Novo `PropertyFavoriteController`, guards `JwtAuthGuard` apenas (sem `RolesGuard`):

| Método | Rota | Comportamento |
|---|---|---|
| POST | `/properties/:id/favorite` | Favorita. Idempotente — chamar de novo com o mesmo usuário/imóvel não cria duplicata (índice único + tratamento de conflito silencioso). |
| DELETE | `/properties/:id/favorite` | Desfavorita. Idempotente — 204 mesmo se não estava favoritado. |
| GET | `/properties/favorites` | Lista paginada dos imóveis favoritados pelo usuário autenticado, mesmo formato `{ items, total, page, limit }` de `GET /properties/mine`. |
| GET | `/properties/favorites/ids` | Lista simples (sem paginação) só dos IDs dos imóveis favoritados — usada pelo mobile pra saber quais corações pintar sem buscar os dados completos de cada imóvel. |

`GET /properties/favorites` e `/favorites/ids` **antes** de `GET /properties/:id` no controller (mesma armadilha de ordem de rota já resolvida antes pra `/properties/mine`).

## Mobile

- Nova aba **"Favoritos"**, mesmo padrão visual/paginação de "Meus anúncios", listando os imóveis favoritados.
- Ícone de coração nos cards da tela de busca e na tela de detalhe (`property/[id].tsx`), tocável — favorita/desfavorita direto, sem navegar pro anúncio.
- A tela de busca carrega o conjunto de IDs favoritados (`/properties/favorites/ids`) uma vez ao montar, pra pintar os corações preenchidos nos resultados; atualiza o conjunto localmente ao tocar num coração (sem esperar refetch).

## Testes

- Backend: unit tests em `property-favorite.service.spec.ts` (mock do repositório); e2e em um novo `backend/test/property-favorite.e2e-spec.ts` (mesmo padrão de arquivo dedicado já usado para `property-photo.e2e-spec.ts`, em vez de inchar ainda mais o já grande `property.e2e-spec.ts`) cobrindo favoritar, favoritar de novo (idempotência, sem duplicata), desfavoritar, desfavoritar sem estar favoritado (idempotência), listar só os do usuário autenticado, 401 sem token.
- Mobile: sem suíte automatizada — verificação via `tsc --noEmit`.

## Riscos / decisões em aberto

- Nenhum — escopo pequeno, sem dependência externa nova.
