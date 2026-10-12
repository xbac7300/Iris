import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useTheme } from '../src/theme';

function AppContent() {
  const { darkMode } = useTheme();
  return (
    <>
      <StatusBar style={darkMode ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="course/[id]" />
        <Stack.Screen name="course/edit/[id]" />
        <Stack.Screen name="player" />
      </Stack>
    </>
  );
}

export default function Layout() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
