import Ionicons from "@expo/vector-icons/Ionicons";
import { ClerkProvider } from "@clerk/clerk-expo";
import { Tabs } from "expo-router";
import { StatusBar } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { tokenCache } from "../src/auth-token-cache";
import { readMobileConfiguration } from "../src/config";
import { StatePanel } from "../src/mobile-ui";
import { useTheme } from "../src/theme";
import { MobilePortfolioProvider } from "../src/convex-provider";

export default function RootLayout() {
  const theme = useTheme();

  const configuration = readMobileConfiguration({
    convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL,
    clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });

  if ("error" in configuration) {
    return (
      <SafeAreaProvider>
        <SafeAreaView
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 18,
            backgroundColor: theme.background,
          }}
        >
          <StatePanel
            title="Portfolio service is not configured"
            description={configuration.error}
            tone="error"
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        backgroundColor={theme.background}
        barStyle={theme.isDark ? "light-content" : "dark-content"}
      />
      <ClerkProvider
        tokenCache={tokenCache}
        publishableKey={configuration.clerkPublishableKey}
      >
        <MobilePortfolioProvider convexUrl={configuration.convexUrl}>
          <Tabs
            screenOptions={{
              headerShown: false,
              sceneStyle: { backgroundColor: theme.background },
              tabBarActiveTintColor: theme.primary,
              tabBarInactiveTintColor: theme.mutedForeground,
              tabBarItemStyle: { minHeight: 44 },
              tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
              tabBarStyle: {
                backgroundColor: theme.surface,
                borderTopColor: theme.border,
              },
            }}
          >
            <Tabs.Screen
              name="index"
              options={{
                tabBarAccessibilityLabel: "Overview tab",
                tabBarIcon: ({ color, focused, size }) => (
                  <Ionicons
                    color={color}
                    name={focused ? "home" : "home-outline"}
                    size={size}
                  />
                ),
                title: "Overview",
              }}
            />
            <Tabs.Screen
              name="holdings"
              options={{
                tabBarAccessibilityLabel: "Holdings tab",
                tabBarIcon: ({ color, focused, size }) => (
                  <Ionicons
                    color={color}
                    name={focused ? "wallet" : "wallet-outline"}
                    size={size}
                  />
                ),
                title: "Holdings",
              }}
            />
          </Tabs>
        </MobilePortfolioProvider>
      </ClerkProvider>
    </SafeAreaProvider>
  );
}
