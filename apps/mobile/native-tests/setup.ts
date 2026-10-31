/// <reference types="jest" />
import { configure } from "@testing-library/react-native";
import { testTransport } from "./transport";

configure({ asyncUtilTimeout: 10000 });
beforeEach(() => testTransport.reset());

jest.mock(
  "react-native-safe-area-context",
  () =>
    jest.requireActual<{ default: unknown }>(
      "react-native-safe-area-context/jest/mock",
    ).default,
);
jest.mock("@expo/vector-icons/Ionicons", () => "Ionicons");
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("../src/sign-in-screen", () => ({ SignInScreen: () => null }));
jest.mock("convex/react", () => ({
  ...jest.requireActual<typeof import("convex/react")>("convex/react"),
  ConvexReactClient:
    jest.requireActual<typeof import("./transport")>("./transport")
      .TestConvexClient,
}));
jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: "fake-native-user",
    sessionId: "fake-native-session",
    orgId: null,
    orgRole: null,
    getToken: () => Promise.resolve("fake-native-token"),
    signOut: () => Promise.resolve(),
  }),
}));

export const mockPush = jest.fn();
