# Cadastro/Edição de Imóveis no Mobile — Design

Data: 2026-07-21

## Contexto

O módulo de imóveis (backend CRUD + busca/detalhe no mobile) já está em produção (`docs/superpowers/specs/2026-07-20-property-module-design.md`). Cadastro e edição de anúncios só eram possíveis via API direta. Esta fase adiciona a experiência completa de gerenciamento de anúncios no app mobile para `owner`/`broker`.

## Escopo desta fase

- Endpoint backend `GET /properties/mine` (imóveis do usuário autenticado, ativos e inativos).
- Nova aba "Meus anúncios" no mobile (visível só para `owner`/`broker`), listando os próprios anúncios.
- Tela única de formulário para criar e editar anúncio, com switch de ativo/inativo e exclusão (na edição).
- Autopreenchimento de endereço via CEP (API pública ViaCEP), só no mobile — nenhuma mudança no backend para isso.

Fora de escopo: fotos, busca geoespacial/mapa, favoritos, fluxo de rascunho/aprovação — permanecem adiados conforme a fase anterior.

## Backend

### `GET /properties/mine`

- Guards: `JwtAuthGuard` + `RolesGuard` com `@Roles(UserRole.OWNER, UserRole.BROKER)` — mesma autorização de criar.
- `ownerId` vem de `@CurrentUser().id` (JWT), nunca de query param — impede um usuário consultar anúncios de outro.
- Sem filtro `isActive`: retorna ativos e inativos, já que é uma visão de gerenciamento do próprio usuário.
- Paginado, mesma forma de resposta dos outros endpoints: `{ items, total, page, limit }`.
- **Ordem de rotas:** deve ser declarado no controller **antes** de `GET /properties/:id`, senão o NestJS tenta casar `/properties/mine` com o parâmetro `:id` e o `ParseUUIDPipe` rejeita com 400.
- `PropertyService` ganha `findMine(ownerId: string, page: number, limit: number)`, usando o mesmo `QueryBuilder` sem os filtros de busca pública (city/type/etc.), apenas `WHERE ownerId = :ownerId ORDER BY createdAt DESC`.

Nenhuma outra rota muda. `POST`, `PATCH`, `DELETE` já existem e são reaproveitados como estão.

## Mobile

### Navegação

- `app/(tabs)/_layout.tsx`: adiciona um segundo `<Tabs.Screen name="my-listings">`, renderizado condicionalmente (`user?.role !== 'buyer_tenant'`) — buyer_tenant não vê a aba.

### `app/(tabs)/my-listings.tsx`

- Lista os imóveis do usuário via `propertyApi.getMine()`.
- Cada item mostra um indicador visual de inativo (ex.: opacidade reduzida + badge "Inativo").
- Botão "+" no topo abrindo `app/property/form.tsx` sem parâmetro `id` (modo criação).
- Toque em um item abre `app/property/form.tsx?id=...` (modo edição).

### `app/property/form.tsx`

Tela única para criar e editar, decidindo o modo pela presença do parâmetro `id`:

- **Sem `id` (criação):** formulário vazio, botão "Publicar" chama `propertyApi.create(dto)`.
- **Com `id` (edição):** busca o imóvel via `propertyApi.getById(id)` para preencher o formulário, botão "Salvar" chama `propertyApi.update(id, dto)`. Inclui switch "Anúncio ativo" (mapeado para `isActive`) e botão "Excluir anúncio" chamando `propertyApi.remove(id)` com confirmação via `Alert.alert` com dois botões (Cancelar/Excluir) — o app hoje só usa `Alert.alert` de botão único para erros, então este é o primeiro uso de confirmação de duas opções, usando a API padrão do React Native (`Alert.alert(title, message, [{text, style}, ...])`).

Campos do formulário = exatamente os do `CreatePropertyDto`/`UpdatePropertyDto` (título, descrição, tipo, transação, preço, quartos, banheiros, área, rua, número, bairro, cidade, estado, CEP). Tipo e transação usam o padrão de seleção em cards de `app/(auth)/profile-select.tsx` (não existe componente de dropdown no app; não introduzo um novo padrão de UI para isso).

**Autopreenchimento por CEP:** ao completar 8 dígitos no campo CEP (ou perder o foco), faz `GET https://viacep.com.br/ws/{cep}/json/` (API pública, sem autenticação) e, se a resposta não tiver `erro: true`, preenche `street`/`neighborhood`/`city`/`state` a partir de `logradouro`/`bairro`/`localidade`/`uf` — os campos continuam editáveis manualmente depois. Falha de rede ou CEP inválido não bloqueia o formulário, apenas não preenche nada.

### `services/properties.ts`

Adiciona:
```ts
create: (dto: CreatePropertyInput) => api.post<Property>('/properties', dto)
update: (id: string, dto: UpdatePropertyInput) => api.patch<Property>(`/properties/${id}`, dto)
remove: (id: string) => api.delete(`/properties/${id}`)
getMine: (page?: number) => api.get<PropertySearchResult>('/properties/mine', { params: { page } })
```

## Testes

- Backend: `test/property.e2e-spec.ts` ganha casos para `GET /properties/mine` — retorna só os do usuário autenticado, inclui inativos, 403 para `buyer_tenant`, 401 sem token. Unit test em `property.service.spec.ts` para `findMine`.
- Mobile: sem suíte de testes automatizados (mesma situação da fase anterior) — verificação via `tsc --noEmit`, que é o único gate de CI mobile hoje.

## Riscos / decisões em aberto

- ViaCEP é uma dependência externa opcional — se ficar fora do ar, o autopreenchimento simplesmente não funciona e o usuário preenche manualmente; não há fallback de cache nem retry automático nesta fase.
- `findMine` não tem os filtros de busca pública (city/type/etc.) — é intencionalmente mais simples, já que é "meus anúncios", não uma busca.
