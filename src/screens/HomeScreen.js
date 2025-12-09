import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    Dimensions,
    Alert
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

const { width } = Dimensions.get('window');

const MenuButton = ({ title, icon, color, onPress }) => (
    <TouchableOpacity
        style={[styles.menuButton, { borderLeftColor: color }]}
        onPress={onPress}
        activeOpacity={0.7}
    >
        <View style={[styles.iconContainer, { backgroundColor: color }]}>
            <Text style={styles.iconText}>{icon}</Text>
        </View>
        <Text style={styles.menuButtonText}>{title}</Text>
        <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
);

export default function HomeScreen({ user, onLogout }) {
    const handlePress = (module) => {
        Alert.alert('Próximamente', `El módulo de ${module} estará disponible pronto.`);
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar style="dark" />

            {/* Header */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.greeting}>Hola,</Text>
                    <Text style={styles.username}>{user?.username || 'Usuario'}</Text>
                </View>
                <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
                    <Text style={styles.logoutText}>Salir</Text>
                </TouchableOpacity>
            </View>

            {/* Main Content */}
            <View style={styles.content}>
                <Text style={styles.sectionTitle}>Mi Panel</Text>

                <MenuButton
                    title="Dinero"
                    icon="💰"
                    color="#4CAF50"
                    onPress={() => handlePress('Dinero')}
                />

                <MenuButton
                    title="Serie/Anime"
                    icon="📺"
                    color="#2196F3"
                    onPress={() => handlePress('Series y Anime')}
                />

                <MenuButton
                    title="Pendiente"
                    icon="📋"
                    color="#FF9800"
                    onPress={() => handlePress('Pendientes')}
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
        backgroundColor: '#f0f0f0',
        borderRadius: 20,
    },
    logoutText: {
        color: '#FF5252',
        fontWeight: '600',
        fontSize: 14,
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
