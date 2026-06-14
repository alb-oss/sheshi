import { Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/useTheme";

// Back button for detail screens that live inside the tabs navigator (so the dock stays visible);
// the tab navigator doesn't add one, so we render our own.
export function HeaderBack() {
  const { theme } = useTheme();
  return (
    <Pressable
      hitSlop={10}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      style={styles.wrap}
      accessibilityRole="button"
      accessibilityLabel="Kthehu"
    >
      <Ionicons name="chevron-back" size={26} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 8 },
});
