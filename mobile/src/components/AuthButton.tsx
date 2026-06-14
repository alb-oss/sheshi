import { Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { logout } from "@/api";
import { useAuth } from "@/useAuth";
import { useTheme } from "@/useTheme";

export function AuthButton() {
  const { user } = useAuth();
  const { theme } = useTheme();
  return user ? (
    <Pressable hitSlop={8} onPress={() => logout()} style={styles.wrap}>
      <Text style={[styles.text, { color: theme.text }]}>Dil</Text>
    </Pressable>
  ) : (
    <Pressable hitSlop={8} onPress={() => router.push("/auth")} style={styles.wrap}>
      <Text style={[styles.text, { color: theme.primary }]}>Hyr</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12 },
  text: { fontWeight: "800", fontSize: 16 },
});
