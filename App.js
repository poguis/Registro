import React, { useState, useEffect, useCallback } from 'react';
import { View, ActivityIndicator, Alert, BackHandler } from 'react-native';
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
import LinkAccountScreen from './src/screens/LinkAccountScreen';
import RlsTestScreen from './src/screens/RlsTestScreen';
import { useAuth } from './src/auth/useAuth';
import { getVariant } from './src/auth/redirect';
import { afterGoogleLogin, confirmLink, resolveStartupIdentity, chooseLocalUser } from './src/auth/accountFlow';
import { ThemeProvider } from './src/contexts/ThemeContext';

// Variante dev (app.config.js): habilita herramientas de prueba que nunca van en producción.
const IS_DEV_VARIANT = getVariant() === 'development';

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
  // Fase 3: identidad local + sesión de Google (la sesión nunca bloquea los datos locales).
  const auth = useAuth();
  const [localChoices, setLocalChoices] = useState(null); // varias cuentas sin vincular
  const [pendingLink, setPendingLink] = useState(null); // { email, localUsername, session }
  const [linkBusy, setLinkBusy] = useState(false);

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
      // (No se muestra en una instalación nueva: todo en 0.)
      if (db.lastMigration && db.lastMigration.applied.includes(2)) {
        const res = await db.getLatestMigrationSummary();
        const hadData = res.success && res.summary && Object.values(res.summary.before).some((n) => n > 0);
        if (hadData) {
          Alert.alert('Actualización de datos completada', formatMigrationSummary(res.summary));
        }
      }

      // Identidad local (sin red ni Supabase): con datos locales la app SIEMPRE abre.
      // Solo una instalación sin datos exige el login con Google.
      const identity = await resolveStartupIdentity();
      if (identity.kind === 'open') {
        setUser(identity.user);
        setCurrentView('HOME');
      } else if (identity.kind === 'choose') {
        setLocalChoices(identity.users);
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

  const enterApp = (appUser) => {
    setUser(appUser);
    setLocalChoices(null);
    setNavigationHistory([]);
    setCurrentView('HOME');
  };

  // Login con Google (también sirve para vincular o para volver a iniciar sesión).
  const handleGoogle = async () => {
    const r = await auth.signIn();
    // Sin callback (pestaña cerrada, retorno a otra URL o sin code): no se tocó nada y se
    // puede reintentar.
    if (r.status === 'cancel') {
      Alert.alert('Inicio de sesión', 'No se completó el inicio de sesión, inténtalo de nuevo.');
      return;
    }
    if (r.status === 'error') {
      Alert.alert('No se completó el inicio de sesión', `${r.message}

Inténtalo de nuevo.`);
      return;
    }
    const next = await afterGoogleLogin(r.session);
    if (next.kind === 'ready') {
      enterApp(next.user);
    } else if (next.kind === 'confirm-link') {
      setPendingLink({ email: next.email, localUsername: next.localUser.username, session: r.session });
    } else if (next.kind === 'blocked') {
      Alert.alert(
        'Cuenta no permitida',
        next.reason === 'other-account'
          ? `Los datos de este dispositivo pertenecen a ${next.linkedEmail || 'otra cuenta'}. No se cambió nada.`
          : 'Hay varias cuentas locales en este dispositivo; la vinculación necesita una sola. No se cambió nada.'
      );
    } else {
      Alert.alert('Error', next.message);
    }
  };

  const handleConfirmLink = async () => {
    if (!pendingLink) return;
    setLinkBusy(true);
    try {
      const res = await confirmLink(pendingLink.session);
      if (res.ok) {
        setPendingLink(null);
        enterApp(res.user);
        Alert.alert('Cuenta vinculada', `Tus datos ahora están vinculados a ${res.user.email}.`);
      } else {
        setPendingLink(null);
        Alert.alert('No se vinculó', `${res.message}

Tus datos no se modificaron.`);
      }
    } finally {
      setLinkBusy(false);
    }
  };

  const handleCancelLink = async () => {
    setPendingLink(null);
    await auth.signOut();
  };

  // Cerrar sesión de Google: los datos locales se quedan y la app sigue abierta.
  const handleLogout = () => {
    Alert.alert(
      'Cerrar sesión de Google',
      'Tus datos se quedan en este dispositivo y la app sigue funcionando sin conexión. Podrás volver a iniciar sesión cuando quieras.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: () => auth.signOut() },
      ]
    );
  };

  const handleChooseLocal = async (localUser) => {
    await chooseLocalUser(localUser);
    enterApp(localUser);
  };

  // Aviso no bloqueante en Home.
  const homeNotice = !user || !auth.configured ? null
    : !user.linked
      ? { text: 'Vincula tu cuenta de Google para poder sincronizar tus datos más adelante.', actionLabel: 'Vincular con Google', onAction: handleGoogle, busy: auth.signingIn }
      : !auth.session
        ? { text: 'Inicia sesión con Google para sincronizar (tus datos locales siguen disponibles).', actionLabel: 'Iniciar sesión', onAction: handleGoogle, busy: auth.signingIn }
        : null;

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
        {pendingLink ? (
          <LinkAccountScreen
            email={pendingLink.email}
            localUsername={pendingLink.localUsername}
            busy={linkBusy}
            onConfirm={handleConfirmLink}
            onCancel={handleCancelLink}
          />
        ) : !user ? (
          <LoginScreen
            onGoogle={handleGoogle}
            signingIn={auth.signingIn}
            configured={auth.configured}
            localUsers={localChoices}
            onChooseLocal={handleChooseLocal}
          />
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
            case 'RLS_TEST':
              // Solo en la variante dev; en producción cae a HOME.
              if (IS_DEV_VARIANT) return <RlsTestScreen onBack={handleBack} />;
            // falls through
            case 'HOME':
            default:
              return (
                <HomeScreen
                  user={user}
                  onNavigate={handleNavigate}
                  onLogout={auth.session ? handleLogout : null}
                  notice={homeNotice}
                  devTools={IS_DEV_VARIANT}
                />
              );
          }
        })()}
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
