import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { useTheme } from '../contexts/ThemeContext';

// Barras del sistema (dirección visual). Con edge-to-edge (activo siempre en Android 16 y, desde
// esta subfase, también en versiones anteriores: app.json android.edgeToEdgeEnabled = true) las
// barras son transparentes: detrás se ve el `bg` de la raíz y cada pantalla respeta los insets
// (SafeAreaView). Aquí solo se fija el color de los ÍCONOS según el modo:
//   - barra de estado: expo-status-bar `style` (backgroundColor no tiene efecto con edge-to-edge);
//   - barra de navegación: expo-navigation-bar `setButtonStyleAsync` (setBackgroundColorAsync no
//     tiene efecto con edge-to-edge en SDK 54).
export default function SystemBars() {
    const { isDarkMode } = useTheme();
    useEffect(() => {
        NavigationBar.setButtonStyleAsync(isDarkMode ? 'light' : 'dark').catch(() => {});
    }, [isDarkMode]);
    return <StatusBar style={isDarkMode ? 'light' : 'dark'} />;
}
