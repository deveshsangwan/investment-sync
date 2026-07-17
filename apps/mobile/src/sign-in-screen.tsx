import { useSignIn } from "@clerk/clerk-expo";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton, BrandMark } from "./mobile-ui";
import { type Theme, useTheme } from "./theme";

export function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isDisabled = !isLoaded || isSubmitting || !email.trim() || !password;

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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.authLayout}>
            <BrandMark size={48} />
            <View style={styles.card}>
              <Text style={styles.eyebrow}>Investment Sync</Text>
              <Text style={styles.title}>
                Your household portfolio, in one view
              </Text>
              <Text style={styles.description}>
                Sign in to review committed holdings. Imports remain available
                on the web app.
              </Text>

              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  accessibilityLabel="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onBlur={() => setFocusedField(null)}
                  onChangeText={setEmail}
                  onFocus={() => setFocusedField("email")}
                  placeholder="you@example.com"
                  placeholderTextColor={theme.mutedForeground}
                  returnKeyType="next"
                  selectionColor={theme.primary}
                  style={[
                    styles.input,
                    focusedField === "email" && styles.inputFocused,
                  ]}
                  textContentType="emailAddress"
                  value={email}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  accessibilityLabel="Password"
                  autoComplete="current-password"
                  onBlur={() => setFocusedField(null)}
                  onChangeText={setPassword}
                  onFocus={() => setFocusedField("password")}
                  onSubmitEditing={() => {
                    if (!isDisabled) void submit();
                  }}
                  placeholder="Enter your password"
                  placeholderTextColor={theme.mutedForeground}
                  returnKeyType="done"
                  secureTextEntry
                  selectionColor={theme.primary}
                  style={[
                    styles.input,
                    focusedField === "password" && styles.inputFocused,
                  ]}
                  textContentType="password"
                  value={password}
                />
              </View>

              <AppButton
                disabled={isDisabled}
                label={isSubmitting ? "Signing in" : "Sign in"}
                onPress={() => void submit()}
              >
                {isSubmitting ? "Signing in..." : "Sign in"}
              </AppButton>
            </View>
            <Text style={styles.privacy}>
              Private by household · Source files retained for up to 30 days
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.background, flex: 1 },
    keyboardView: { flex: 1 },
    content: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: 20,
      paddingVertical: 28,
    },
    authLayout: {
      alignItems: "center",
      alignSelf: "center",
      maxWidth: 420,
      width: "100%",
    },
    card: {
      backgroundColor: theme.card,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      gap: 14,
      marginTop: 16,
      padding: 22,
      width: "100%",
    },
    eyebrow: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: "700",
    },
    title: {
      color: theme.foreground,
      fontSize: 29,
      fontWeight: "700",
      letterSpacing: -1,
      lineHeight: 34,
    },
    description: {
      color: theme.mutedForeground,
      fontSize: 14,
      lineHeight: 21,
      marginBottom: 2,
    },
    field: { gap: 7 },
    label: { color: theme.foreground, fontSize: 13, fontWeight: "600" },
    input: {
      backgroundColor: theme.background,
      borderColor: theme.input,
      borderRadius: 12,
      borderWidth: 1,
      color: theme.foreground,
      fontSize: 16,
      minHeight: 48,
      paddingHorizontal: 13,
      paddingVertical: 11,
    },
    inputFocused: { borderColor: theme.primary, borderWidth: 2 },
    privacy: {
      color: theme.mutedForeground,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 16,
      maxWidth: 320,
      textAlign: "center",
    },
  });
}
