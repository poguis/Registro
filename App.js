import React, { useState, useEffect, useCallback } from 'react';
import { View, ActivityIndicator, Alert, BackHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import DineroScreen from './src/screens/DineroScreen';
import SeriesAnimeScreen from './src/screens/SeriesAnimeScreen';
import DeudasPrestamosScreen from './src/screens/DeudasPrestamosScreen';
import db from './src/services/db';

import SeriesDetailScreen from './src/screens/SeriesDetailScreen';
import ReadingDetailScreen from './src/screens/ReadingDetailScreen';
import ChapterRegistryScreen from './src/screens/ChapterRegistryScreen';
import ReadingRegistryScreen from './src/screens/ReadingRegistryScreen';
import BacklogScreen from './src/screens/BacklogScreen';
import StatisticsScreen from './src/screens/StatisticsScreen';
import TrabajoScreen from './src/screens/TrabajoScreen';
import ServiciosScreen from './src/screens/ServiciosScreen';
import CardsScreen from './src/screens/CardsScreen';
import DatabaseErrorScreen from './src/screens/DatabaseErrorScreen';
import { ThemeProvider } from './src/contexts/ThemeContext';

// La sesión guarda SOLO { id, username } (nunca contraseña ni saldo).
const toSession = (u) => ({ id: u.id, username: u.username });

// Resumen de la migración 2 para mostrar al terminar (conteos antes y después).
const formatMigrationSummary = (summary) => {
  const lines = Object.keys(summary.before).map(
    (t) => `${t}: ${summary.before[t]} → ${summary.after[t]}`
  );
  const adjustments = summary.balanceAdjustments.length
    ? `\nAjustes de saldo: ${summary.balanceAdjustments.map((a) => a.amount.toFixed(2)).join(', ')}`
    : '\nAjustes de saldo: ninguno';
  return `Tus datos se actualizaron al nuevo formato. Filas por tabla (antes → después):\n${lines.join('\n')}${adjustments}`;
};

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState(null);
  const [currentView, setCurrentView] = useState('LOGIN'); // LOGIN, HOME, DINERO, DEUDAS_PRESTAMOS, PENDIENTE
  const [navigationHistory, setNavigationHistory] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [dbError, setDbError] = useState(null);

  // Inicializar DB (incluye migraciones) y recuperar sesión.
  // Si la BD no queda lista, no se muestra ninguna pantalla de la app: solo
  // DatabaseErrorScreen, que permite respaldar y reintentar.
  const initialize = useCallback(async () => {
    setIsReady(false);
    try {
      const success = await db.init();
      if (!success) {
        setDbError(db.lastInitError ? db.lastInitError.message : 'Error desconocido al abrir la base de datos');
        return;
      }
      setDbError(null);

      // Si en este arranque se aplicó la migración 2, mostrar su resumen.
      if (db.lastMigration && db.lastMigration.applied.includes(2)) {
        const res = await db.getLatestMigrationSummary();
        if (res.success && res.summary) {
          Alert.alert('Actualización de datos completada', formatMigrationSummary(res.summary));
        }
      }

      // Recuperar usuario de AsyncStorage. Una sesión con id entero (anterior a la
      // migración 2) se mapea al UUID nuevo; si no se puede, se cierra la sesión.
      const storedUser = await AsyncStorage.getItem('@user_session');
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser);
          const resolved = userData && typeof userData === 'object' && userData.id
            ? await db.resolveSessionUser(userData.id)
            : null;
          if (resolved && resolved.success && resolved.user) {
            const session = toSession(resolved.user);
            await AsyncStorage.setItem('@user_session', JSON.stringify(session));
            setUser(session);
            setCurrentView('HOME');
          } else {
            await AsyncStorage.removeItem('@user_session');
          }
        } catch (parseError) {
          console.error('Invalid stored session:', parseError);
          await AsyncStorage.removeItem('@user_session');
        }
      }
    } catch (error) {
      console.error('Error in init:', error);
    } finally {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleBack = useCallback(() => {
    if (navigationHistory.length > 0) {
      const newHistory = [...navigationHistory];
      const prevView = newHistory.pop();
      setNavigationHistory(newHistory);
      setCurrentView(prevView);
      return true; // Prevent default behavior (exiting app)
    }

    if (currentView === 'HOME') {
      Alert.alert(
        'Salir',
        '¿Estás seguro de que quieres salir de la aplicación?',
        [
          { text: 'Cancelar', style: 'cancel', onPress: () => { } },
          { text: 'Salir', style: 'destructive', onPress: () => BackHandler.exitApp() }
        ]
      );
      return true;
    }

    // Default: if no history and not in HOME (e.g. LOGIN), let system handle it
    return false;
  }, [navigationHistory, currentView]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => backHandler.remove();
  }, [handleBack]);

  const handleLogin = async (loggedUser) => {
    const userData = toSession(loggedUser);
    try {
      await AsyncStorage.setItem('@user_session', JSON.stringify(userData));
      setUser(userData);
      setNavigationHistory([]); // Reset history on login
      setCurrentView('HOME');
    } catch (error) {
      console.error('Error saving session:', error);
      setUser(userData);
      setCurrentView('HOME');
    }
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem('@user_session');
      setUser(null);
      setNavigationHistory([]); // Reset history on logout
      setCurrentView('LOGIN');
    } catch (error) {
      console.error('Error removing session:', error);
      setUser(null);
      setCurrentView('LOGIN');
    }
  };

  const handleNavigate = (view) => {
    setNavigationHistory(prev => [...prev, currentView]);
    setCurrentView(view);
  };

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e94560" />
      </View>
    );
  }

  if (dbError) {
    return (
      <ThemeProvider>
        <SafeAreaProvider>
          <DatabaseErrorScreen errorMessage={dbError} onRetry={initialize} />
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  // Router simple basado en estado
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        {!user ? (
          <LoginScreen onLoginSuccess={handleLogin} />
        ) : (() => {
          switch (currentView) {
            case 'CARDS':
              return (
                <CardsScreen
                  user={user}
                  onBack={handleBack}
                />
              );
            case 'SERVICIOS':
              return (
                <ServiciosScreen
                  user={user}
                  onBack={handleBack}
                />
              );
            case 'DINERO':
              return (
                <DineroScreen
                  user={user}
                  onBack={handleBack}
                  onNavigate={handleNavigate}
                />
              );
            case 'DEUDAS_PRESTAMOS':
              return (
                <DeudasPrestamosScreen
                  user={user}
                  onBack={handleBack}
                />
              );
            case 'PENDIENTE':
              return (
                <BacklogScreen
                  user={user}
                  onBack={handleBack}
                />
              );
            case 'SERIES_ANIME':
              return (
                <SeriesAnimeScreen
                  user={user}
                  onBack={handleBack}
                  onNavigateDetail={(category) => {
                    setSelectedCategory(category);
                    if (category.type === 'reading') {
                      handleNavigate('READING_DETAIL');
                    } else {
                      handleNavigate('SERIES_DETAIL');
                    }
                  }}
                />
              );
            case 'SERIES_DETAIL':
              return (
                <SeriesDetailScreen
                  user={user}
                  category={selectedCategory}
                  onBack={handleBack}
                  onNavigateRegistry={() => handleNavigate('CHAPTER_REGISTRY')}
                />
              );
            case 'READING_DETAIL':
              return (
                <ReadingDetailScreen
                  user={user}
                  category={selectedCategory}
                  onBack={handleBack}
                  onNavigateRegistry={() => handleNavigate('READING_REGISTRY')}
                />
              );
            case 'CHAPTER_REGISTRY':
              return (
                <ChapterRegistryScreen
                  user={user}
                  category={selectedCategory}
                  onBack={handleBack}
                />
              );
            case 'READING_REGISTRY':
              return (
                <ReadingRegistryScreen
                  user={user}
                  category={selectedCategory}
                  onBack={handleBack}
                />
              );
            case 'STATISTICS':
              return (
                <StatisticsScreen
                  user={user}
                  onBack={handleBack}
                />
              );
            case 'TRABAJO':
              return (
                <TrabajoScreen
                  user={user}
                  onBack={handleBack}
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
    </ThemeProvider>
  );
}
