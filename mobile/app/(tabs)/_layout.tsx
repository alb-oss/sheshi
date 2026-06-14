import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthButton } from "@/components/AuthButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/useTheme";

export default function TabsLayout() {
  const { theme, mode } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenListeners={{
        tabPress: () => {
          Haptics.selectionAsync().catch(() => {});
        },
      }}
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { color: theme.text, fontWeight: "800" },
        headerShadowVisible: false,
        headerLeft: () => <ThemeToggle />,
        headerRight: () => <AuthButton />,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        // Liquid glass: translucent bar the feed scrolls under.
        tabBarStyle: {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 49 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
          backgroundColor: "transparent",
          borderTopColor: theme.glassBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
        },
        tabBarBackground: () => (
          <View style={StyleSheet.absoluteFill}>
            <BlurView
              tint={mode === "dark" ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
              intensity={mode === "dark" ? 36 : 64}
              style={StyleSheet.absoluteFill}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.glass }]} />
          </View>
        ),
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Sheshi",
          tabBarLabel: "Sheshi",
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="fokus"
        options={{
          title: "Në Fokus",
          tabBarLabel: "Fokus",
          tabBarIcon: ({ color, size }) => <Ionicons name="flame" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="dhoma"
        options={{
          title: "Dhoma",
          tabBarLabel: "Dhoma",
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
