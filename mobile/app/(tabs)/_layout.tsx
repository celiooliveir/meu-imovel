import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { useAuthStore } from '../../stores/auth.store';
import { useFavoritesStore } from '../../stores/favorites.store';

export default function TabsLayout() {
  const role = useAuthStore((s) => s.user?.role);
  const canManageListings = role === 'owner' || role === 'broker';
  const loadFavorites = useFavoritesStore((s) => s.load);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#1a56db' }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen name="favorites" options={{ title: 'Favoritos' }} />
      <Tabs.Screen
        name="my-listings"
        options={{ title: 'Meus anúncios', href: canManageListings ? undefined : null }}
      />
    </Tabs>
  );
}
