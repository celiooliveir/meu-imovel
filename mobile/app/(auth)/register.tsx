import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';

export default function Register() {
  const params = useLocalSearchParams<{ role?: string; name?: string; email?: string; password?: string }>();
  const [name, setName] = useState(params.name ?? '');
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState(params.password ?? '');
  const [loading, setLoading] = useState(false);
  const setTokens = useAuthStore((s) => s.setTokens);

  const handleNext = async () => {
    if (!name || !email || !password) return;
    if (!params.role) {
      router.push({ pathname: '/(auth)/profile-select', params: { name, email, password } });
      return;
    }
    setLoading(true);
    try {
      const { data } = await authApi.register({ name, email, password, role: params.role });
      setTokens(data.accessToken, data.refreshToken, data.user);
      router.replace('/(tabs)/');
    } catch (e: any) {
      Alert.alert('Erro', e.response?.data?.message ?? 'Falha no cadastro');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Criar conta</Text>
      <Input label="Nome completo" value={name} onChangeText={setName} />
      <Input label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Input label="Senha (mín. 8 caracteres)" value={password} onChangeText={setPassword} secureTextEntry />
      <Button title={params.role ? 'Criar conta' : 'Continuar'} onPress={handleNext} loading={loading} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: '800', color: '#111827', marginBottom: 32 },
});
