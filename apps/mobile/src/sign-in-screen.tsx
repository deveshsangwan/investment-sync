import { useSSO } from "@clerk/clerk-expo";
import { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton, BrandMark } from "./mobile-ui";
import { type Theme, useTheme } from "./theme";

export function SignInScreen() {
  const { startSSOFlow } = useSSO();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  async function submit() {
    setIsSubmitting(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
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
      <ScrollView
        contentContainerStyle={styles.content}
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
              Sign in to review committed holdings. Imports remain available on
              the web app.
            </Text>

            <AppButton
              disabled={isSubmitting}
              label={isSubmitting ? "Signing in" : "Continue with Google"}
              onPress={() => void submit()}
            >
              {isSubmitting ? "Signing in..." : "Continue with Google"}
            </AppButton>
          </View>
          <Text style={styles.privacy}>
            Private by household · Source files retained for up to 30 days
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.background, flex: 1 },
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
