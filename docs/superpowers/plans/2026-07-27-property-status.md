# Fluxo de Status do Imóvel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Property.isActive: boolean` with a three-state `Property.status: PropertyStatus` (`draft` | `published` | `closed`) across backend and mobile.

**Architecture:** Add a `PropertyStatus` enum to the backend entity, thread it through the create/update DTOs and the response DTO, and change the public search filter from `isActive = true` to `status = 'published'`. No transition validation — the owner can set any status at any time. Mobile mirrors the enum, swaps the "Anúncio ativo" switch for a 3-option picker on the edit form, and updates the status badges on "Meus anúncios" and "Favoritos".

**Tech Stack:** NestJS 11 + TypeORM 0.3 (Postgres, `synchronize: true`) backend; Expo Router ~56 + React Native + TypeScript mobile.

## Global Constraints

- `PropertyStatus` enum values are exactly `draft`, `published`, `closed` (backend and mobile).
- Default status on creation (when omitted) is `published` — same visible behavior as the current `isActive: true` default.
- No transition validation anywhere — `UpdatePropertyDto.status` accepts any enum value regardless of current status.
- `GET /properties` (public search) filters to `status = 'published'` only. `GET /properties/mine` and `GET /properties/favorites` do NOT filter by status (same as today).
- `synchronize: true`, no manual migrations — the column swap happens automatically on next backend start.
- Mobile status picker's third option label is "Vendido" when `transactionType = sale`, "Alugado" when `transactionType = rent`.
- Mobile has no automated test suite — verify mobile changes with `npx tsc --noEmit` from the `mobile/` directory.
- Backend unit tests (`property.service.spec.ts`) are runnable locally via `npm test` from `backend/` (mocked repos, no DB required). Backend e2e tests (`property.e2e-spec.ts`) require Postgres and cannot run in this sandbox — verify with `npx tsc --noEmit -p test/tsconfig.json` if available, otherwise a careful read-through; real confirmation comes from CI after push.

---

### Task 1: Backend — `PropertyStatus` enum, entity, DTOs, service filter, unit tests

**Files:**
- Modify: `backend/src/modules/properties/property.entity.ts`
- Modify: `backend/src/modules/properties/dto/create-property.dto.ts`
- Modify: `backend/src/modules/properties/dto/update-property.dto.ts`
- Modify: `backend/src/modules/properties/dto/property-response.dto.ts`
- Modify: `backend/src/modules/properties/property.service.ts`
- Modify: `backend/src/modules/properties/property.service.spec.ts`

**Interfaces:**
- Produces: `PropertyStatus` enum (`DRAFT = 'draft'`, `PUBLISHED = 'published'`, `CLOSED = 'closed'`) exported from `property.entity.ts`, imported by every other file in this task and by Task 2/3.
- Produces: `Property.status: PropertyStatus` (entity column, default `PropertyStatus.PUBLISHED`), replacing `Property.isActive: boolean`.
- Produces: `CreatePropertyDto.status?: PropertyStatus`, `UpdatePropertyDto.status?: PropertyStatus`, `PropertyResponseDto.status: PropertyStatus`.

- [ ] **Step 1: Add the `PropertyStatus` enum and replace the `isActive` column in the entity**

In `backend/src/modules/properties/property.entity.ts`, add the enum right after the existing `TransactionType` enum:

```ts
export enum TransactionType {
  SALE = 'sale',
  RENT = 'rent',
}

export enum PropertyStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CLOSED = 'closed',
}
```

Then replace:

```ts
  @Column({ default: true })
  isActive: boolean;
```

with:

```ts
  @Column({ type: 'enum', enum: PropertyStatus, default: PropertyStatus.PUBLISHED })
  status: PropertyStatus;
```

- [ ] **Step 2: Add `status` to `CreatePropertyDto`**

In `backend/src/modules/properties/dto/create-property.dto.ts`, change the import:

