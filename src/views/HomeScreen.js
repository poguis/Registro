import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

export default function HomeScreen({ user, onLogout }) {
  const navigation = useNavigation();

  // Validar que user existe
  if (!user || !user.username) {
    return null;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>¡Hola!</Text>
        <Text style={styles.username}>{String(user.username || '')}</Text>
      </View>

      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          style={[styles.button, styles.moneyButton]}
          onPress={() => navigation.navigate('Dinero')}
        >
          <Text style={styles.buttonIcon}>💰</Text>
          <Text style={styles.buttonText}>DINERO</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.mediaButton]}
          onPress={() => navigation.navigate('SerieAnime')}
        >
          <Text style={styles.buttonIcon}>📺</Text>
          <Text style={styles.buttonText}>SERIE/ANIME</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.pendienteButton]}
          onPress={() => navigation.navigate('Pendiente')}
        >
          <Text style={styles.buttonIcon}>📋</Text>
          <Text style={styles.buttonText}>PENDIENTE</Text>
        </TouchableOpacity>
      </View>

      {onLogout && (
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>Cerrar Sesión</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  greeting: {
    fontSize: 28,
    color: '#666',
    marginBottom: 4,
  },
  username: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  buttonsContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  button: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    marginBottom: 20,
    alignItems: 'center',
    elevation: 3,
  },
  moneyButton: {
    borderLeftWidth: 6,
    borderLeftColor: '#4CAF50',
  },
  mediaButton: {
    borderLeftWidth: 6,
    borderLeftColor: '#2196F3',
  },
  pendienteButton: {
    borderLeftWidth: 6,
    borderLeftColor: '#FF9800',
  },
  buttonIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  buttonText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  logoutButton: {
    margin: 20,
    padding: 12,
    alignItems: 'center',
  },
  logoutText: {
    color: '#F44336',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

