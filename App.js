import React, { useState, useEffect, useCallback } from 'react';
import { View, ActivityIndicator, BackHandler } from 'react-native';
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
import { startSyncTriggers } from './src/sync/controller';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { SheetProvider } from './src/contexts/SheetContext';
import { useSheet } from './src/hooks/useSheet';
import SystemBars from './src/components/SystemBars';
import { cerrarHojaAbierta } from './src/hooks/hojasAbiertas';
import { HojasHost } from './src/components/HojaConTeclado';

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

// Raíz (dirección visual): tema → insets → hojas y avisos → barras del sistema → contenido. Todo
// (también la pantalla de error de la BD, el login y la vinculación) queda dentro de los
// proveedores, así que ninguna alerta usa el diálogo del sistema. Hasta leer la preferencia de tema se
// pinta solo el fondo, para no mostrar un instante el modo equivocado.
export default function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <SheetProvider>
          <Root />
        </SheetProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

function Root() {
  const { theme, ready } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SystemBars />
      {ready ? <AppContent /> : null}
      {/* 1.4.4: las hojas con teclado se dibujan aquí (la ventana entera, sin padding), encima de la pantalla */}
      <HojasHost />
    </View>
  );
}

function AppContent() {
  const { theme } = useTheme();
  const { confirm, informar, avisar } = useSheet();
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
          informar('Actualización de datos completada', formatMigrationSummary(res.summary));
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

  // Sincronización: disparadores solo con cuenta vinculada y la sync habilitada (las dos
  // variantes desde la Fase 5). Al vincular, `user` cambia y se vuelve a montar: el primer ciclo
  // hace la primera subida (ensureInitialUpload). Nunca bloquea la app.
  useEffect(() => {
    if (!user || !user.linked) return undefined;
    return startSyncTriggers();
  }, [user]);

  const handleBack = useCallback(() => {
    // Fase 7.5b1 (1.4.3): con una hoja con teclado abierta, Atrás la cierra y nunca navega. Este es
    // el único listener de hardwareBackPress de la app; las hojas se apilan en hojasAbiertas.js.
    if (cerrarHojaAbierta()) return true;
    if (navigationHistory.length > 0) {
      const newHistory = [...navigationHistory];
      const prevView = newHistory.pop();
      setNavigationHistory(newHistory);
      setCurrentView(prevView);
      return true; // Prevent default behavior (exiting app)
    }

    if (currentView === 'HOME') {
      confirm({
        titulo: 'Salir',
        mensaje: '¿Estás seguro de que quieres salir de la aplicación?',
        acciones: [
          { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
          { clave: 'salir', texto: 'Salir', variante: 'destructiva' },
        ],
      }).then((clave) => { if (clave === 'salir') BackHandler.exitApp(); });
      return true;
    }

    // Default: if no history and not in HOME (e.g. LOGIN), let system handle it
    return false;
  }, [navigationHistory, currentView, confirm]);

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
      informar('Inicio de sesión', 'No se completó el inicio de sesión, inténtalo de nuevo.');
      return;
    }
    if (r.status === 'error') {
      informar('No se completó el inicio de sesión', `${r.message}

Inténtalo de nuevo.`);
      return;
    }
    const next = await afterGoogleLogin(r.session);
    if (next.kind === 'ready') {
      enterApp(next.user);
    } else if (next.kind === 'confirm-link') {
      setPendingLink({ email: next.email, localUsername: next.localUser.username, session: r.session });
    } else if (next.kind === 'blocked') {
      informar(
        'Cuenta no permitida',
        next.reason === 'other-account'
          ? `Los datos de este dispositivo pertenecen a ${next.linkedEmail || 'otra cuenta'}. No se cambió nada.`
          : 'Hay varias cuentas locales en este dispositivo; la vinculación necesita una sola. No se cambió nada.'
      );
    } else {
      informar('Error', next.message);
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
        avisar({ titulo: 'Cuenta vinculada', mensaje: `Tus datos ahora están vinculados a ${res.user.email}.` });
      } else {
        setPendingLink(null);
        informar('No se vinculó', `${res.message}

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
    confirm({
      titulo: 'Cerrar sesión de Google',
      mensaje: 'Tus datos se quedan en este dispositivo y la app sigue funcionando sin conexión. Podrás volver a iniciar sesión cuando quieras.',
      acciones: [
        { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
        { clave: 'cerrar', texto: 'Cerrar sesión', variante: 'destructiva' },
      ],
    }).then((clave) => { if (clave === 'cerrar') auth.signOut(); });
  };

  const handleChooseLocal = async (localUser) => {
    await chooseLocalUser(localUser);
    enterApp(localUser);
  };

  // Aviso no bloqueante en Home. Sin red con la sesión guardada (sessionOffline) no se pide
  // iniciar sesión: se renueva sola al volver la conexión.
  const homeNotice = !user || !auth.configured ? null
    : !user.linked
      ? { text: 'Vincula tu cuenta de Google para poder sincronizar tus datos más adelante.', actionLabel: 'Vincular con Google', onAction: handleGoogle, busy: auth.signingIn }
      : !auth.session && !auth.sessionOffline
        ? { text: 'Inicia sesión con Google para sincronizar (tus datos locales siguen disponibles).', actionLabel: 'Iniciar sesión', onAction: handleGoogle, busy: auth.signingIn }
        : null;

  const handleNavigate = (view) => {
    setNavigationHistory(prev => [...prev, currentView]);
    setCurrentView(view);
  };

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (dbError) {
    return <DatabaseErrorScreen errorMessage={dbError} onRetry={initialize} />;
  }

  // Router simple basado en estado
  return (
    <>
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
                  onLogout={auth.session || auth.sessionOffline ? handleLogout : null}
                  notice={homeNotice}
                  devTools={IS_DEV_VARIANT}
                />
              );
          }
        })()}
    </>
  );
}
