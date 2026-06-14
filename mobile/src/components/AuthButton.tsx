import { Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { logout } from "@/api";
import { useAuth } from "@/useAuth";
import { theme } from "@/theme";

export function AuthButton() {
  const { user } = useAuth();
  return user ? (
    <Pressable hitSlop={8} onPress={() => logout()} style={styles.wrap}>
      <Text style={styles.text}>Dil</Text>
    </Pressable>
  ) : (
    <Pressable hitSlop={8} onPress={() => router.push("/auth")} style={styles.wrap}>
      <Text style={[styles.text, { color: theme.primary }]}>Hyr</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12 },
  text: { color: theme.text, fontWeight: "800", fontSize: 16 },
});
