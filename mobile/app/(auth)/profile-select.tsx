import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

const ROLES = [
  { key: 'buyer_tenant', icon: '🏠', label: 'Busco um imóvel', sub: 'Comprador ou Inquilino' },
  { key: 'owner',        icon: '🔑', label: 'Tenho um imóvel', sub: 'Proprietário' },
  { key: 'broker',       icon: '📋', label: 'Sou corretor',    sub: 'Corretor ou Imobiliária' },
];

export default function ProfileSelect() {
  const params = useLocalSearchParams<{ name: string; email: string; password: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Qual é o seu perfil?</Text>
      <Text style={styles.sub}>Isso personaliza sua experiência no app</Text>
      {ROLES.map((r) => (
        <TouchableOpacity
          key={r.key}
          style={styles.card}
          onPress={() =>
            router.push({ pathname: '/(auth)/register', params: { ...params, role: r.key } })
          }
        >
          <Text style={styles.icon}>{r.icon}</Text>
          <View>
            <Text style={styles.cardLabel}>{r.label}</Text>
            <Text style={styles.cardSub}>{r.sub}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: '800', color: '#111827', marginBottom: 8 },
  sub: { fontSize: 14, color: '#6b7280', marginBottom: 32 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    padding: 20, borderRadius: 12, borderWidth: 1.5,
    borderColor: '#e5e7eb', marginBottom: 12,
  },
  icon: { fontSize: 32 },
  cardLabel: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280' },
});
