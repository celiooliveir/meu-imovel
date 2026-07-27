# Fluxo de Status do Imóvel — Design

Data: 2026-07-27

## Contexto

Segunda de cinco fases pequenas planejadas em sequência (favoritos ✅, status mais rico, KYC, chat/notificações, reordenar fotos). Hoje um imóvel só tem `isActive: boolean` — esta fase substitui isso por um status com três estados reais: rascunho, publicado, fechado (vendido/alugado).

## Escopo

- Substituir `isActive: boolean` por `status: PropertyStatus` (`draft` | `published` | `closed`).
- Busca pública só mostra imóveis publicados.
- Sem regra de transição — o dono muda pra qualquer status a qualquer momento.
- Mobile: seletor de status na edição, badges atualizados em "Meus anúncios" e "Favoritos".

Fora de escopo: notificar quem favoritou quando um imóvel muda de status, histórico de mudanças de status, status diferentes por transação (ex: "vendido" e "alugado" como valores separados no enum — usamos um único `closed` e derivamos o rótulo da UI a partir de `transactionType`).

## Backend

### `PropertyStatus` (novo enum, em `property.entity.ts`)

```ts
export enum PropertyStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CLOSED = 'closed',
}
```

`Property.isActive` é removido; `Property.status: PropertyStatus` (default `PUBLISHED`) toma seu lugar.

### DTOs

- `CreatePropertyDto` ganha `status?: PropertyStatus` opcional — se omitido, o backend usa `PUBLISHED` (mesmo comportamento de hoje). Permite criar já como rascunho se o dono quiser.
- `UpdatePropertyDto` troca `isActive?: boolean` por `status?: PropertyStatus`. Sem validação de transição — qualquer valor é aceito a qualquer momento.
- `PropertyResponseDto` troca `isActive: boolean` por `status: PropertyStatus`.

### Busca (`GET /properties`)

O filtro que hoje é `WHERE isActive = true` vira `WHERE status = 'published'`. Nenhuma outra mudança na busca — filtros combináveis, paginação, ordenação por distância etc. continuam iguais.

`GET /properties/mine` e `GET /properties/favorites` continuam sem filtrar por status (mesmo comportamento de hoje, que já mostrava inativos).

### Dados existentes

O projeto usa `synchronize: true` (sem migrations manuais) e ainda não tem dados de produção reais — a troca de coluna é direta via `synchronize`, sem necessidade de migração de dados.

## Mobile

- Tela de edição (`app/property/form.tsx`): o switch "Anúncio ativo" é substituído por um seletor de 3 opções (Rascunho / Publicado / Vendido-ou-Alugado), mesmo padrão visual das cards de tipo/transação já usadas na mesma tela. O rótulo do terceiro botão é "Vendido" se `transactionType = sale`, "Alugado" se `transactionType = rent`.
- `app/(tabs)/my-listings.tsx` e `app/(tabs)/favorites.tsx`: o badge que hoje só aparece para `!isActive` ("Inativo") passa a refletir o status — "Rascunho" para `draft`, "Vendido"/"Alugado" (conforme `transactionType`) para `closed`, sem badge para `published`. O estilo de card esmaecido (`cardInactive`) se aplica a qualquer status diferente de `published`.
- `services/properties.ts`: `Property.isActive: boolean` vira `Property.status: PropertyStatus`; `PropertyInput`/`UpdatePropertyInput` acompanham a mudança.

## Testes

- Backend: `property.service.spec.ts` atualizado para os novos cenários de `status` (default ao criar, aceitar qualquer transição ao editar); `property.e2e-spec.ts` atualizado (o teste de "não retorna inativos na busca" passa a testar `status=draft` e `status=closed` separadamente).
- Mobile: sem suíte automatizada — verificação via `tsc --noEmit`.

## Riscos / decisões em aberto

- Nenhum — escopo pequeno, mudança de um campo já existente, sem dependência externa nova.
