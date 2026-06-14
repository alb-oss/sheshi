import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "@/useTheme";

function ThemedStack() {
  const { theme, mode } = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { color: theme.text, fontWeight: "800" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        {/* title doubles as the back-button label on pushed screens (was the raw route group "(tabs)") */}
        {/* Detail screens (tema/[id], dhoma/[slug]) now live inside (tabs) so the dock persists. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Sheshi" }} />
        <Stack.Screen name="auth" options={{ title: "Hyr", presentation: "modal" }} />
      </Stack>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedStack />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
