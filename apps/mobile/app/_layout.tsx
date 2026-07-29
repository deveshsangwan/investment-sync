import Ionicons from "@expo/vector-icons/Ionicons";
import { ClerkProvider, SignedIn, SignedOut } from "@clerk/clerk-expo";
import { Tabs } from "expo-router";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { tokenCache } from "../src/auth-token-cache";
import { SignInScreen } from "../src/sign-in-screen";
import { useTheme } from "../src/theme";
import { TRPCProvider } from "../src/trpc";

export default function RootLayout() {
  const theme = useTheme();

  return (
    <SafeAreaProvider>
      <StatusBar
        backgroundColor={theme.background}
        barStyle={theme.isDark ? "light-content" : "dark-content"}
      />
      <ClerkProvider
        tokenCache={tokenCache}
        publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ""}
      >
        <SignedIn>
          <TRPCProvider>
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
          </TRPCProvider>
        </SignedIn>
        <SignedOut>
          <SignInScreen />
        </SignedOut>
      </ClerkProvider>
    </SafeAreaProvider>
  );
}
