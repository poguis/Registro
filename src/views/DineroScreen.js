import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function DineroScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>DINERO</Text>
      <Text style={styles.subtitle}>Pantalla en desarrollo</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});

