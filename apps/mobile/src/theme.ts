import { useColorScheme } from "react-native";

const lightTheme = {
  background: "#fcfcfc",
  surface: "#ffffff",
  card: "#f7f7f7",
  elevated: "#f0f0f0",
  foreground: "#171717",
  mutedForeground: "#6b6b6b",
  border: "#dedede",
  input: "#c2c2c2",
  primary: "#1f1f1f",
  primaryForeground: "#ffffff",
  accentSurface: "#e8e8e8",
  positive: "#17724f",
  negative: "#aa3128",
  warning: "#6b6b6b",
  skeleton: "#e8e8e8",
  isDark: false,
} as const;

const darkTheme: Theme = {
  background: "#000000",
  surface: "#141414",
  card: "#141414",
  elevated: "#1c1c1c",
  foreground: "#f5f5f5",
  mutedForeground: "#a3a3a3",
  border: "#303030",
  input: "#454545",
  primary: "#f5f5f5",
  primaryForeground: "#141414",
  accentSurface: "#212121",
  positive: "#60be7f",
  negative: "#e16a60",
  warning: "#a3a3a3",
  skeleton: "#242424",
  isDark: true,
};

export type Theme = {
  [Key in keyof typeof lightTheme]: Key extends "isDark" ? boolean : string;
};

export const themes = { light: lightTheme, dark: darkTheme };

export function useTheme() {
  return useColorScheme() === "dark" ? themes.dark : themes.light;
}