```ts
import { PropertyType, TransactionType } from '../property.entity';
```

to:

```ts
import { PropertyType, TransactionType, PropertyStatus } from '../property.entity';
```

Add this field at the end of the class, after `zipCode`:

```ts
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;
```

- [ ] **Step 3: Replace `isActive` with `status` in `UpdatePropertyDto`**

In `backend/src/modules/properties/dto/update-property.dto.ts`, change the import:

```ts
import {
  IsString, IsEnum, IsNumber, IsInt, IsOptional, IsBoolean, Min, Length, Matches, MinLength,
} from 'class-validator';
import { PropertyType, TransactionType } from '../property.entity';
```

to:

```ts
import {
  IsString, IsEnum, IsNumber, IsInt, IsOptional, Min, Length, Matches, MinLength,
} from 'class-validator';
import { PropertyType, TransactionType, PropertyStatus } from '../property.entity';
```

(`IsBoolean` is dropped — nothing else in this file uses it.)

Replace:

```ts
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
```

with:

```ts
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;
```

- [ ] **Step 4: Replace `isActive` with `status` in `PropertyResponseDto`**

In `backend/src/modules/properties/dto/property-response.dto.ts`, change the import:

```ts
import { Property, PropertyType, TransactionType } from '../property.entity';
```

to:

```ts
import { Property, PropertyType, TransactionType, PropertyStatus } from '../property.entity';
```

Replace the field declaration:

```ts
  isActive: boolean;
```

with:

```ts
  status: PropertyStatus;
```

Replace the assignment in `fromEntity`:

```ts
    dto.isActive = property.isActive;
```

with:

```ts
    dto.status = property.status;
```

- [ ] **Step 5: Write failing unit tests for the new `status`-based behavior**

In `backend/src/modules/properties/property.service.spec.ts`, change the entity import at the top:

```ts
import { Property, PropertyType, TransactionType } from './property.entity';
```

to:

```ts
import { Property, PropertyType, TransactionType, PropertyStatus } from './property.entity';
```

Add this test inside the existing `describe('create', ...)` block, after the `'should save with null coordinates when geocoding finds nothing'` test:

```ts
    it('should pass a provided status straight through to the repository', async () => {
      const draftDto = { ...dto, status: PropertyStatus.DRAFT };
      const created = {
        ...draftDto, ownerId: 'owner-1', id: 'prop-1', latitude: null, longitude: null,
      } as unknown as Property;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      await service.create(draftDto, 'owner-1');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: PropertyStatus.DRAFT }),
      );
    });
```

Add this test inside the existing `describe('search', ...)` block, after the `'should default the radius to 10km when not provided'` test:

```ts
    it('should filter to published properties only', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.search({});

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'property.status = :status',
        { status: PropertyStatus.PUBLISHED },
      );
    });
```

Add this test inside the existing `describe('update', ...)` block, after the `'should re-geocode when an address field changes'` test:

```ts
    it('should accept any status transition without validation', async () => {
      const existing = {
        id: 'prop-1', ownerId: 'owner-1', status: PropertyStatus.PUBLISHED,
        street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipCode: '80000-000',
      } as Property;
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.update('prop-1', 'owner-1', { status: PropertyStatus.DRAFT });

      expect(result.status).toBe(PropertyStatus.DRAFT);
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'prop-1', status: PropertyStatus.DRAFT }),
      );
    });
```

- [ ] **Step 6: Run tests to verify the new `search` test fails**

Run: `npm test -- property.service.spec.ts` (from `backend/`)
Expected: FAIL — only the new `search` test fails, because `property.service.ts` still builds the query with `'property.isActive = :isActive'` while the test now asserts `'property.status = :status'`. The new `create` and `update` tests pass already: `create()` spreads `...dto` through untouched, and `update()`'s `Object.assign(property, dto)` accepts any field — neither needed a code change, only the entity/DTO groundwork from Steps 1-4.

