import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { logout } from "@/api";
import { useAuth } from "@/useAuth";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";

export default function Profili() {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();

  if (ready && !user) {
    return (
      <View style={styles.empty}>
        <Ionicons name="person-circle-outline" size={72} color={theme.textFaint} />
        <Text style={styles.emptyTitle}>Profili juaj</Text>
        <Text style={styles.emptyBody}>Hyni për të parë profilin dhe për të marrë pjesë.</Text>
        <Pressable onPress={() => router.push("/auth")} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Hyr</Text>
        </Pressable>
      </View>
    );
  }

  const name = user?.display_name || user?.username || "anonim";
  const handle = "@" + (user?.username || "anonim");
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const roles = (user?.roles ?? []).filter((r) => r !== "user");

  return (
    <ScrollView style={styles.flex} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 61 }}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials || "??"}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.handle}>{handle}</Text>
        {user?.email ? <Text style={styles.email}>{user.email}</Text> : null}
        {roles.length ? (
          <View style={styles.roles}>
            {roles.map((r) => (
              <View key={r} style={styles.roleChip}>
                <Text style={styles.roleText}>{r}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <Pressable onPress={() => logout()} style={styles.signOut}>
        <Ionicons name="log-out-outline" size={18} color={theme.primary} />
        <Text style={styles.signOutText}>Dil</Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24, backgroundColor: t.bg },
    emptyTitle: { color: t.text, fontSize: 20, fontWeight: "800", marginTop: 4 },
    emptyBody: { color: t.textMuted, fontSize: 14, textAlign: "center" },
    primaryBtn: {
      marginTop: 12,
      backgroundColor: t.primary,
      borderRadius: radius.pill,
      paddingHorizontal: 28,
      paddingVertical: 12,
    },
    primaryBtnText: { color: t.onPrimary, fontWeight: "800", fontSize: 15 },
    card: {
      alignItems: "center",
      gap: 4,
      backgroundColor: t.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 24,
    },
    avatar: {
      width: 84,
      height: 84,
      borderRadius: radius.pill,
      backgroundColor: t.card2,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 6,
    },
    avatarText: { color: t.primary, fontWeight: "900", fontSize: 28 },
    name: { color: t.text, fontSize: 20, fontWeight: "800" },
    handle: { color: t.textMuted, fontSize: 14 },
    email: { color: t.textFaint, fontSize: 13, marginTop: 2 },
    roles: { flexDirection: "row", gap: 6, marginTop: 10 },
    roleChip: { backgroundColor: t.primary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
    roleText: { color: t.onPrimary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
    signOut: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.primary,
      borderRadius: radius.lg,
      paddingVertical: 14,
    },
    signOutText: { color: t.primary, fontSize: 15, fontWeight: "800" },
  });
}
