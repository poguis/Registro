import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import DineroScreen from './src/screens/DineroScreen';
import SeriesAnimeScreen from './src/screens/SeriesAnimeScreen';
import DeudasPrestamosScreen from './src/screens/DeudasPrestamosScreen';
import db from './src/services/db';

import SeriesDetailScreen from './src/screens/SeriesDetailScreen';
import ChapterRegistryScreen from './src/screens/ChapterRegistryScreen';

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState(null);
  const [currentView, setCurrentView] = useState('LOGIN'); // LOGIN, HOME, DINERO, DEUDAS_PRESTAMOS, PENDIENTE
  const [lastView, setLastView] = useState('HOME');
  const [selectedCategory, setSelectedCategory] = useState(null);

  useEffect(() => {
    // Inicializar DB
    const init = async () => {
      await db.init();
      setIsReady(true);
    };
    init();
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
    setCurrentView('HOME');
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentView('LOGIN');
  };

  const handleNavigate = (view) => {
    setLastView(currentView);
    setCurrentView(view);
  };

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e94560" />
      </View>
    );
  }

  if (!user) {
    return (
      <SafeAreaProvider>
        <LoginScreen onLoginSuccess={handleLogin} />
      </SafeAreaProvider>
    );
  }

  // Router simple basado en estado
  return (
    <SafeAreaProvider>
      {(() => {
        switch (currentView) {
          case 'DINERO':
            return (
              <DineroScreen
                user={user}
                onBack={() => setCurrentView('HOME')}
                onNavigate={handleNavigate}
              />
            );
          case 'DEUDAS_PRESTAMOS':
            return (
              <DeudasPrestamosScreen
                user={user}
                onBack={() => setCurrentView(lastView === 'DINERO' ? 'DINERO' : 'HOME')}
              />
            );
          case 'PENDIENTE':
            return (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
                <HomeScreen user={user} onNavigate={setCurrentView} onLogout={handleLogout} />
                {/* Temporary placeholder to show something */}
                <View style={{ position: 'absolute', top: '50%', backgroundColor: 'white', padding: 20, borderRadius: 10, elevation: 5 }}>
                  <Text style={{ fontWeight: 'bold', fontSize: 18 }}>Módulo Pendiente</Text>
                  <Text style={{ color: '#666', marginTop: 10 }}>Próximamente estaremos trabajando aquí...</Text>
                  <TouchableOpacity onPress={() => setCurrentView('HOME')} style={{ backgroundColor: '#007AFF', padding: 10, borderRadius: 5, marginTop: 15, alignItems: 'center' }}>
                    <Text style={{ color: 'white' }}>Volver</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          case 'SERIES_ANIME':
            return (
              <SeriesAnimeScreen
                user={user}
                onBack={() => setCurrentView('HOME')}
                onNavigateDetail={(category) => {
                  setSelectedCategory(category);
                  setCurrentView('SERIES_DETAIL');
                }}
              />
            );
          case 'SERIES_DETAIL':
            return (
              <SeriesDetailScreen
                user={user}
                category={selectedCategory}
                onBack={() => setCurrentView('SERIES_ANIME')}
                onNavigateRegistry={() => setCurrentView('CHAPTER_REGISTRY')}
              />
            );
          case 'CHAPTER_REGISTRY':
            return (
              <ChapterRegistryScreen
                user={user}
                category={selectedCategory}
                onBack={() => setCurrentView('SERIES_DETAIL')}
              />
            );
          case 'HOME':
          default:
            return (
              <HomeScreen
                user={user}
                onNavigate={handleNavigate}
                onLogout={handleLogout}
              />
            );
        }
      })()}
    </SafeAreaProvider>
  );
}