- [ ] **Step 7: Update `property.service.ts`'s search filter**

In `backend/src/modules/properties/property.service.ts`, change the import:

```ts
import { Property } from './property.entity';
```

to:

```ts
import { Property, PropertyStatus } from './property.entity';
```

Replace:

```ts
    const qb = this.propertyRepo
      .createQueryBuilder('property')
      .where('property.isActive = :isActive', { isActive: true });
```

with:

```ts
    const qb = this.propertyRepo
      .createQueryBuilder('property')
      .where('property.status = :status', { status: PropertyStatus.PUBLISHED });
```

- [ ] **Step 8: Run tests to verify they all pass**

Run: `npm test -- property.service.spec.ts` (from `backend/`)
Expected: PASS — all tests in the file green, including the three new ones.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/properties/property.entity.ts backend/src/modules/properties/dto/create-property.dto.ts backend/src/modules/properties/dto/update-property.dto.ts backend/src/modules/properties/dto/property-response.dto.ts backend/src/modules/properties/property.service.ts backend/src/modules/properties/property.service.spec.ts
git commit -m "feat: replace Property.isActive with PropertyStatus enum"
```

---

### Task 2: Backend — update e2e fixtures and assertions for `status`

**Files:**
- Modify: `backend/test/property.e2e-spec.ts`

**Interfaces:**
- Consumes: `PropertyStatus` values `'draft'` / `'published'` / `'closed'` (as raw strings over HTTP — the e2e spec never imports the enum, it sends/reads JSON) from Task 1.

- [ ] **Step 1: Rename the inactive-property fixture variable and add a draft fixture variable**

In `backend/test/property.e2e-spec.ts`, replace:

```ts
  let mutableId: string;
  let inactivePropertyId: string;
```

with:

```ts
  let mutableId: string;
  let closedPropertyId: string;
  let draftPropertyId: string;
```

- [ ] **Step 2: Replace the inactive-property fixture setup with a closed-property fixture plus a new draft-property fixture**

Replace:

```ts
    const inactiveProperty = await createAsOwner({
      title: 'Sala comercial fechada temporariamente',
      description: 'Sala comercial atualmente fora do mercado, aguardando reforma.',
      type: 'commercial',
      transactionType: 'rent',
      price: 3000,
      street: 'Rua Sete de Setembro',
      number: '45',
      neighborhood: 'Centro',
      city: 'Porto Alegre',
      state: 'RS',
      zipCode: '90010-000',
    });
    inactivePropertyId = inactiveProperty.body.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/properties/${inactivePropertyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false });
  });
```

with:

```ts
    const closedProperty = await createAsOwner({
      title: 'Sala comercial fechada temporariamente',
      description: 'Sala comercial atualmente fora do mercado, aguardando reforma.',
      type: 'commercial',
      transactionType: 'rent',
      price: 3000,
      street: 'Rua Sete de Setembro',
      number: '45',
      neighborhood: 'Centro',
      city: 'Porto Alegre',
      state: 'RS',
      zipCode: '90010-000',
    });
    closedPropertyId = closedProperty.body.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/properties/${closedPropertyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'closed' });

    const draftProperty = await createAsOwner({
      title: 'Apartamento ainda não publicado',
      description: 'Apartamento em fase de elaboração do anúncio, ainda não publicado.',
      type: 'apartment',
      transactionType: 'sale',
      price: 420000,
      street: 'Rua Marechal Deodoro',
      number: '77',
      neighborhood: 'Centro',
      city: 'Porto Alegre',
      state: 'RS',
      zipCode: '90010-001',
      status: 'draft',
    });
    draftPropertyId = draftProperty.body.id;
  });
```

- [ ] **Step 3: Update the "owner cria imóvel" assertion**

Replace:

```ts
    expect(res.body.isActive).toBe(true);
```

with:

```ts
    expect(res.body.status).toBe('published');
