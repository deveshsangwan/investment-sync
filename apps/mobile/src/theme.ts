import { useColorScheme } from "react-native";

const lightTheme = {
  background: "#f7f7f9",
  surface: "#ffffff",
  card: "#ffffff",
  elevated: "#f0f0f4",
  foreground: "#18181b",
  mutedForeground: "#62626c",
  border: "#d9d9df",
  input: "#c5c5ce",
  primary: "#5345b0",
  primaryForeground: "#ffffff",
  accentSurface: "#ebe9f6",
  positive: "#267a53",
  negative: "#b83e42",
  warning: "#966019",
  skeleton: "#e8e8ed",
  isDark: false,
} as const;

const darkTheme: Theme = {
  background: "#0d0d0f",
  surface: "#151517",
  card: "#151517",
  elevated: "#202024",
  foreground: "#eeeeef",
  mutedForeground: "#a2a2ab",
  border: "#303034",
  input: "#414148",
  primary: "#aa9df2",
  primaryForeground: "#171329",
  accentSurface: "#28243a",
  positive: "#62c892",
  negative: "#ef7b7f",
  warning: "#d4a256",
  skeleton: "#25252a",
  isDark: true,
};

export type Theme = {
  [Key in keyof typeof lightTheme]: Key extends "isDark" ? boolean : string;
};

export const themes = { light: lightTheme, dark: darkTheme };

export function useTheme() {
  return useColorScheme() === "dark" ? themes.dark : themes.light;
}
