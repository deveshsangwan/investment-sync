import { useSignIn } from "@clerk/clerk-expo";
import { useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors } from "./theme";

export function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    if (!isLoaded) return;
    setIsSubmitting(true);
    try {
      const result = await signIn.create({ identifier: email, password });
      await setActive({ session: result.createdSessionId });
    } catch (error) {
      Alert.alert(
        "Could not sign in",
        error instanceof Error ? error.message : "Check your Clerk settings.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>IS</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Investment Sync</Text>
        <Text style={styles.title}>Your household portfolio, in one view</Text>
        <Text style={styles.description}>
          Sign in to review committed holdings. Imports remain available on the
          web app.
        </Text>
        <Text style={styles.label}>Email</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={email}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.muted}
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <Pressable
          disabled={isSubmitting || !email.trim() || !password}
          onPress={() => {
            void submit();
          }}
          style={[
            styles.button,
            (isSubmitting || !email.trim() || !password) &&
              styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonText}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.privacy}>
        Private by household · Source files retained for up to 30 days
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  brandMark: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 16,
    height: 52,
    justifyContent: "center",
    marginBottom: 14,
    width: 52,
  },
  brandMarkText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    padding: 22,
    width: "100%",
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: {
    color: colors.foreground,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -1,
    lineHeight: 35,
    marginBottom: 8,
  },
  description: { color: colors.muted, lineHeight: 21, marginBottom: 8 },
  label: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.foreground,
    padding: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 14,
    minHeight: 44,
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    color: "#fff",
    fontWeight: "800",
  },
  privacy: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
    maxWidth: 320,
    textAlign: "center",
  },
});