```

- [ ] **Step 4: Add a dedicated test for the search status filter**

Insert this new test right after `'GET /api/v1/properties — sem lat/lng mantém a ordenação por data, sem filtro de raio'` and before `'GET /api/v1/properties/:id — retorna o imóvel'`:

```ts
  it('GET /api/v1/properties — não retorna imóveis em rascunho ou fechados', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(draftPropertyId);
    expect(ids).not.toContain(closedPropertyId);
  });
```

- [ ] **Step 5: Update the `/mine` "includes inactive" test**

Replace:

```ts
  it('GET /api/v1/properties/mine — retorna os imóveis do dono autenticado, incluindo inativos', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties/mine')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([spFlatId, spHouseId, rioFlatId, curitibaLandId, inactivePropertyId]),
    );
  });
```

with:

```ts
  it('GET /api/v1/properties/mine — retorna os imóveis do dono autenticado, incluindo rascunhos e fechados', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties/mine')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([spFlatId, spHouseId, rioFlatId, curitibaLandId, draftPropertyId, closedPropertyId]),
    );
  });
```

- [ ] **Step 6: Update the `/mine` "does not return other user's properties" test**

Replace:

```ts
    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(spFlatId);
    expect(ids).not.toContain(inactivePropertyId);
  });
```

with:

```ts
    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(spFlatId);
    expect(ids).not.toContain(closedPropertyId);
  });
```

- [ ] **Step 7: Verify the file compiles**

Run: `npx tsc --noEmit -p test/tsconfig.json` if `backend/test/tsconfig.json` exists, otherwise `npx tsc --noEmit` from `backend/` and confirm no new errors reference `property.e2e-spec.ts`.
Expected: no TypeScript errors. (This test file needs a live Postgres to actually execute — that verification happens in CI after push, per this project's established constraint.)

- [ ] **Step 8: Commit**

```bash
git add backend/test/property.e2e-spec.ts
git commit -m "test: update property e2e fixtures for draft/published/closed status"
```

---

### Task 3: Mobile — `PropertyStatus` enum and type updates in `services/properties.ts`

**Files:**
- Modify: `mobile/services/properties.ts`

**Interfaces:**
- Produces: `PropertyStatus` enum (`DRAFT = 'draft'`, `PUBLISHED = 'published'`, `CLOSED = 'closed'`), `Property.status: PropertyStatus`, `UpdatePropertyInput.status?: PropertyStatus` — consumed by Task 4 and Task 5.

- [ ] **Step 1: Add the `PropertyStatus` enum**

In `mobile/services/properties.ts`, add this enum right after the existing `TransactionType` enum:

```ts
export enum TransactionType {
  SALE = 'sale',
  RENT = 'rent',
}

export enum PropertyStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CLOSED = 'closed',
}
```

- [ ] **Step 2: Replace `isActive` with `status` on the `Property` interface**

Replace:

```ts
  isActive: boolean;
```

with:

```ts
  status: PropertyStatus;
