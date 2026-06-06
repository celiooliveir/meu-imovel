import { Redirect } from 'expo-router';
import { useAuthStore } from '../stores/auth.store';

export default function Index() {
  const user = useAuthStore((s) => s.user);
  return <Redirect href={user ? '/(tabs)/' : '/(auth)/login'} />;
}
