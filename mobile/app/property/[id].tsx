import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { propertyApi, Property } from '../../services/properties';

const TYPE_LABEL: Record<string, string> = {
  apartment: 'Apartamento', house: 'Casa', commercial: 'Comercial', land: 'Terreno',
};
const TRANSACTION_LABEL: Record<string, string> = { sale: 'Venda', rent: 'Aluguel' };

function formatPrice(price: number, transactionType: string) {
  const value = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return transactionType === 'rent' ? `${value}/mês` : value;
}

export default function PropertyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    propertyApi
      .getById(id)
      .then(({ data }) => setProperty(data))
      .catch(() => Alert.alert('Erro', 'Não foi possível carregar o imóvel'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#1a56db" />
      </View>
    );
  }

  if (!property) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Imóvel não encontrado</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{property.title}</Text>
      <Text style={styles.price}>{formatPrice(property.price, property.transactionType)}</Text>
      <Text style={styles.badge}>
        {TYPE_LABEL[property.type]} • {TRANSACTION_LABEL[property.transactionType]}
      </Text>
      <Text style={styles.section}>Endereço</Text>
      <Text style={styles.text}>
        {property.street}, {property.number} — {property.neighborhood}{'\n'}
        {property.city}/{property.state} — {property.zipCode}
      </Text>
      <Text style={styles.section}>Detalhes</Text>
      <Text style={styles.text}>
        {property.bedrooms !== null ? `${property.bedrooms} quarto(s) • ` : ''}
        {property.bathrooms !== null ? `${property.bathrooms} banheiro(s) • ` : ''}
        {property.areaM2 !== null ? `${property.areaM2} m²` : ''}
      </Text>
      <Text style={styles.section}>Descrição</Text>
      <Text style={styles.text}>{property.description}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  empty: { color: '#6b7280', fontSize: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  price: { fontSize: 20, fontWeight: '700', color: '#1a56db', marginTop: 8 },
  badge: { fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 16 },
  section: { fontSize: 14, fontWeight: '700', color: '#374151', marginTop: 16, marginBottom: 4 },
  text: { fontSize: 15, color: '#111827', lineHeight: 22 },
});
