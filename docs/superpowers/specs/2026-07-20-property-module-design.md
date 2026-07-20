# Módulo de Imóveis (Property) — Design

Data: 2026-07-20

## Contexto

Backend tem auth completo (registro/login/JWT, roles `buyer_tenant`/`owner`/`broker`) e mobile tem as telas de auth prontas. O placeholder da home mobile (`app/(tabs)/index.tsx`) já aponta o próximo passo: "Busca de imóveis". Este documento cobre a primeira fatia do módulo de imóveis: cadastro (CRUD) e busca com filtros básicos. Fotos, geolocalização/mapa (apesar do Postgres já rodar com PostGIS), favoritos e tela de cadastro no mobile ficam para fases seguintes.

## Escopo desta fase

- CRUD de imóveis no backend, restrito a `owner`/`broker` para escrita.
- Busca/listagem paginada com filtros básicos (cidade, tipo, transação, faixa de preço, quartos, texto livre).
- Tela de busca + tela de detalhe no mobile (sem tela de cadastro/edição no mobile ainda — testado via API por enquanto).
- `RolesGuard` genérico em `shared/`, já que hoje só existe controle de autenticação (`JwtAuthGuard`), não de autorização por role.

Fora de escopo (fases futuras): upload/armazenamento de fotos, busca geoespacial com PostGIS, favoritos, tela mobile de cadastro/edição de anúncio, fluxo de status com rascunho/vendido/alugado (usamos só `isActive` por enquanto).

## Modelo de dados

Nova entidade `Property`, estendendo `BaseEntity` (mesmo padrão de `User`: UUID gerado, `createdAt`/`updatedAt` herdados).

```ts
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

@Entity('properties')
export class Property extends BaseEntity {
  title: string;
  description: string;

  type: PropertyType;            // enum column
  transactionType: TransactionType; // enum column

  price: number;                 // decimal
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;

  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;

  isActive: boolean;             // default true

  ownerId: string;                // FK -> User.id
  owner: User;                    // ManyToOne, lazy não necessário (poucos casos)
}
```

Índice em `city` e `type` para acelerar filtros de busca (via `@Index`).

## API

Módulo `PropertyModule` (`src/modules/properties/`), seguindo a mesma estrutura do `AuthModule`: `property.controller.ts`, `property.service.ts`, `property.module.ts`, `entity/property.entity.ts`, `dto/`.

Todas as rotas atrás de `JwtAuthGuard` (nenhum endpoint público nesta fase — a busca já exige usuário logado, consistente com o app hoje).

Novo `shared/guards/roles.guard.ts` + `shared/decorators/roles.decorator.ts` (`@Roles(UserRole.OWNER, UserRole.BROKER)`), reutilizável por outros módulos no futuro.

| Método | Rota | Guard | Regra adicional |
|---|---|---|---|
| POST | `/api/v1/properties` | Jwt + Roles(owner, broker) | `ownerId` = usuário autenticado |
| GET | `/api/v1/properties` | Jwt | Paginado + filtros |
| GET | `/api/v1/properties/:id` | Jwt | 404 se não existe |
| PATCH | `/api/v1/properties/:id` | Jwt + Roles(owner, broker) | Serviço valida `ownerId === user.id`, senão 403 |
| DELETE | `/api/v1/properties/:id` | Jwt + Roles(owner, broker) | Mesma checagem de dono; remove o registro |

### DTOs

- `CreatePropertyDto` — todos os campos obrigatórios do domínio (exceto os com default/nullable).
- `UpdatePropertyDto` — `PartialType(CreatePropertyDto)`, mais `isActive?: boolean`.
- `SearchPropertyQueryDto` — `city?`, `type?`, `transactionType?`, `minPrice?`, `maxPrice?`, `bedrooms?`, `q?`, `page? = 1`, `limit? = 20` (máx. 50).
- `PropertyResponseDto` — reflete a entidade (sem expor nada sensível; `owner` sensível — response inclui só `ownerId`, `ownerName`).

### Busca

`GET /properties` monta um `QueryBuilder` do TypeORM: filtros exatos (`city`, `type`, `transactionType`), `price BETWEEN minPrice AND maxPrice` quando informados, `bedrooms >= :bedrooms`, `q` faz `ILIKE` em `title` OU `description`. Resposta:

```ts
{ items: PropertyResponseDto[], total: number, page: number, limit: number }
```

## Mobile

- `services/properties.ts` — `propertyApi` (mesmo padrão de `authApi` em `services/api.ts`), com `search(filters)` e `getById(id)`.
- `app/(tabs)/index.tsx` — substitui o placeholder pela tela de busca: campo de texto + filtros (cidade, tipo, transação, faixa de preço) + lista paginada (scroll infinito ou "carregar mais", a definir na implementação).
- `app/property/[id].tsx` — tela de detalhe (rota fora do grupo `(tabs)`, navegação via `router.push`).
- Sem novo store Zustand — estado de busca é local à tela (`useState`/`useEffect`), não é compartilhado entre telas como o auth.

## Testes

- `backend/test/property.e2e-spec.ts`: criar (owner/broker OK, buyer_tenant → 403), listar com cada filtro, editar (dono OK, outro usuário → 403), excluir (dono OK, outro usuário → 403), 404 para id inexistente.
- Unit tests (`property.service.spec.ts`) apenas onde a lógica de query/autorização não for trivialmente coberta pelo e2e (ex.: montagem do `QueryBuilder` com múltiplos filtros combinados).
- Mobile: sem testes automatizados nesta fase (projeto não tem suíte de testes mobile hoje, só `tsc --noEmit` no CI).

## Riscos / decisões em aberto

- Paginação é offset-based (`page`/`limit`), simples para o volume inicial; migrar para cursor-based só se necessário mais adiante.
- `RolesGuard` novo é infraestrutura compartilhada, não específica de imóveis — cabe aqui porque é pré-requisito direto para autorizar os endpoints de escrita deste módulo.
