# Upload de Fotos de Imóveis — Design

Data: 2026-07-22

## Contexto

O módulo de imóveis tem CRUD completo, busca com filtros e gestão de anúncios pelo mobile, mas nenhum anúncio pode ter fotos — o maior buraco de produto identificado até aqui. Esta fase adiciona upload, exibição e exclusão de fotos, usando o Cloudinary como storage.

## Escopo

- Upload de até 10 fotos por anúncio, enviadas do mobile pro nosso backend, que repassa pro Cloudinary.
- Exclusão individual de foto.
- Compressão/redimensionamento no celular antes do envio.
- Exibição da foto de capa (primeira enviada) nos cards de busca e "Meus anúncios", e carrossel completo na tela de detalhe.
- Tela dedicada de gerenciamento de fotos, acessada após criar um anúncio ou a partir da edição.

Fora de escopo: reordenar fotos, editar/cortar imagem no app, geração de variações/thumbnails além do que o Cloudinary já faz automaticamente.

## Backend

### Nova infraestrutura: `CloudinaryModule`

`backend/src/shared/cloudinary/cloudinary.module.ts` + `cloudinary.service.ts` — encapsula o SDK oficial `cloudinary`, configurado via `ConfigService` a partir de três novas variáveis de ambiente:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

`CloudinaryService` expõe dois métodos: `upload(buffer: Buffer, folder: string): Promise<{ url: string; publicId: string }>` e `destroy(publicId: string): Promise<void>`. Nenhum outro módulo fala com o SDK do Cloudinary diretamente — só esse service.

### Nova entidade `PropertyPhoto`

`backend/src/modules/properties/property-photo.entity.ts`:

```ts
@Entity('property_photos')
export class PropertyPhoto extends BaseEntity {
  url: string;
  publicId: string;       // referência do Cloudinary, necessária pra excluir de lá
  propertyId: string;     // FK -> Property
  property: Property;     // ManyToOne
}
```

Sem campo de ordem — a exibição segue `createdAt` ascendente (a primeira foto enviada é a capa). Reordenar fica fora de escopo.

### Endpoints

Novo `PropertyPhotoController`, montado em `properties/:propertyId/photos`, guards iguais aos de `PATCH`/`DELETE` de `Property` (`JwtAuthGuard` + `RolesGuard(OWNER, BROKER)` + checagem de dono no service):

| Método | Rota | Descrição |
|---|---|---|
| POST | `/properties/:propertyId/photos` | Multipart, campo `photos` (múltiplos arquivos). Valida: dono do anúncio, tipo (`image/jpeg`, `image/png`, `image/webp`), tamanho máximo por arquivo (10MB, defesa contra bypass do lado do cliente), e que o total (existentes + novos) não passe de 10. Cada arquivo aceito vira uma linha em `PropertyPhoto` e vai pro Cloudinary via `CloudinaryService.upload`, numa pasta por imóvel (`properties/{propertyId}`) |
| DELETE | `/properties/:propertyId/photos/:photoId` | Chama `CloudinaryService.destroy(publicId)` e remove o registro |

`multer` configurado com `memoryStorage` (não grava em disco — o buffer vai direto pro Cloudinary).

`PropertyResponseDto.photos` passa a ser `{ id: string; url: string }[]` (não só URLs — a tela de exclusão no mobile precisa do id).

## Mobile

### Novas dependências

- `expo-image-picker` — seleção múltipla de fotos da galeria.
- `expo-image-manipulator` — redimensiona (máx. 1920px de largura) e recomprime (JPEG, qualidade ~80%) cada foto antes do upload, reduzindo banda e o consumo da cota gratuita do Cloudinary.

Como `mobile/AGENTS.md` avisa que a API do Expo mudou entre versões, a implementação vai conferir a documentação da versão instalada (SDK 56) antes de escrever as chamadas dessas duas libs, em vez de assumir uma API pela memória.

### Nova tela `app/property/photos.tsx`

Recebe `id` do imóvel via parâmetro de rota. Busca o imóvel (`propertyApi.getById`, que agora traz `photos`), exibe grid com as fotos existentes (cada uma com botão de excluir → `propertyApi.deletePhoto(id, photoId)`), botão "Adicionar fotos" (abre seletor múltiplo, limitado ao que falta pro máximo de 10, comprime cada imagem selecionada, envia via `propertyApi.uploadPhotos(id, files)`), e botão "Concluído" voltando pra "Meus anúncios".

### Navegação

- **Criar anúncio** (`app/property/form.tsx`, modo criação): em vez de voltar direto após salvar, navega pra `photos.tsx` com o id do imóvel recém-criado.
- **Editar anúncio**: o formulário ganha um botão "Gerenciar fotos" levando pra essa mesma tela.

### Exibição

- `app/(tabs)/index.tsx` (busca) e `app/(tabs)/my-listings.tsx`: cards ganham a foto de capa (`photos[0]`) como miniatura, se houver; sem foto, mantém o layout atual (só texto).
- `app/property/[id].tsx` (detalhe): carrossel horizontal com todas as fotos no topo, se houver.

### `services/properties.ts`

Adiciona:
```ts
uploadPhotos: (id: string, files: { uri: string; name: string; type: string }[]) => Promise<...>
deletePhoto: (id: string, photoId: string) => Promise<void>
```
E `Property.photos: { id: string; url: string }[]`.

## Testes

- Backend: unit tests em `property-photo.service.spec.ts` mockando `CloudinaryService` e o repositório (padrão já usado em `property.service.spec.ts`); e2e em `property.e2e-spec.ts` cobrindo upload (dono OK, outro usuário 403, limite de 10 excedido, tipo inválido), exclusão (dono OK, outro usuário 403).
- Mobile: sem suíte automatizada (mesma situação das fases anteriores) — verificação via `tsc --noEmit`.

## Riscos / decisões em aberto

- Credenciais do Cloudinary precisam ser criadas por você (conta + chaves) antes da implementação rodar de verdade — em ambiente de CI/e2e, os testes vão precisar mockar `CloudinaryService` para não depender de credenciais reais.
- Arquivos passam pelo nosso backend antes do Cloudinary (decisão já tomada) — para os volumes esperados nesta fase, aceitável; se o app crescer muito, upload direto do mobile pro Cloudinary (com assinatura) fica como evolução futura.
