import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listUserMessages, logout } from "@/api";
import { PostCard } from "@/components/PostCard";
import { useAuth } from "@/useAuth";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";
import type { MessageRow } from "@/types";

export default function Profili() {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();

  const [tab, setTab] = useState<"posts" | "comments">("posts");
  const [items, setItems] = useState<MessageRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setListLoading(true);
    listUserMessages(userId, tab)
      .then((p) => alive && setItems(p.items))
      .catch(() => alive && setItems([]))
      .finally(() => alive && setListLoading(false));
    return () => {
      alive = false;
    };
  }, [userId, tab]);

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
        <View style={styles.karmaRow}>
          <Ionicons name="ribbon" size={16} color={theme.primary} />
          <Text style={styles.karmaText}>{user?.karma ?? 0} karma</Text>
        </View>
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

      {/* Posts / comments */}
      <View style={styles.tabs}>
        {(["posts", "comments"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "posts" ? "Postimet" : "Përgjigjet"}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.list}>
        {listLoading ? (
          <ActivityIndicator color={theme.textMuted} style={{ marginVertical: 20 }} />
        ) : items.length === 0 ? (
          <Text style={styles.listEmpty}>{tab === "posts" ? "Asnjë postim ende." : "Asnjë përgjigje ende."}</Text>
        ) : (
          items.map((m) => (
            <View key={m.id} style={styles.listItem}>
              <PostCard
                message={m}
                compact
                currentUserId={userId ?? null}
                onPress={() => router.push(`/tema/${m.id}`)}
              />
            </View>
          ))
        )}
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
    karmaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
    karmaText: { color: t.primary, fontSize: 15, fontWeight: "800" },
    email: { color: t.textFaint, fontSize: 13, marginTop: 4 },
    roles: { flexDirection: "row", gap: 6, marginTop: 10 },
    roleChip: { backgroundColor: t.primary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
    roleText: { color: t.onPrimary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
    tabs: { flexDirection: "row", gap: 6, marginTop: 16 },
    tab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.md, backgroundColor: t.card },
    tabActive: { backgroundColor: t.primary },
    tabText: { color: t.textMuted, fontWeight: "800", fontSize: 14 },
    tabTextActive: { color: t.onPrimary },
    list: {
      marginTop: 10,
      backgroundColor: t.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      overflow: "hidden",
    },
    listItem: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    listEmpty: { color: t.textMuted, fontSize: 14, padding: 16 },
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
