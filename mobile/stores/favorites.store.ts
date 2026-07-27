import { create } from 'zustand';
import { Alert } from 'react-native';
import { propertyApi } from '../services/properties';

interface FavoritesState {
  ids: Set<string>;
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (propertyId: string) => Promise<void>;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  ids: new Set(),
  loaded: false,

  load: async () => {
    try {
      const { data } = await propertyApi.getFavoriteIds();
      set({ ids: new Set(data), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  toggle: async (propertyId: string) => {
    const wasFavorited = get().ids.has(propertyId);
    const optimisticIds = new Set(get().ids);
    if (wasFavorited) optimisticIds.delete(propertyId);
    else optimisticIds.add(propertyId);
    set({ ids: optimisticIds });

    try {
      if (wasFavorited) {
        await propertyApi.unfavorite(propertyId);
      } else {
        await propertyApi.favorite(propertyId);
      }
    } catch {
      const revertedIds = new Set(get().ids);
      if (wasFavorited) revertedIds.add(propertyId);
      else revertedIds.delete(propertyId);
      set({ ids: revertedIds });
      Alert.alert('Erro', 'Não foi possível atualizar o favorito');
    }
  },
}));
