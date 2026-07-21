# CEP Autofill Fix + Meus Anúncios Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two Minor findings deferred from the previous branch's final review: CEP autofill silently overwriting a manually-edited address on every blur, and "Meus anúncios" only ever showing the first 20 listings.

**Architecture:** Both are small, self-contained, mobile-only changes to existing screens. No backend changes — `GET /properties/mine` already supports `page`/`limit`.

**Tech Stack:** Same as the rest of the mobile app — Expo Router ~56, React Native, axios. No new dependencies.

## Global Constraints

- No backend changes in this plan.
- No new dependencies.
- Do **not** pass a `style` prop to `<Button>` or `<Input>` — both spread `{...props}` after their own internal `style` array, so a caller-supplied `style` silently replaces the component's built-in styling.
- Mobile has no test runner beyond `tsc --noEmit` — that is the required verification gate for both tasks, and it is runnable in this sandbox (no DB dependency).

---

## Task 1: Fix CEP autofill overwriting manually-edited address

**Files:**
- Modify: `mobile/app/property/form.tsx`

**Interfaces:** None — self-contained change to this screen's internal state.

- [ ] **Step 1: Add `lastCheckedZip` state and initialize it on load**

Modify `mobile/app/property/form.tsx` — add a new state declaration right after `errors`:

```tsx
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastCheckedZip, setLastCheckedZip] = useState('');
```

Then, inside the existing `useEffect` that loads the property for editing, add one line right after `setZipCode(data.zipCode);`:

```tsx
        setZipCode(data.zipCode);
        setLastCheckedZip(data.zipCode.replace(/\D/g, ''));
```

This means: in edit mode, the CEP the property already has is considered "already checked" — blurring the field without changing it won't re-trigger a lookup. In create mode, `lastCheckedZip` stays `''`, so the first valid CEP typed will always trigger a lookup as before.

- [ ] **Step 2: Skip the lookup when the CEP hasn't changed, and record the attempt**

Modify `handleZipCodeBlur` in the same file — replace it entirely with:

```tsx
  const handleZipCodeBlur = async () => {
    const digits = zipCode.replace(/\D/g, '');
    if (digits.length !== 8) return;
    if (digits === lastCheckedZip) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data: ViaCepResponse = await res.json();
      if (data.erro) return;
      if (data.logradouro) setStreet(data.logradouro);
      if (data.bairro) setNeighborhood(data.bairro);
      if (data.localidade) setCity(data.localidade);
      if (data.uf) setState(data.uf);
    } catch {
      // CEP inválido ou API fora do ar: segue com preenchimento manual
    } finally {
      setLastCheckedZip(digits);
    }
  };
```

The only changes from the current version: the new `if (digits === lastCheckedZip) return;` guard, and the `finally` block that records the digits as checked — regardless of success, "not found", or network failure, so blurring the same already-attempted CEP again doesn't refetch.

- [ ] **Step 3: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/property/form.tsx
git commit -m "fix: only autofill address from CEP when it actually changes"
```

---

## Task 2: Infinite scroll pagination in "Meus anúncios"

**Files:**
- Modify: `mobile/app/(tabs)/my-listings.tsx`

**Interfaces:** None — self-contained change to this screen, reusing `propertyApi.getMine(page?)` (already accepts a page argument, unused until now).

- [ ] **Step 1: Add pagination state and rework `load` into a paginated fetch**

Overwrite `mobile/app/(tabs)/my-listings.tsx` with the full file:

```tsx
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { propertyApi, Property } from '../../services/properties';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };

function formatPrice(price: number, transactionType: string) {
  const value = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return transactionType === 'rent' ? `${value}/mês` : value;
}

export default function MyListingsScreen() {
  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async (targetPage: number, replace: boolean) => {
    if (replace) setLoading(true);
    else setLoadingMore(true);
    try {
      const { data } = await propertyApi.getMine(targetPage);
      setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
      setPage(data.page);
      setHasMore(data.page * data.limit < data.total);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar seus anúncios');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setHasMore(true);
    load(1, true);
  }, [load]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    load(page + 1, false);
  }, [loading, loadingMore, hasMore, page, load]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Meus anúncios</Text>
      <Button title="+ Novo anúncio" onPress={() => router.push('/property/form')} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.list}
        onRefresh={refresh}
        refreshing={loading}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Você ainda não tem anúncios</Text> : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerLoader} color="#1a56db" /> : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.isActive && styles.cardInactive]}
            onPress={() => router.push({ pathname: '/property/form', params: { id: item.id } })}
          >
            {!item.isActive ? <Text style={styles.badge}>Inativo</Text> : null}
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSub}>{item.city} • {TRANSACTION_LABEL[item.transactionType]}</Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price, item.transactionType)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  list: { marginTop: 16 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 32 },
  footerLoader: { marginVertical: 16 },
  card: {
    padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 12,
  },
  cardInactive: { opacity: 0.6 },
  badge: {
    alignSelf: 'flex-start', backgroundColor: '#fee2e2', color: '#b91c1c',
    fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginBottom: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '700', color: '#1a56db', marginTop: 8 },
});
```

Key changes from the current file:
- `load(targetPage, replace)` now takes a page and a replace/append flag instead of always fetching page 1 and replacing.
- `hasMore` is derived from the response itself (`data.page * data.limit < data.total`), not a client-side guess at page size.
- `refresh()` resets to page 1 and replaces the list (used by pull-to-refresh and on screen focus).
- `loadMore()` guards against concurrent/duplicate fetches (`loading`, `loadingMore`, `hasMore`) before requesting the next page.
- `FlatList` gains `onEndReached`/`onEndReachedThreshold` (triggers `loadMore`) and a `ListFooterComponent` spinner shown only while `loadingMore` is true (distinct from the pull-to-refresh spinner, which uses `loading`).

- [ ] **Step 2: Type-check**

```bash
cd mobile
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "mobile/app/(tabs)/my-listings.tsx"
git commit -m "feat: add infinite scroll pagination to Meus anúncios"
```

- [ ] **Step 4: Manual smoke test (recommended before pushing)**

Run the backend against a local Postgres and the Expo dev server. Log in as an `owner`/`broker` with more than 20 listings (or temporarily point `getMine` at a small page size to test with fewer), open "Meus anúncios", scroll to the bottom, and confirm more items load with a footer spinner and no duplicates. Separately, on the create/edit form, type a CEP, let it autofill, manually edit the street field, blur the CEP field again without changing it, and confirm the street is not overwritten.

---

## Final Step: Push and verify CI

After both tasks are committed:

```bash
git push
```

Then check `https://github.com/celiooliveir/meu-imovel/actions` — `Mobile — TypeScript` should pass `tsc --noEmit`. No backend changes in this plan, so the `Backend — Unit + E2E` job is unaffected.
