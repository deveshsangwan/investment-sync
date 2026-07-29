import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type Theme, useTheme } from "./theme";

export function BrandMark({ size = 40 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.brandMark,
        {
          backgroundColor: theme.primary,
          borderRadius: size * 0.25,
          height: size,
          width: size,
        },
      ]}
    >
      <Ionicons
        color={theme.primaryForeground}
        name="wallet-outline"
        size={size * 0.48}
      />
    </View>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      {eyebrow ? (
        <Text style={[styles.eyebrow, { color: theme.primary }]}>
          {eyebrow}
        </Text>
      ) : null}
      <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, { color: theme.mutedForeground }]}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

export function AppButton({
  children,
  disabled,
  label,
  onPress,
  variant = "primary",
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
}) {
  const theme = useTheme();
  const palette = buttonPalette(theme, variant, disabled);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.background, borderColor: palette.border },
        pressed && styles.pressed,
      ]}
    >
      {typeof children === "string" ? (
        <Text style={[styles.buttonText, { color: palette.foreground }]}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

export function StatePanel({
  action,
  description,
  title,
  tone = "neutral",
}: {
  action?: ReactNode;
  description: string;
  title: string;
  tone?: "neutral" | "error";
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={[
        styles.statePanel,
        {
          backgroundColor:
            tone === "error" ? theme.background : theme.accentSurface,
          borderColor: tone === "error" ? theme.negative : theme.border,
        },
      ]}
    >
      <Text style={[styles.stateTitle, { color: theme.foreground }]}>
        {title}
      </Text>
      <Text style={[styles.stateDescription, { color: theme.mutedForeground }]}>
        {description}
      </Text>
      {action ? <View style={styles.stateAction}>{action}</View> : null}
    </View>
  );
}

function buttonPalette(
  theme: Theme,
  variant: "primary" | "secondary",
  disabled?: boolean,
) {
  if (disabled) {
    return {
      background: theme.accentSurface,
      border: theme.border,
      foreground: theme.mutedForeground,
    };
  }

  return variant === "primary"
    ? {
        background: theme.primary,
        border: theme.primary,
        foreground: theme.primaryForeground,
      }
    : {
        background: theme.accentSurface,
        border: theme.border,
        foreground: theme.foreground,
      };
}

const styles = StyleSheet.create({
  brandMark: { alignItems: "center", justifyContent: "center" },
  header: { borderBottomWidth: 1, marginBottom: 20, paddingBottom: 18 },
  eyebrow: { fontSize: 12, fontWeight: "700", marginBottom: 5 },
  title: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1.2,
    lineHeight: 39,
  },
  description: { fontSize: 14, lineHeight: 21, marginTop: 7 },
  button: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  statePanel: { borderRadius: 12, borderWidth: 1, padding: 18 },
  stateTitle: { fontSize: 17, fontWeight: "700" },
  stateDescription: { fontSize: 14, lineHeight: 21, marginTop: 5 },
  stateAction: { alignSelf: "flex-start", marginTop: 15 },
});
