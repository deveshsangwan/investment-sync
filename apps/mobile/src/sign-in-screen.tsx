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
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Investment Sync</Text>
        <Text style={styles.title}>Private portfolio viewer</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          style={styles.input}
          value={email}
        />
        <TextInput
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <Pressable
          disabled={isSubmitting}
          onPress={() => {
            void submit();
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Text>
        </Pressable>
      </View>
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
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 20,
    width: "100%",
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: {
    color: colors.foreground,
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 8,
  },
  input: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    padding: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 7,
    minHeight: 44,
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "800",
  },
});
