import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

// Dirección visual A "Hueso y petróleo" (Fase 7). Este archivo es la ÚNICA fuente de colores,
// fuentes y radios de la app: ninguna pantalla usa colores fijos (scripts/probar-tema.mjs lo
// comprueba). Los contrastes de cada token también los verifica probar-tema.

// Plus Jakarta Sans, embebida en el APK por el config plugin de expo-font (app.json). En Android
// cada peso es su propia familia (el nombre del archivo); fontWeight no elige el archivo, así que
// los textos usan estas familias (src/components/AppText.js convierte fontWeight si aparece).
export const FONT = {
    regular: 'PlusJakartaSans_400Regular',
    medium: 'PlusJakartaSans_500Medium',
    semibold: 'PlusJakartaSans_600SemiBold',
    bold: 'PlusJakartaSans_700Bold',
};

export const RADIUS = { base: 18, sm: 11, sheet: 24 };

export const colors = {
    light: {
        bg: '#F6F1E8',
        surface: '#FFFDF8',
        raised: '#EFE8DC',
        ink: '#24211D',
        muted: '#6B6359',
        line: '#E3D9CA', // separadores decorativos (no se le exige 3:1)
        lineStrong: '#8C8275', // bordes de campos y controles (≥ 3:1)
        accent: '#1F6B73',
        onAccent: '#FFFFFF',
        soft: '#DCEBEA',
        overlay: 'rgba(36,33,29,0.48)',
        aheadFg: '#1D5FA8', aheadBg: '#E1EBF7',
        behindFg: '#9A4A00', behindBg: '#FAE3CD',
        okFg: '#4F4A44', okBg: '#EAE4DA',
        danger: '#9A4A00', onDanger: '#FFFFFF',
        shadow: '#24211D',
        money: { ingreso: '#2E6B34', gasto: '#B3261E', deuda: '#7A3E9D' },
        tones: {
            verde: { fg: '#2E6B34', bg: '#E3EFE3' },
            azul: { fg: '#1D5FA8', bg: '#E1EBF7' },
            morado: { fg: '#6A3FA0', bg: '#ECE3F5' },
            naranja: { fg: '#9A4A00', bg: '#FAE3CD' },
            rojo: { fg: '#B3261E', bg: '#F7DEDB' },
            pizarra: { fg: '#4F5B66', bg: '#E3E7EB' },
        },
    },
    dark: {
        bg: '#181614',
        surface: '#221F1C',
        raised: '#2D2925',
        ink: '#F1EBE2',
        muted: '#B3A899',
        line: '#3A352F',
        lineStrong: '#807769',
        accent: '#62B5BC',
        onAccent: '#0D2325',
        soft: '#1D3436',
        overlay: 'rgba(0,0,0,0.60)',
        aheadFg: '#93BEF2', aheadBg: '#1B2C42',
        behindFg: '#F2A866', behindBg: '#3B2716',
        okFg: '#CFC7BC', okBg: '#2F2B27',
        danger: '#F2A866', onDanger: '#24211D',
        shadow: '#000000',
        money: { ingreso: '#7CC48A', gasto: '#F2948C', deuda: '#C9A2E6' },
        tones: {
            verde: { fg: '#7CC48A', bg: '#1C3121' },
            azul: { fg: '#93BEF2', bg: '#1B2C42' },
            morado: { fg: '#C3A3EC', bg: '#2D2340' },
            naranja: { fg: '#F2A866', bg: '#3B2716' },
            rojo: { fg: '#F2948C', bg: '#3E1F1C' },
            pizarra: { fg: '#AEBBC6', bg: '#262D33' },
        },
    },
};

// Estilos de texto del tema (familia + tamaño). El color lo pone cada pantalla con sus tokens.
export const TYPE = {
    tituloHoja: { fontFamily: FONT.bold, fontSize: 22, lineHeight: 28 },
    titulo: { fontFamily: FONT.bold, fontSize: 20, lineHeight: 26 },
    subtitulo: { fontFamily: FONT.semibold, fontSize: 16, lineHeight: 22 },
    cuerpo: { fontFamily: FONT.regular, fontSize: 15, lineHeight: 21 },
    mensaje: { fontFamily: FONT.regular, fontSize: 15, lineHeight: 22 },
    etiqueta: { fontFamily: FONT.medium, fontSize: 13, lineHeight: 18 },
    chip: { fontFamily: FONT.semibold, fontSize: 12, lineHeight: 16 },
};

// Color con opacidad (para gráficos y fondos suaves derivados de un token).
export const withAlpha = (hex, alpha) => {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
};

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
    // Preferencia guardada en AsyncStorage ('app_theme' = 'light' | 'dark'), como antes. Sin
    // preferencia, el valor inicial del sistema (app.json fija userInterfaceStyle "light").
    // "Seguir el sistema" queda pendiente: no se agrega.
    const systemColorScheme = useColorScheme();
    const [isDarkMode, setIsDarkMode] = useState(systemColorScheme === 'dark');
    const [ready, setReady] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const savedTheme = await AsyncStorage.getItem('app_theme');
            if (savedTheme !== null) {
                setIsDarkMode(savedTheme === 'dark');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setReady(true);
        }
    };

    const toggleTheme = async () => {
        const newValue = !isDarkMode;
        setIsDarkMode(newValue);
        try {
            await AsyncStorage.setItem('app_theme', newValue ? 'dark' : 'light');
        } catch (e) {
            console.error(e);
        }
    };

    const value = useMemo(() => ({
        isDarkMode,
        toggleTheme,
        ready,
        theme: isDarkMode ? colors.dark : colors.light,
        font: (peso = 'regular') => FONT[peso] || FONT.regular,
        type: TYPE,
        radius: RADIUS,
    }), [isDarkMode, ready]);

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
