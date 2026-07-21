# Follow-ups: CEP autofill + paginação em "Meus anúncios" — Design

Data: 2026-07-21

## Contexto

A revisão final da fase de cadastro/edição mobile (`docs/superpowers/specs/2026-07-21-property-crud-mobile-design.md`) deixou dois achados Minor registrados como fast-follow, não bloqueantes:

1. `handleZipCodeBlur` em `mobile/app/property/form.tsx` dispara a cada blur do campo CEP, mesmo sem alteração — pode sobrescrever silenciosamente um endereço editado manualmente pelo usuário.
2. `mobile/app/(tabs)/my-listings.tsx` chama `propertyApi.getMine()` sem paginar — só a primeira página (20 itens) é exibida, o que afeta principalmente corretores com muitos anúncios.

Esta é uma fase pequena, mobile-only, sem mudanças de backend (`GET /properties/mine` já suporta `page`/`limit`).

## Escopo

- Corrigir o autofill de CEP para só disparar quando o CEP efetivamente mudou desde a última consulta.
- Adicionar scroll infinito a "Meus anúncios".

Fora de escopo: qualquer outro item Minor da revisão anterior (parsing de preço, indicador de erro de rede mais detalhado, etc.) — não fazem parte desta fase.

## Correção 1: CEP só sobrescreve quando muda

`mobile/app/property/form.tsx` ganha um estado `lastCheckedZip: string`, inicializado com os dígitos do `zipCode` carregado (modo edição) ou string vazia (modo criação).

`handleZipCodeBlur`:
```
digits = zipCode sem não-dígitos
se digits.length !== 8: retorna (comportamento atual, inalterado)
se digits === lastCheckedZip: retorna (nada mudou desde a última consulta)
senão: consulta ViaCEP como hoje, e ao final (sucesso ou falha) atualiza lastCheckedZip = digits
```

Isso preserva o comportamento atual para o primeiro preenchimento e para CEPs realmente novos, e elimina a sobrescrita silenciosa quando o usuário só passa o foco pelo campo sem alterar o valor.

## Correção 2: Scroll infinito em "Meus anúncios"

`mobile/app/(tabs)/my-listings.tsx` ganha:

- `page: number` (inicia em 1) e `hasMore: boolean` (deriva de `items.length < total` na última resposta).
- `loadingMore: boolean`, separado do `loading` (usado hoje só pelo pull-to-refresh).
- `load(page, replace)`: busca `propertyApi.getMine(page)`; se `replace` for `true` (refresh/foco inicial), substitui `items`; senão, concatena.
- `FlatList` ganha `onEndReached={loadMore}` e `onEndReachedThreshold={0.5}`, e `ListFooterComponent` mostrando um `ActivityIndicator` quando `loadingMore` for `true`.
- `useFocusEffect` (já existente) passa a resetar `page` para 1 e chamar `load(1, true)`.

## Testes

- Mobile: sem suíte automatizada (mesma situação das fases anteriores) — verificação via `tsc --noEmit`, único gate de CI mobile.

## Riscos / decisões em aberto

- Nenhum — escopo pequeno, sem mudança de contrato com o backend.
