import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
    Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';

const { width } = Dimensions.get('window');

const MenuButton = ({ title, icon, color, onPress, theme }) => (
    <TouchableOpacity
        style={[styles.menuButton, { borderLeftColor: color, backgroundColor: theme.card }]}
        onPress={onPress}
        activeOpacity={0.7}
    >
        <View style={[styles.iconContainer, { backgroundColor: color }]}>
            <Text style={styles.iconText}>{icon}</Text>
        </View>
        <Text style={[styles.menuButtonText, { color: theme.text }]}>{title}</Text>
        <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
);

export default function HomeScreen({ user, onLogout, onNavigate }) {
    const { isDarkMode, toggleTheme, theme } = useTheme();

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
        Alert.alert('Próximamente', `El módulo de ${module} estará disponible pronto.`);
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.header }]}>
                <View>
                    <Text style={[styles.greeting, { color: theme.subText }]}>Hola,</Text>
                    <Text style={[styles.username, { color: theme.text }]}>{user?.username || 'Usuario'}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity
                        style={[styles.themeButton, { backgroundColor: theme.inputBackground }]}
                        onPress={toggleTheme}
                    >
                        <Text style={{ fontSize: 20 }}>{isDarkMode ? '🌞' : '🌙'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
                        <Text style={styles.logoutText}>Salir</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Main Content */}
            <View style={styles.content}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Mi Panel</Text>

                <MenuButton
                    title="Dinero"
                    icon="💰"
                    color="#4CAF50"
                    onPress={() => handlePress('Dinero')}
                    theme={theme}
                />

                <MenuButton
                    title="Serie/Anime"
                    icon="📺"
                    color="#2196F3"
                    onPress={() => handlePress('Series y Anime')}
                    theme={theme}
                />

                <MenuButton
                    title="Pendiente"
                    icon="📋"
                    color="#673AB7"
                    onPress={() => handlePress('Pendiente')}
                    theme={theme}
                />

                <MenuButton
                    title="Trabajo"
                    icon="💼"
                    color="#FF9800"
                    onPress={() => handlePress('Trabajo')}
                    theme={theme}
                />
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F7F7',
    },
    header: {
        padding: 24,
        backgroundColor: '#fff',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomLeftRadius: 30,
        borderBottomRightRadius: 30,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 15,
        elevation: 5,
        marginBottom: 20,
    },
    greeting: {
        fontSize: 16,
        color: '#888',
    },
    username: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#333',
    },
    logoutButton: {
        paddingHorizontal: 15,
        paddingVertical: 8,
        backgroundColor: '#FFEBEE',
        borderRadius: 20,
        marginLeft: 10,
    },
    logoutText: {
        color: '#FF5252',
        fontWeight: '600',
        fontSize: 14,
    },
    themeButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f0f0f0',
    },
    content: {
        flex: 1,
        padding: 20,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginBottom: 20,
        marginLeft: 5,
    },
    menuButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        padding: 20,
        borderRadius: 20,
        marginBottom: 15,
        borderLeftWidth: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 3,
    },
    iconContainer: {
        width: 50,
        height: 50,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 15,
    },
    iconText: {
        fontSize: 24,
    },
    menuButtonText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
        flex: 1,
    },
    arrow: {
        fontSize: 24,
        color: '#ccc',
        fontWeight: '300',
    },
});
