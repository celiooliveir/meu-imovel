import { View, Text, StyleSheet } from 'react-native';
import { useAuthStore } from '../../stores/auth.store';

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Olá, {user?.name} 👋</Text>
      <Text style={styles.sub}>Plano 2: Busca de imóveis em breve</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  text: { fontSize: 22, fontWeight: '700', color: '#111827' },
  sub: { fontSize: 14, color: '#6b7280', marginTop: 8 },
});
