import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { login } from "@/api";
import { radius, type Palette } from "@/theme";
import { useTheme } from "@/useTheme";

export default function Auth() {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch {
      setError("Hyrja dështoi. Kontrollo email-in dhe fjalëkalimin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.wrap}>
        <View style={styles.logo} />
        <Text style={styles.title}>Mirësevini në Sheshi</Text>
        <Text style={styles.subtitle}>Hyni për të marrë pjesë në diskutim.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="ti@shembull.al"
            placeholderTextColor={theme.textFaint}
            style={styles.input}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Fjalëkalimi</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={theme.textFaint}
            style={styles.input}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable onPress={submit} disabled={busy} style={[styles.btn, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={styles.btnText}>Hyr</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 12 },
    logo: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: t.primary, marginBottom: 4 },
    title: { color: t.text, fontSize: 24, fontWeight: "900" },
    subtitle: { color: t.textMuted, fontSize: 15, marginBottom: 8 },
    field: { gap: 6 },
    label: { color: t.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
    input: {
      backgroundColor: t.card,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      color: t.text,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    error: { color: t.primary, fontSize: 13 },
    btn: {
      marginTop: 8,
      backgroundColor: t.primary,
      borderRadius: radius.pill,
      paddingVertical: 15,
      alignItems: "center",
    },
    btnText: { color: t.onPrimary, fontSize: 16, fontWeight: "800" },
  });
}
