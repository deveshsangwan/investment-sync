import { ClerkProvider, SignedIn, SignedOut } from "@clerk/clerk-expo";
import { Stack } from "expo-router";
import { tokenCache } from "../src/auth-token-cache";
import { TRPCProvider } from "../src/trpc";
import { SignInScreen } from "../src/sign-in-screen";

export default function RootLayout() {
  return (
    <ClerkProvider
      tokenCache={tokenCache}
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ""}
    >
      <SignedIn>
        <TRPCProvider>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: "#ffffff" },
              headerTitleStyle: { fontWeight: "700" },
            }}
          />
        </TRPCProvider>
      </SignedIn>
      <SignedOut>
        <SignInScreen />
      </SignedOut>
    </ClerkProvider>
  );
}
