// Sun/moon header button — flips light↔dark, mirroring the web app's toggle.
import { Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/useTheme";

export function ThemeToggle() {
  const { theme, mode, toggle } = useTheme();
  return (
    <Pressable
      hitSlop={10}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        toggle();
      }}
      style={styles.wrap}
      accessibilityRole="switch"
      accessibilityLabel={mode === "dark" ? "Kalo në temë të çelët" : "Kalo në temë të errët"}
    >
      <Ionicons
        name={mode === "dark" ? "sunny-outline" : "moon-outline"}
        size={22}
        color={theme.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12 },
});
