import { useFonts } from "expo-font";
import { PublicSans_400Regular } from "@expo-google-fonts/public-sans/400Regular";
import { PublicSans_500Medium } from "@expo-google-fonts/public-sans/500Medium";
import { PublicSans_600SemiBold } from "@expo-google-fonts/public-sans/600SemiBold";
import { PublicSans_700Bold } from "@expo-google-fonts/public-sans/700Bold";
import { AmountsProvider } from "../src/amounts";
import { StatePanel } from "../src/mobile-ui";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  ClerkProvider,
  ClerkLoaded,
  ClerkLoading,
  SignedIn,
  SignedOut,
} from "@clerk/clerk-expo";
import { Tabs } from "expo-router";
import { ActivityIndicator, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { tokenCache } from "../src/auth-token-cache";
import { SignInScreen } from "../src/sign-in-screen";
import { useTheme } from "../src/theme";
import { TRPCProvider } from "../src/trpc";

export default function RootLayout() {
  const theme = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    PublicSans_400Regular,
    PublicSans_500Medium,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
  });
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!fontsLoaded && !fontError) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator
          accessibilityLabel="Loading app"
          color={theme.foreground}
        />
      </View>
    );
  }

  if (!publishableKey) {
    return (
      <SafeAreaProvider>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 24,
            backgroundColor: theme.background,
          }}
        >
          <StatePanel
            title="Sign-in is not configured"
            description="Add the Clerk publishable key to the mobile environment and restart Expo."
          />
        </View>
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
        publishableKey={publishableKey}
        experimental={{ rethrowOfflineNetworkErrors: true }}
      >
        <ClerkLoading>
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              backgroundColor: theme.background,
            }}
          >
            <ActivityIndicator
              accessibilityLabel="Loading sign-in"
              color={theme.foreground}
            />
          </View>
        </ClerkLoading>
        <ClerkLoaded>
          <AmountsProvider>
            <SignedIn>
              <TRPCProvider>
                <Tabs
                  screenOptions={{
                    headerShown: false,
                    sceneStyle: { backgroundColor: theme.background },
                    tabBarActiveTintColor: theme.primary,
                    tabBarInactiveTintColor: theme.mutedForeground,
                    tabBarItemStyle: { minHeight: 44 },
                    tabBarLabelStyle: {
                      fontSize: 12,
                      fontFamily: "PublicSans_600SemiBold",
                    },
                    tabBarStyle: {
                      backgroundColor: theme.surface,
                      borderTopColor: theme.border,
                    },
                  }}
                >
                  <Tabs.Screen
                    name="index"
                    options={{
                      tabBarAccessibilityLabel: "Portfolio tab",
                      tabBarIcon: ({ color, focused, size }) => (
                        <Ionicons
                          color={color}
                          name={focused ? "home" : "home-outline"}
                          size={size}
                        />
                      ),
                      title: "Portfolio",
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
          </AmountsProvider>
        </ClerkLoaded>
      </ClerkProvider>
    </SafeAreaProvider>
  );
}
