import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Alert } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Button } from '../../components/ui/Button';
import { propertyApi, PropertyPhoto } from '../../services/properties';

const MAX_PHOTOS = 10;

export default function PropertyPhotosScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [photos, setPhotos] = useState<PropertyPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await propertyApi.getById(id);
      setPhotos(data.photos);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar as fotos');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleAddPhotos = async () => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      Alert.alert('Limite atingido', `Você já tem o máximo de ${MAX_PHOTOS} fotos.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permissão necessária', 'Autorize o acesso às fotos para adicionar imagens.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
    });
    if (result.canceled || !result.assets.length) return;

    setUploading(true);
    try {
      const compressed = await Promise.all(
        result.assets.map(async (asset) => {
          const context = ImageManipulator.manipulate(asset.uri);
          context.resize({ width: 1920 });
          const imageRef = await context.renderAsync();
          const saved = await imageRef.saveAsync({
            format: SaveFormat.JPEG,
            compress: 0.8,
          });
          return { uri: saved.uri, name: `${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`, type: 'image/jpeg' };
        }),
      );

      await propertyApi.uploadPhotos(id, compressed);
      await load();
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar as fotos');
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = (photoId: string) => {
    Alert.alert('Excluir foto', 'Tem certeza?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            await propertyApi.deletePhoto(id, photoId);
            setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
          } catch {
            Alert.alert('Erro', 'Não foi possível excluir a foto');
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fotos do anúncio</Text>
      <Text style={styles.subtitle}>{photos.length} de {MAX_PHOTOS} fotos</Text>
      <Button
        title={uploading ? 'Enviando...' : '+ Adicionar fotos'}
        onPress={handleAddPhotos}
        loading={uploading}
      />
      <FlatList
        data={photos}
        keyExtractor={(photo) => photo.id}
        numColumns={2}
        style={styles.list}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Nenhuma foto ainda</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.photoCard}>
            <Image source={{ uri: item.url }} style={styles.photo} />
            <TouchableOpacity style={styles.deleteBadge} onPress={() => handleDeletePhoto(item.id)}>
              <Text style={styles.deleteBadgeText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      <Button title="Concluído" variant="outline" onPress={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 16 },
  list: { marginTop: 16, flex: 1 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 32 },
  photoCard: { flex: 1, margin: 6, aspectRatio: 1, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  photo: { width: '100%', height: '100%' },
  deleteBadge: {
    position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
  },
  deleteBadgeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
