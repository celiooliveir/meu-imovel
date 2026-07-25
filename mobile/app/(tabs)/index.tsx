import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Image } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../stores/auth.store';
import { propertyApi, Property } from '../../services/properties';

const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };
const RADIUS_OPTIONS = [5, 10, 20];

function formatPrice(price: number, transactionType: string) {
  const value = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return transactionType === 'rent' ? `${value}/mês` : value;
}

export default function SearchScreen() {
  const user = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [nearMe, setNearMe] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await propertyApi.search({
        q: q || undefined,
        city: city || undefined,
        lat: nearMe && coords ? coords.lat : undefined,
        lng: nearMe && coords ? coords.lng : undefined,
        radiusKm: nearMe && coords ? radiusKm : undefined,
      });
      setItems(data.items);
    } catch {
      Alert.alert('Erro', 'Não foi possível buscar os imóveis');
    } finally {
      setLoading(false);
    }
  }, [q, city, nearMe, coords, radiusKm]);

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearMe, coords, radiusKm]);

  const toggleNearMe = async () => {
    if (nearMe) {
      setNearMe(false);
      setCoords(null);
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão negada', 'Ative a localização para buscar imóveis perto de você');
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({});
      setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
      setNearMe(true);
    } catch {
      Alert.alert('Erro', 'Não foi possível obter sua localização');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Olá, {user?.name} 👋</Text>
      <Input label="Buscar" value={q} onChangeText={setQ} placeholder="Título ou descrição" />
      <Input label="Cidade" value={city} onChangeText={setCity} placeholder="Ex: São Paulo" />

      <TouchableOpacity style={[styles.nearMeButton, nearMe && styles.nearMeButtonActive]} onPress={toggleNearMe}>
        <Text style={[styles.nearMeText, nearMe && styles.nearMeTextActive]}>
          📍 {nearMe ? 'Perto de mim (ativo)' : 'Perto de mim'}
        </Text>
      </TouchableOpacity>

      {nearMe ? (
        <View style={styles.radiusRow}>
          {RADIUS_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.radiusOption, radiusKm === option && styles.radiusOptionSelected]}
              onPress={() => setRadiusKm(option)}
            >
              <Text style={[styles.radiusText, radiusKm === option && styles.radiusTextSelected]}>
                {option} km
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <Button title="Buscar" onPress={search} loading={loading} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.list}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Nenhum imóvel encontrado</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: '/property/[id]', params: { id: item.id } })}
          >
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSub}>
              {item.city} • {TRANSACTION_LABEL[item.transactionType]}
              {item.distanceKm !== undefined ? ` • ${item.distanceKm.toFixed(1)} km` : ''}
            </Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price, item.transactionType)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff' },
  greeting: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  list: { marginTop: 16 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 32 },
  nearMeButton: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1.5,
    borderColor: '#d1d5db', marginBottom: 8, alignSelf: 'flex-start',
  },
  nearMeButtonActive: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  nearMeText: { fontSize: 14, color: '#374151', fontWeight: '600' },
  nearMeTextActive: { color: '#fff' },
  radiusRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  radiusOption: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: '#d1d5db',
  },
  radiusOptionSelected: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  radiusText: { fontSize: 14, color: '#374151' },
  radiusTextSelected: { color: '#fff', fontWeight: '700' },
  card: {
    padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 12,
  },
  cardImage: { width: '100%', height: 140, borderRadius: 8, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '700', color: '#1a56db', marginTop: 8 },
});
