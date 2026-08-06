import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton, PageHeader, StatePanel } from "../src/mobile-ui";
import { type Theme, useTheme } from "../src/theme";
import { trpc } from "../src/trpc";

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const percentage = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

export default function DashboardScreen() {
  const router = useRouter();
  const summary = trpc.portfolio.summary.useQuery();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          description={
            summary.data?.asOfDate
              ? `As of ${formatDate(summary.data.asOfDate)}`
              : "Latest committed positions"
          }
          eyebrow="Household portfolio"
          title="Overview"
        />

        {summary.isLoading ? <LoadingPanel styles={styles} /> : null}

        {summary.isError ? (
          <StatePanel
            action={
              <AppButton
                label="Try loading the portfolio again"
                onPress={() => void summary.refetch()}
                variant="secondary"
              >
                Try again
              </AppButton>
            }
            description="Your saved data has not changed."
            title="Portfolio unavailable"
            tone="error"
          />
        ) : null}

        {summary.isSuccess && summary.data ? (
          <View style={styles.sections}>
            <View style={styles.hero}>
              <Text style={styles.metricLabel}>Current value</Text>
              <Text
                adjustsFontSizeToFit
                numberOfLines={1}
                style={styles.heroValue}
              >
                {currency.format(summary.data.currentValue)}
              </Text>
              <View style={styles.heroStats}>
                <Metric
                  label="Invested"
                  styles={styles}
                  value={currency.format(summary.data.investedAmount)}
                />
                <Metric
                  label="Gain / loss"
                  styles={styles}
                  tone={summary.data.pnlAmount >= 0 ? "positive" : "negative"}
                  value={currency.format(summary.data.pnlAmount)}
                />
                <Metric
                  label="Return"
                  styles={styles}
                  tone={summary.data.pnlPercent >= 0 ? "positive" : "negative"}
                  value={`${percentage.format(summary.data.pnlPercent)}%`}
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Allocation</Text>
              <Text style={styles.sectionDescription}>
                Share of current household value.
              </Text>
              {summary.data.allocationByAssetClass.length === 0 ? (
                <Text style={styles.emptyText}>
                  Import data on the web app to build your allocation.
                </Text>
              ) : (
                <View style={styles.allocationList}>
                  {summary.data.allocationByAssetClass.map((item, index) => (
                    <View
                      key={item.assetClass}
                      style={[
                        styles.allocationRow,
                        index === 0 && styles.firstAllocationRow,
                      ]}
                    >
                      <View style={styles.allocationLabel}>
                        <Text numberOfLines={1} style={styles.rowLabel}>
                          {labelize(item.assetClass)}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {currency.format(item.currentValue)}
                        </Text>
                      </View>
                      <Text style={styles.rowValue}>
                        {percentage.format(item.weight)}%
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <AppButton
              label="Browse holdings"
              onPress={() => router.push("/holdings")}
            >
              <View style={styles.actionContent}>
                <Text style={styles.actionText}>Browse holdings</Text>
                <Ionicons
                  color={theme.primaryForeground}
                  name="arrow-forward"
                  size={18}
                />
              </View>
            </AppButton>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({
  label,
  styles,
  tone,
  value,
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  tone?: "positive" | "negative";
  value: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[
          styles.metricValue,
          tone === "positive" && styles.positive,
          tone === "negative" && styles.negative,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function LoadingPanel({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View
      accessibilityLabel="Loading portfolio"
      accessibilityRole="progressbar"
      style={styles.loadingPanel}
    >
      <View style={[styles.loadingBar, styles.loadingLabel]} />
      <View style={[styles.loadingBar, styles.loadingValue]} />
      <View style={styles.loadingGrid}>
        <View style={styles.loadingMetric} />
        <View style={styles.loadingMetric} />
        <View style={styles.loadingMetric} />
      </View>
    </View>
  );
}

function labelize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.background, flex: 1 },
    content: { padding: 18, paddingBottom: 28 },
    sections: { gap: 14 },
    hero: {
      backgroundColor: theme.card,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      padding: 20,
    },
    heroValue: {
      color: theme.foreground,
      fontSize: 35,
      fontVariant: ["tabular-nums"],
      fontWeight: "700",
      letterSpacing: -1.4,
      lineHeight: 43,
      marginTop: 6,
    },
    heroStats: { marginTop: 18 },
    metric: {
      alignItems: "center",
      borderTopColor: theme.border,
      borderTopWidth: 1,
      flexDirection: "row",
      gap: 16,
      justifyContent: "space-between",
      minHeight: 44,
    },
    metricLabel: {
      color: theme.mutedForeground,
      fontSize: 12,
      fontWeight: "600",
    },
    metricValue: {
      color: theme.foreground,
      flexShrink: 1,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      fontWeight: "700",
      textAlign: "right",
    },
    positive: { color: theme.positive },
    negative: { color: theme.negative },
    section: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 18,
      paddingTop: 18,
    },
    sectionTitle: {
      color: theme.foreground,
      fontSize: 18,
      fontWeight: "700",
      letterSpacing: -0.3,
    },
    sectionDescription: {
      color: theme.mutedForeground,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 4,
    },
    emptyText: {
      color: theme.mutedForeground,
      lineHeight: 21,
      paddingBottom: 18,
      paddingTop: 18,
    },
    allocationList: { marginTop: 12 },
    allocationRow: {
      alignItems: "center",
      borderTopColor: theme.border,
      borderTopWidth: 1,
      flexDirection: "row",
      gap: 14,
      justifyContent: "space-between",
      minHeight: 62,
    },
    firstAllocationRow: { borderTopWidth: 0 },
    allocationLabel: { flex: 1, minWidth: 0 },
    rowLabel: { color: theme.foreground, fontSize: 14, fontWeight: "600" },
    rowMeta: {
      color: theme.mutedForeground,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
      marginTop: 3,
    },
    rowValue: {
      color: theme.foreground,
      fontSize: 14,
      fontVariant: ["tabular-nums"],
      fontWeight: "700",
    },
    actionContent: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
    },
    actionText: {
      color: theme.primaryForeground,
      fontSize: 15,
      fontWeight: "700",
    },
    loadingPanel: {
      backgroundColor: theme.card,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      padding: 20,
    },
    loadingBar: { backgroundColor: theme.skeleton, borderRadius: 6 },
    loadingLabel: { height: 12, width: "28%" },
    loadingValue: { height: 38, marginTop: 14, width: "72%" },
    loadingGrid: { gap: 1, marginTop: 20 },
    loadingMetric: {
      backgroundColor: theme.skeleton,
      borderRadius: 6,
      height: 44,
    },
  });
}
