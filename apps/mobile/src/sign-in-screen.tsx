import { makeRedirectUri } from "expo-auth-session";
import { traceClerkRequests } from "./debug-clerk-fetch";
import { PortfolioIllustration } from "./portfolio-illustration";
import * as WebBrowser from "expo-web-browser";
import { AppText as Text } from "./app-text";
import { useAuth, useSSO } from "@clerk/clerk-expo";
import { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton, BrandMark } from "./mobile-ui";
import { type Theme, useTheme } from "./theme";

WebBrowser.maybeCompleteAuthSession();

export function SignInScreen() {
  const { startSSOFlow } = useSSO();
  const { isLoaded } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  async function submit() {
    if (!isLoaded || isSubmitting) return;

    setIsSubmitting(true);
    const restoreDiagnostics = __DEV__ ? traceClerkRequests() : undefined;

    try {
      const redirectUrl = makeRedirectUri({ path: "sso-callback" });

      if (__DEV__) {
        const callback = new URL(redirectUrl);
        console.info(
          "[DEBUG-clerk-callback]",
          JSON.stringify({ protocol: callback.protocol, host: callback.host }),
        );
      }

      const { createdSessionId, setActive, authSessionResult } =
        await startSSOFlow({
          strategy: "oauth_google",
          redirectUrl,
        });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      } else if (authSessionResult?.type === "success") {
        Alert.alert(
          "Sign-in needs another step",
          "Complete your account setup on the web, then sign in again.",
        );
      }
    } catch (error) {
      Alert.alert(
        "Could not sign in",
        error instanceof Error
          ? error.message
          : "Check your connection and try again.",
      );
    } finally {
      restoreDiagnostics?.();
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
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              alignSelf: "flex-start",
              marginBottom: 32,
            }}
          >
            <BrandMark size={40} />
            <Text
              style={{
                color: theme.foreground,
                fontWeight: "600",
                fontSize: 16,
              }}
            >
              Investment Sync
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Your portfolio, together</Text>
            <Text style={styles.title}>A clear view of what you own.</Text>
            <Text style={styles.description}>
              Stocks, funds, and retirement savings across your household. Sign
              in to see them in one place.
            </Text>

            <PortfolioIllustration />

            <AppButton
              disabled={isSubmitting || !isLoaded}
              label={isSubmitting ? "Signing in" : "Continue with Google"}
              onPress={() => void submit()}
            >
              {isSubmitting ? "Signing in..." : "Continue with Google"}
            </AppButton>
          </View>
          <Text style={styles.privacy}>
            Private to your household. Import statements on the web.
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
      borderRadius: 16,
      borderWidth: 1,
      gap: 20,
      marginTop: 16,
      padding: 24,
      width: "100%",
    },
    eyebrow: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: "600",
    },
    title: {
      color: theme.foreground,
      fontSize: 36,
      fontWeight: "600",
      letterSpacing: -1,
      lineHeight: 43,
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
