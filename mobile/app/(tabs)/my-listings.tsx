import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Image } from 'react-native';
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
  const requestIdRef = useRef(0);

  const load = useCallback(async (targetPage: number, replace: boolean) => {
    const requestId = ++requestIdRef.current;
    if (replace) setLoading(true);
    else setLoadingMore(true);
    try {
      const { data } = await propertyApi.getMine(targetPage);
      if (requestId !== requestIdRef.current) return;
      setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
      setPage(data.page);
      setHasMore(data.page * data.limit < data.total);
    } catch {
      if (requestId === requestIdRef.current) {
        Alert.alert('Erro', 'Não foi possível carregar seus anúncios');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
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
            {item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0].url }} style={styles.cardImage} />
            ) : null}
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
  cardImage: { width: '100%', height: 140, borderRadius: 8, marginBottom: 8 },
  cardInactive: { opacity: 0.6 },
  badge: {
    alignSelf: 'flex-start', backgroundColor: '#fee2e2', color: '#b91c1c',
    fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginBottom: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '700', color: '#1a56db', marginTop: 8 },
});
