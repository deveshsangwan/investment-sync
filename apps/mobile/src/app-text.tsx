import { StyleSheet, Text, type TextProps } from "react-native";

export function AppText({ style, ...props }: TextProps) {
  const weight = StyleSheet.flatten(style)?.fontWeight;
  const fontFamily =
    weight === "700" || weight === "bold"
      ? "PublicSans_700Bold"
      : weight === "600"
        ? "PublicSans_600SemiBold"
        : weight === "500"
          ? "PublicSans_500Medium"
          : "PublicSans_400Regular";

  return (
    <Text {...props} style={[style, { fontFamily, fontWeight: "normal" }]} />
  );
}
