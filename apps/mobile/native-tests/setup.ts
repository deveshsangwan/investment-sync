/// <reference types="jest" />
import { configure } from "@testing-library/react-native";

configure({ asyncUtilTimeout: 10000 });

jest.mock(
  "react-native-safe-area-context",
  () =>
    jest.requireActual<{ default: unknown }>(
      "react-native-safe-area-context/jest/mock",
    ).default,
);

jest.mock("@expo/vector-icons/Ionicons", () => "Ionicons");
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@clerk/clerk-expo", () => ({ useAuth: jest.fn() }));

export const mockPush = jest.fn();
