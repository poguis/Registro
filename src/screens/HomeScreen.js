import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Dimensions, ScrollView } from 'react-native';
import { Text } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { useSheet } from '../hooks/useSheet';
import { backupAndShare } from '../services/backup';
import db from '../services/db';
import { showBackupResult } from './backupResult';
import SyncStatus from './SyncStatus';

const { width } = Dimensions.get('window');

// tone: un tono de identidad del tema (theme.tones.*), con fg (borde) y bg (fondo del ícono).
const MenuButton = ({ title, icon, tone, onPress, theme, disabled = false }) => (
    <TouchableOpacity
        style={[styles.menuButton, { borderLeftColor: tone.fg, backgroundColor: theme.surface, shadowColor: theme.shadow, opacity: disabled ? 0.6 : 1 }]}
        onPress={onPress}
        activeOpacity={0.7}
        disabled={disabled}
    >
        <View style={[styles.iconContainer, { backgroundColor: tone.bg }]}>
            <Text style={styles.iconText}>{icon}</Text>
        </View>
        <Text style={[styles.menuButtonText, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
        <Text style={[styles.arrow, { color: theme.muted }]}>›</Text>
    </TouchableOpacity>
);

// notice: aviso no bloqueante { text, actionLabel, onAction } (vincular / iniciar sesión).
// onLogout: solo si hay sesión de Google; cierra esa sesión y NO toca los datos locales.
// devTools: solo en la variante dev (acceso a la prueba de RLS).
export default function HomeScreen({ user, onLogout, onNavigate, notice, devTools }) {
    const { isDarkMode, toggleTheme, theme } = useTheme();
    const { confirm, informar, avisar } = useSheet();
    const [isBackingUp, setIsBackingUp] = useState(false);

    // Respaldo: copia física (.db) + JSON, y menú de compartir para sacarlos del teléfono.
    const handleBackup = async () => {
        if (isBackingUp) return;
        setIsBackingUp(true);
        try {
            const summary = await backupAndShare();
            // Fase 6.7: limpieza de respaldos/ solo cuando el .db y el .json nuevos ya están escritos;
            // el respaldo recién creado está protegido. Nunca bloquea ni falla el respaldo.
            db.cleanupBackups(summary.stamp).catch(() => {});
            showBackupResult(confirm, summary, 'Asegúrate de guardarlos fuera del teléfono (Drive, correo o PC).');
        } catch (error) {
            console.error('Error creating backup:', error);
            informar('Error', `No se pudo generar el respaldo. Tus datos no se modificaron.\n\n${error.message}`);
        } finally {
            setIsBackingUp(false);
        }
    };

    const handlePress = (module) => {
        if (module === 'Dinero') {
            onNavigate('DINERO');
            return;
        }
        if (module === 'Series y Anime') {
            onNavigate('SERIES_ANIME');
            return;
        }
        if (module === 'Pendiente') {
            onNavigate('PENDIENTE');
            return;
        }
        if (module === 'Trabajo') {
            onNavigate('TRABAJO');
            return;
        }
        avisar({ titulo: 'Próximamente', mensaje: `El módulo de ${module} estará disponible pronto.` });
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}>
                {/* flex: 1 + una línea: un email largo no empuja los botones fuera de la pantalla */}
                <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                    <Text style={[styles.greeting, { color: theme.muted }]}>Hola,</Text>
                    <Text style={[styles.username, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="middle">
                        {user?.username || 'Usuario'}
                    </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
                    <TouchableOpacity
                        style={[styles.themeButton, { backgroundColor: theme.raised }]}
                        onPress={toggleTheme}
                    >
                        <Text style={{ fontSize: 20 }}>{isDarkMode ? '🌞' : '🌙'}</Text>
                    </TouchableOpacity>
                    {onLogout && (
                        <TouchableOpacity style={[styles.logoutButton, { backgroundColor: theme.behindBg }]} onPress={onLogout}>
                            <Text style={[styles.logoutText, { color: theme.behindFg }]} numberOfLines={1}>Cerrar sesión</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {notice && (
                <View style={[styles.notice, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
                    <Text style={[styles.noticeText, { color: theme.ink }]}>{notice.text}</Text>
                    {notice.actionLabel && (
                        <TouchableOpacity onPress={notice.onAction} disabled={notice.busy}>
                            <Text style={[styles.noticeAction, { color: theme.accent }]} numberOfLines={1}>
                                {notice.busy ? 'Conectando…' : notice.actionLabel}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* Main Content */}
            {/* Estado de sincronización: solo donde la sync está habilitada (dev hasta la Fase 5). */}
            {user?.linked && <SyncStatus />}

            {/* Desplazable: con el aviso arriba, las últimas opciones no caben en pantallas pequeñas. */}
            <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
                <Text style={[styles.sectionTitle, { color: theme.ink }]}>Mi Panel</Text>

                <MenuButton
                    title="Dinero"
                    icon="💰"
                    tone={theme.tones.verde}
                    onPress={() => handlePress('Dinero')}
                    theme={theme}
                />

                <MenuButton
                    title="Serie/Anime"
                    icon="📺"
                    tone={theme.tones.azul}
                    onPress={() => handlePress('Series y Anime')}
                    theme={theme}
                />

                <MenuButton
                    title="Pendiente"
                    icon="📋"
                    tone={theme.tones.morado}
                    onPress={() => handlePress('Pendiente')}
                    theme={theme}
                />

                <MenuButton
                    title="Trabajo"
                    icon="💼"
                    tone={theme.tones.naranja}
                    onPress={() => handlePress('Trabajo')}
                    theme={theme}
                />

                <Text style={[styles.sectionTitle, { color: theme.ink, marginTop: 10 }]}>Datos</Text>

                <MenuButton
                    title={isBackingUp ? 'Generando respaldo…' : 'Respaldar datos'}
                    icon="💾"
                    tone={theme.tones.pizarra}
                    onPress={handleBackup}
                    theme={theme}
                    disabled={isBackingUp}
                />

                {devTools && (
                    <MenuButton
                        title="Prueba de RLS (dev)"
                        icon="🧪"
                        tone={theme.tones.rojo}
                        onPress={() => onNavigate('RLS_TEST')}
                        theme={theme}
                    />
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        padding: 24,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomLeftRadius: RADIUS.sheet,
        borderBottomRightRadius: RADIUS.sheet,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 15,
        elevation: 5,
        marginBottom: 20,
    },
    greeting: {
        fontSize: 16,
    },
    username: {
        fontSize: 28,
        fontFamily: FONT.bold,
    },
    logoutButton: {
        paddingHorizontal: 15,
        paddingVertical: 8,
        borderRadius: RADIUS.sm,
        marginLeft: 10,
    },
    notice: {
        marginHorizontal: 20,
        marginTop: -5,
        marginBottom: 10,
        padding: 14,
        borderRadius: RADIUS.base,
        borderWidth: 1,
    },
    noticeText: {
        fontSize: 14,
        marginBottom: 6,
    },
    noticeAction: {
        fontSize: 14,
        fontFamily: FONT.bold,
    },
    logoutText: {
        fontFamily: FONT.semibold,
        fontSize: 14,
    },
    themeButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flex: 1,
    },
    contentInner: {
        padding: 20,
        paddingBottom: 40,
    },
    sectionTitle: {
        fontSize: 18,
        fontFamily: FONT.semibold,
        marginBottom: 20,
        marginLeft: 5,
    },
    menuButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        borderRadius: RADIUS.base,
        marginBottom: 15,
        borderLeftWidth: 5,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 3,
    },
    iconContainer: {
        width: 50,
        height: 50,
        borderRadius: RADIUS.sm,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 15,
    },
    iconText: {
        fontSize: 24,
    },
    menuButtonText: {
        fontSize: 18,
        fontFamily: FONT.bold,
        flex: 1,
        minWidth: 0,
    },
    arrow: {
        fontSize: 24,
        fontFamily: FONT.regular,
    },
});
