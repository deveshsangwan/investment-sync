import Svg, { Defs, Image, Mask, Rect } from "react-native-svg";
import quietMark from "../assets/quiet.png";
import { useAmounts } from "./amounts";
import { AppText as Text } from "./app-text";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useId, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { type Theme, useTheme } from "./theme";

export function BrandMark({ size = 40 }: { size?: number }) {
  const theme = useTheme();
  const maskId = useId();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 1280 1280">
        <Defs>
          <Mask
            id={maskId}
            x="0"
            y="0"
            width="1280"
            height="1280"
            maskUnits="userSpaceOnUse"
            maskType="luminance"
          >
            <Image href={quietMark} width="1280" height="1280" />
          </Mask>
        </Defs>
        <Rect
          width="1280"
          height="1280"
          fill={theme.foreground}
          mask={`url(#${maskId})`}
        />
      </Svg>
    </View>
  );
}

export function PortfolioToolbar() {
  const theme = useTheme();
  const { isHidden, isReady, toggle } = useAmounts();

  return (
    <View style={styles.toolbar}>
      <View style={styles.brand}>
        <BrandMark size={32} />
        <Text
          style={{ color: theme.foreground, fontSize: 15, fontWeight: "600" }}
        >
          Investment Sync
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isHidden ? "Show amounts" : "Hide amounts"}
        accessibilityState={{ disabled: !isReady, selected: isHidden }}
        disabled={!isReady}
        onPress={toggle}
        style={({ pressed }) => [
          styles.iconButton,
          { borderColor: theme.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={isHidden ? "eye-off-outline" : "eye-outline"}
          size={20}
          color={theme.foreground}
        />
      </Pressable>
    </View>
  );
}

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
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
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 28,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: { marginBottom: 24 },
  eyebrow: { fontSize: 12, fontWeight: "600", marginBottom: 5 },
  title: {
    fontSize: 30,
    fontWeight: "600",
    letterSpacing: -1.2,
    lineHeight: 39,
  },
  description: { fontSize: 14, lineHeight: 21, marginTop: 7 },
  button: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  statePanel: { borderRadius: 16, borderWidth: 1, padding: 18 },
  stateTitle: { fontSize: 17, fontWeight: "600" },
  stateDescription: { fontSize: 14, lineHeight: 21, marginTop: 5 },
  stateAction: { alignSelf: "flex-start", marginTop: 15 },
});
