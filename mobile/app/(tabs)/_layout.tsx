import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthButton } from "@/components/AuthButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HeaderBack } from "@/components/HeaderBack";
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
            {/* Liquid glass: a strong frost that the feed visibly blurs through, with only a thin
                tint on top for legibility (not a near-opaque bar). */}
            <BlurView
              tint={mode === "dark" ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
              intensity={mode === "dark" ? 55 : 90}
              style={StyleSheet.absoluteFill}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.glass, opacity: 0.5 }]} />
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
      <Tabs.Screen
        name="profili"
        options={{
          title: "Profili",
          tabBarLabel: "Profili",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
        }}
      />
      {/* Detail screens live inside the tabs navigator so the dock stays visible, but are hidden from
          the bar (href: null) and get a back button instead of the theme toggle on the left. */}
      <Tabs.Screen
        name="tema/[id]"
        options={{ href: null, title: "Tema", headerLeft: () => <HeaderBack /> }}
      />
      <Tabs.Screen
        name="dhoma/[slug]"
        options={{ href: null, title: "Dhomë", headerLeft: () => <HeaderBack /> }}
      />
    </Tabs>
  );
}