```

- [ ] **Step 3: Replace `isActive` with `status` on `UpdatePropertyInput`**

Replace:

```ts
export interface UpdatePropertyInput extends Partial<PropertyInput> {
  isActive?: boolean;
}
```

with:

```ts
export interface UpdatePropertyInput extends Partial<PropertyInput> {
  status?: PropertyStatus;
}
```

- [ ] **Step 4: Verify the file compiles on its own**

Run: `npx tsc --noEmit` (from `mobile/`)
Expected: New errors appear in `mobile/app/property/form.tsx`, `mobile/app/(tabs)/my-listings.tsx`, and `mobile/app/(tabs)/favorites.tsx` (they still reference `isActive`) — this is expected here and gets fixed in Tasks 4 and 5. No errors should appear in `mobile/services/properties.ts` itself.

- [ ] **Step 5: Commit**

```bash
git add mobile/services/properties.ts
git commit -m "feat: replace Property.isActive with PropertyStatus in mobile types"
```

---

### Task 4: Mobile — status picker on the property edit form

**Files:**
- Modify: `mobile/app/property/form.tsx`

**Interfaces:**
- Consumes: `PropertyStatus` enum, `Property.status`, `UpdatePropertyInput.status` from Task 3.

- [ ] **Step 1: Import `PropertyStatus` and add the status option list**

Replace:

```ts
import { propertyApi, PropertyType, TransactionType } from '../../services/properties';
```

with:

```ts
import { propertyApi, PropertyType, TransactionType, PropertyStatus } from '../../services/properties';
```

Add this right after the existing `TRANSACTION_OPTIONS` constant:

```ts
const TRANSACTION_OPTIONS = [
  { key: TransactionType.SALE, label: 'Venda' },
  { key: TransactionType.RENT, label: 'Aluguel' },
];

const STATUS_OPTIONS = (transactionType: TransactionType) => [
  { key: PropertyStatus.DRAFT, label: 'Rascunho' },
  { key: PropertyStatus.PUBLISHED, label: 'Publicado' },
  { key: PropertyStatus.CLOSED, label: transactionType === TransactionType.RENT ? 'Alugado' : 'Vendido' },
];
```

- [ ] **Step 2: Replace the `Switch` import with nothing extra needed (remove `Switch`, it's no longer used)**

Replace:

```ts
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
```

with:

```ts
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
```

- [ ] **Step 3: Replace the `isActive` state with `status` state**

Replace:

```ts
  const [isActive, setIsActive] = useState(true);
```

with:

```ts
  const [status, setStatus] = useState<PropertyStatus>(PropertyStatus.PUBLISHED);
```

- [ ] **Step 4: Update the load effect to set `status` instead of `isActive`**

Replace:

```ts
        setIsActive(data.isActive);
```

with:

```ts
        setStatus(data.status);
```

- [ ] **Step 5: Update `handleSubmit` to send `status` instead of `isActive`**

Replace:

```ts
        await propertyApi.update(id, { ...buildPayload(), isActive });
```

with:

```ts
        await propertyApi.update(id, { ...buildPayload(), status });
```

- [ ] **Step 6: Replace the "Anúncio ativo" switch with the 3-option status picker**

Replace:

```tsx
      {isEditing ? (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Anúncio ativo</Text>
          <Switch value={isActive} onValueChange={setIsActive} />
        </View>
      ) : null}
```

with:

```tsx
      {isEditing ? (
        <>
          <Text style={styles.sectionLabel}>Status</Text>
          <View style={styles.optionsRow}>
            {STATUS_OPTIONS(transactionType).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.option, status === opt.key && styles.optionSelected]}
                onPress={() => setStatus(opt.key)}
              >
                <Text style={[styles.optionText, status === opt.key && styles.optionTextSelected]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}
```

- [ ] **Step 7: Remove the now-unused `switchRow`/`switchLabel` styles**

Replace:

```ts
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, paddingVertical: 8,
  },
  switchLabel: { fontSize: 15, color: '#111827', fontWeight: '600' },
  deleteButtonWrapper: { marginTop: 4 },
```

with:

```ts
  deleteButtonWrapper: { marginTop: 4 },
```

- [ ] **Step 8: Verify the file compiles**

Run: `npx tsc --noEmit` (from `mobile/`)
Expected: no errors referencing `form.tsx`. Errors may still appear in `my-listings.tsx`/`favorites.tsx` until Task 5.

- [ ] **Step 9: Commit**

```bash
git add mobile/app/property/form.tsx
git commit -m "feat: replace active switch with status picker on property edit form"
```

---

### Task 5: Mobile — status badges on "Meus anúncios" and "Favoritos"

**Files:**
- Modify: `mobile/app/(tabs)/my-listings.tsx`
- Modify: `mobile/app/(tabs)/favorites.tsx`

**Interfaces:**
- Consumes: `PropertyStatus` enum, `Property.status` from Task 3.

- [ ] **Step 1: Add the status badge helper and import in `my-listings.tsx`**

In `mobile/app/(tabs)/my-listings.tsx`, replace:

```ts
import { propertyApi, Property } from '../../services/properties';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };
```

with:

```ts
import { propertyApi, Property, PropertyStatus } from '../../services/properties';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };

