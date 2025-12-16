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

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState(null);
  const [currentView, setCurrentView] = useState('LOGIN'); // LOGIN, HOME, DINERO, DEUDAS_PRESTAMOS
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
              />
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
                category={selectedCategory}
                onBack={() => setCurrentView('SERIES_ANIME')}
              />
            );
          case 'HOME':
          default:
            return (
              <HomeScreen
                user={user}
                onNavigate={setCurrentView}
                onLogout={handleLogout}
              />
            );
        }
      })()}
    </SafeAreaProvider>
  );
}
