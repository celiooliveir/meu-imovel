import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, TouchableOpacityProps } from 'react-native';

interface Props extends TouchableOpacityProps {
  title: string;
  loading?: boolean;
  variant?: 'primary' | 'outline';
}

export function Button({ title, loading, variant = 'primary', disabled, ...props }: Props) {
  return (
    <TouchableOpacity
      style={[styles.btn, variant === 'outline' ? styles.outline : styles.primary, disabled ? styles.disabled : undefined]}
      disabled={disabled || loading}
      {...props}
    >
      {loading
        ? <ActivityIndicator color={variant === 'outline' ? '#1a56db' : '#fff'} />
        : <Text style={[styles.text, variant === 'outline' ? styles.textOutline : undefined]}>{title}</Text>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  primary: { backgroundColor: '#1a56db' },
  outline: { borderWidth: 1.5, borderColor: '#1a56db', backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
  text: { color: '#fff', fontSize: 16, fontWeight: '700' },
  textOutline: { color: '#1a56db' },
});
