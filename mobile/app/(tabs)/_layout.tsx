import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#1a56db' }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
    </Tabs>
  );
}