function statusBadgeLabel(item: Property): string | null {
  if (item.status === PropertyStatus.DRAFT) return 'Rascunho';
  if (item.status === PropertyStatus.CLOSED) return item.transactionType === 'rent' ? 'Alugado' : 'Vendido';
  return null;
}
```

- [ ] **Step 2: Use the helper in the card renderer**

Replace:

```tsx
          <TouchableOpacity
            style={[styles.card, !item.isActive && styles.cardInactive]}
            onPress={() => router.push({ pathname: '/property/form', params: { id: item.id } })}
          >
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
            {!item.isActive ? <Text style={styles.badge}>Inativo</Text> : null}
```

with:

```tsx
          <TouchableOpacity
            style={[styles.card, item.status !== PropertyStatus.PUBLISHED && styles.cardInactive]}
            onPress={() => router.push({ pathname: '/property/form', params: { id: item.id } })}
          >
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
            {statusBadgeLabel(item) ? <Text style={styles.badge}>{statusBadgeLabel(item)}</Text> : null}
```

- [ ] **Step 3: Add the same helper and import in `favorites.tsx`**

In `mobile/app/(tabs)/favorites.tsx`, replace:

```ts
import { propertyApi, Property } from '../../services/properties';
import { useFavoritesStore } from '../../stores/favorites.store';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };
```

with:

```ts
import { propertyApi, Property, PropertyStatus } from '../../services/properties';
import { useFavoritesStore } from '../../stores/favorites.store';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };

function statusBadgeLabel(item: Property): string | null {
  if (item.status === PropertyStatus.DRAFT) return 'Rascunho';
  if (item.status === PropertyStatus.CLOSED) return item.transactionType === 'rent' ? 'Alugado' : 'Vendido';
  return null;
}
```

- [ ] **Step 4: Use the helper in the card renderer**

Replace:

```tsx
          <TouchableOpacity
            style={[styles.card, !item.isActive && styles.cardInactive]}
            onPress={() => router.push({ pathname: '/property/[id]', params: { id: item.id } })}
          >
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
            <TouchableOpacity style={styles.heartButton} onPress={() => handleRemove(item.id)}>
              <Text style={styles.heartIcon}>♥</Text>
            </TouchableOpacity>
            {!item.isActive ? <Text style={styles.badge}>Inativo</Text> : null}
```

with:

```tsx
          <TouchableOpacity
            style={[styles.card, item.status !== PropertyStatus.PUBLISHED && styles.cardInactive]}
            onPress={() => router.push({ pathname: '/property/[id]', params: { id: item.id } })}
          >
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
            <TouchableOpacity style={styles.heartButton} onPress={() => handleRemove(item.id)}>
              <Text style={styles.heartIcon}>♥</Text>
            </TouchableOpacity>
            {statusBadgeLabel(item) ? <Text style={styles.badge}>{statusBadgeLabel(item)}</Text> : null}
```

- [ ] **Step 5: Verify both files compile, with no remaining `isActive` references anywhere in `mobile/`**

Run: `npx tsc --noEmit` (from `mobile/`)
Expected: no errors.

Run: search for `isActive` across `mobile/` (e.g. `grep -r isActive mobile/` or equivalent) — expect zero matches.

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(tabs)/my-listings.tsx" "mobile/app/(tabs)/favorites.tsx"
git commit -m "feat: show status badge (rascunho/vendido/alugado) on listing cards"
```

---
