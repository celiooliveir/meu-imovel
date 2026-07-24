import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { propertyApi, PropertyType, TransactionType } from '../../services/properties';

const TYPE_OPTIONS = [
  { key: PropertyType.APARTMENT, label: 'Apartamento' },
  { key: PropertyType.HOUSE, label: 'Casa' },
  { key: PropertyType.COMMERCIAL, label: 'Comercial' },
  { key: PropertyType.LAND, label: 'Terreno' },
];

const TRANSACTION_OPTIONS = [
  { key: TransactionType.SALE, label: 'Venda' },
  { key: TransactionType.RENT, label: 'Aluguel' },
];

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

export default function PropertyForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!id;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<PropertyType>(PropertyType.APARTMENT);
  const [transactionType, setTransactionType] = useState<TransactionType>(TransactionType.SALE);
  const [price, setPrice] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [areaM2, setAreaM2] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingProperty, setLoadingProperty] = useState(isEditing);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastCheckedZip, setLastCheckedZip] = useState('');

  useEffect(() => {
    if (!id) return;
    propertyApi
      .getById(id)
      .then(({ data }) => {
        setTitle(data.title);
        setDescription(data.description);
        setType(data.type);
        setTransactionType(data.transactionType);
        setPrice(String(data.price));
        setBedrooms(data.bedrooms !== null ? String(data.bedrooms) : '');
        setBathrooms(data.bathrooms !== null ? String(data.bathrooms) : '');
        setAreaM2(data.areaM2 !== null ? String(data.areaM2) : '');
        setStreet(data.street);
        setNumber(data.number);
        setNeighborhood(data.neighborhood);
        setCity(data.city);
        setState(data.state);
        setZipCode(data.zipCode);
        setLastCheckedZip(data.zipCode.replace(/\D/g, ''));
        setIsActive(data.isActive);
      })
      .catch(() => Alert.alert('Erro', 'Não foi possível carregar o imóvel'))
      .finally(() => setLoadingProperty(false));
  }, [id]);

  const handleZipCodeBlur = async () => {
    const digits = zipCode.replace(/\D/g, '');
    if (digits.length !== 8) return;
    if (digits === lastCheckedZip) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data: ViaCepResponse = await res.json();
      if (data.erro) return;
      if (data.logradouro) setStreet(data.logradouro);
      if (data.bairro) setNeighborhood(data.bairro);
      if (data.localidade) setCity(data.localidade);
      if (data.uf) setState(data.uf);
    } catch {
      // CEP inválido ou API fora do ar: segue com preenchimento manual
    } finally {
      setLastCheckedZip(digits);
    }
  };

  const buildPayload = () => ({
    title,
    description,
    type,
    transactionType,
    price: Number(price),
    bedrooms: bedrooms ? Number(bedrooms) : undefined,
    bathrooms: bathrooms ? Number(bathrooms) : undefined,
    areaM2: areaM2 ? Number(areaM2) : undefined,
    street,
    number,
    neighborhood,
    city,
    state,
    zipCode,
  });

  const handleSubmit = async () => {
    setErrors({});

    if (!title || !description || !price || !street || !number || !neighborhood || !city || !state || !zipCode) {
      return;
    }

    const newErrors: Record<string, string> = {};

    if (title.length < 3) {
      newErrors.title = 'Título deve ter no mínimo 3 caracteres';
    }
    if (description.length < 10) {
      newErrors.description = 'Descrição deve ter no mínimo 10 caracteres';
    }
    const parsedPrice = Number(price);
    if (!price || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      newErrors.price = 'Preço inválido';
    }
    if (!/^\d{5}-?\d{3}$/.test(zipCode)) {
      newErrors.zipCode = 'CEP deve estar no formato 00000-000';
    }
    if (state.length !== 2) {
      newErrors.state = 'Estado deve ter 2 letras (UF)';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      if (isEditing && id) {
        await propertyApi.update(id, { ...buildPayload(), isActive });
        router.back();
      } else {
        const { data } = await propertyApi.create(buildPayload());
        router.replace({ pathname: '/property/photos', params: { id: data.id } });
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar o anúncio');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!id) return;
    Alert.alert('Excluir anúncio', 'Tem certeza? Essa ação não pode ser desfeita.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            await propertyApi.remove(id);
            router.back();
          } catch {
            Alert.alert('Erro', 'Não foi possível excluir o anúncio');
          }
        },
      },
    ]);
  };

  if (loadingProperty) {
    return (
      <View style={styles.center}>
        <Text>Carregando...</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{isEditing ? 'Editar anúncio' : 'Novo anúncio'}</Text>

      <Input label="Título" value={title} onChangeText={setTitle} error={errors.title} />
      <Input
        label="Descrição"
        value={description}
        onChangeText={setDescription}
        multiline
        error={errors.description}
      />

      <Text style={styles.sectionLabel}>Tipo</Text>
      <View style={styles.optionsRow}>
        {TYPE_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.option, type === opt.key && styles.optionSelected]}
            onPress={() => setType(opt.key)}
          >
            <Text style={[styles.optionText, type === opt.key && styles.optionTextSelected]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Transação</Text>
      <View style={styles.optionsRow}>
        {TRANSACTION_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.option, transactionType === opt.key && styles.optionSelected]}
            onPress={() => setTransactionType(opt.key)}
          >
            <Text style={[styles.optionText, transactionType === opt.key && styles.optionTextSelected]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Input label="Preço" value={price} onChangeText={setPrice} keyboardType="numeric" error={errors.price} />
      <Input label="Quartos" value={bedrooms} onChangeText={setBedrooms} keyboardType="numeric" />
      <Input label="Banheiros" value={bathrooms} onChangeText={setBathrooms} keyboardType="numeric" />
      <Input label="Área (m²)" value={areaM2} onChangeText={setAreaM2} keyboardType="numeric" />
      <Input
        label="CEP"
        value={zipCode}
        onChangeText={setZipCode}
        onBlur={handleZipCodeBlur}
        keyboardType="numeric"
        placeholder="00000-000"
        error={errors.zipCode}
      />
      <Input label="Rua" value={street} onChangeText={setStreet} />
      <Input label="Número" value={number} onChangeText={setNumber} />
      <Input label="Bairro" value={neighborhood} onChangeText={setNeighborhood} />
      <Input label="Cidade" value={city} onChangeText={setCity} />
      <Input
        label="Estado (UF)"
        value={state}
        onChangeText={setState}
        maxLength={2}
        autoCapitalize="characters"
        error={errors.state}
      />

      {isEditing ? (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Anúncio ativo</Text>
          <Switch value={isActive} onValueChange={setIsActive} />
        </View>
      ) : null}

      <Button title={isEditing ? 'Salvar' : 'Publicar'} onPress={handleSubmit} loading={saving} />

      {isEditing ? (
        <View style={styles.manageButtonWrapper}>
          <Button
            title="Gerenciar fotos"
            variant="outline"
            onPress={() => id && router.push({ pathname: '/property/photos', params: { id } })}
          />
        </View>
      ) : null}

      {isEditing ? (
        <View style={styles.deleteButtonWrapper}>
          <Button title="Excluir anúncio" variant="outline" onPress={handleDelete} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 16 },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  option: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: '#d1d5db',
  },
  optionSelected: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  optionText: { fontSize: 14, color: '#374151' },
  optionTextSelected: { color: '#fff', fontWeight: '700' },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, paddingVertical: 8,
  },
  switchLabel: { fontSize: 15, color: '#111827', fontWeight: '600' },
  deleteButtonWrapper: { marginTop: 4 },
  manageButtonWrapper: { marginTop: 4 },
});
