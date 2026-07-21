import { Tabs } from 'expo-router';
import { useAuthStore } from '../../stores/auth.store';

export default function TabsLayout() {
  const role = useAuthStore((s) => s.user?.role);
  const canManageListings = role === 'owner' || role === 'broker';

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#1a56db' }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen
        name="my-listings"
        options={{ title: 'Meus anúncios', href: canManageListings ? undefined : null }}
      />
    </Tabs>
  );
}
