import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

const ThemeContext = createContext();

export const colors = {
    light: {
        background: '#F7F7F7',
        card: '#FFFFFF',
        text: '#333333',
        subText: '#888888',
        accent: '#2196F3',
        border: '#EEEEEE',
        inputBackground: '#F5F5F7',
        header: '#FFFFFF',
        success: '#4CAF50',
        error: '#FF5252',
        info: '#E3F2FD',
        infoText: '#1565C0',
        modalOverlay: 'rgba(0,0,0,0.5)',
    },
    dark: {
        background: '#121212',
        card: '#1E1E1E',
        text: '#E0E0E0',
        subText: '#A0A0A0',
        accent: '#64B5F6',
        border: '#333333',
        inputBackground: '#2C2C2E',
        header: '#1E1E1E',
        success: '#66BB6A',
        error: '#FF8A80',
        info: '#1A237E',
        infoText: '#90CAF9',
        modalOverlay: 'rgba(0,0,0,0.7)',
    }
};

export const ThemeProvider = ({ children }) => {
    const systemColorScheme = useColorScheme();
    const [isDarkMode, setIsDarkMode] = useState(systemColorScheme === 'dark');

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

    const theme = isDarkMode ? colors.dark : colors.light;

    return (
        <ThemeContext.Provider value={{ isDarkMode, toggleTheme, theme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
