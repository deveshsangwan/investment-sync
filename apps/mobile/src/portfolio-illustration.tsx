import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { AppText as Text } from "./app-text";
import { useTheme } from "./theme";

export function PortfolioIllustration() {
  const theme = useTheme();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.art}
    >
      <View style={styles.sources}>
        {["Stocks", "Funds"].map((label) => (
          <View
            key={label}
            style={[
              styles.source,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
          >
            <Ionicons
              name={
                label === "Stocks" ? "document-text-outline" : "layers-outline"
              }
              size={16}
              color={theme.mutedForeground}
            />
            <Text style={{ color: theme.foreground, fontSize: 12 }}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <View
        style={[
          styles.result,
          { backgroundColor: theme.background, borderColor: theme.border },
        ]}
      >
        <Text style={{ color: theme.mutedForeground, fontSize: 12 }}>
          One portfolio
        </Text>
        <Text
          style={{
            color: theme.foreground,
            fontSize: 24,
            fontWeight: "600",
            marginTop: 12,
          }}
        >
          ₹19,39,000
          <Text style={{ color: theme.mutedForeground, fontSize: 14 }}>
            .00
          </Text>
        </Text>
        <Svg
          width="100%"
          height={64}
          viewBox="0 0 200 64"
          style={{ marginVertical: 12 }}
        >
          <Path d="M0 56H200M0 28H200" stroke={theme.border} />
          <Path
            d="M0 55L23 47L44 49L67 34L89 38L112 25L135 30L157 15L178 19L200 5"
            stroke={theme.positive}
            strokeWidth={2}
            fill="none"
          />
        </Svg>
        <Text
          style={{
            color: theme.mutedForeground,
            fontSize: 10,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            paddingTop: 10,
          }}
        >
          All your statements. One clear view.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { gap: 10, marginVertical: 4 },
  sources: { flexDirection: "row", gap: 10 },
  source: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    flex: 1,
  },
  result: { padding: 18, borderRadius: 12, borderWidth: 1 },
});
