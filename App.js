import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import DineroScreen from './src/screens/DineroScreen';
import DeudasPrestamosScreen from './src/screens/DeudasPrestamosScreen';
import db from './src/services/db';

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState(null);
  const [currentView, setCurrentView] = useState('LOGIN'); // LOGIN, HOME, DINERO, DEUDAS_PRESTAMOS

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
                onNavigate={handleNavigate}
              />
            );
          case 'DEUDAS_PRESTAMOS':
            return (
              <DeudasPrestamosScreen
                user={user}
                onBack={() => setCurrentView('DINERO')}
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
