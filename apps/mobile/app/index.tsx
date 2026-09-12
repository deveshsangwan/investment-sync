import { InstrumentMark, LogoAttribution } from "../src/instrument-mark";
import { assetClassLabel, formatDate } from "../src/format";
import { useAmounts } from "../src/amounts";
import { ValueHistory } from "../src/value-history";
import { AppText as Text } from "../src/app-text";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AppButton,
  PageHeader,
  PortfolioToolbar,
  StatePanel,
} from "../src/mobile-ui";
import { type Theme, useTheme } from "../src/theme";
import { trpc } from "../src/trpc";

const percentage = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

export default function DashboardScreen() {
  const router = useRouter();
  const overview = trpc.portfolio.overview.useQuery();
  const summary = overview.data?.summary;
  const largestHoldings = [...(overview.data?.holdings ?? [])]
    .sort((left, right) => right.currentValueInInr - left.currentValueInInr)
    .slice(0, 5);
  const { formatAmount } = useAmounts();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={overview.isFetching && !overview.isLoading}
            onRefresh={() => void overview.refetch()}
            tintColor={theme.foreground}
          />
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <PortfolioToolbar />
        <PageHeader
          description={
            summary?.asOfDate
              ? `As of ${formatDate(summary.asOfDate)}`
              : "Latest committed positions"
          }
          title="Portfolio"
        />

        {overview.isLoading ? (
          <View style={styles.sections}>
            <LoadingPanel styles={styles} />
            {["Value history", "Asset allocation", "Largest holdings"].map(
              (title) => (
                <View
                  key={title}
                  style={[styles.section, { paddingBottom: 20 }]}
                  accessibilityLabel={`Loading ${title.toLowerCase()}`}
                  accessibilityRole="progressbar"
                >
                  <Text style={styles.sectionTitle}>{title}</Text>
                  <View
                    style={[styles.loadingBar, { height: 120, marginTop: 20 }]}
                  />
                </View>
              ),
            )}
          </View>
        ) : null}

        {overview.isError ? (
          <StatePanel
            action={
              <AppButton
                label="Try loading the portfolio again"
                onPress={() => void overview.refetch()}
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

        {summary && overview.data?.holdings.length === 0 ? (
          <StatePanel
            title="Your portfolio starts here"
            description="Import a statement on the web to see your investments, allocation, and returns here."
          />
        ) : null}

        {summary && overview.data?.holdings.length ? (
          <View style={styles.sections}>
            <View style={styles.hero}>
              <Text style={styles.metricLabel}>Total value</Text>
              <Text
                adjustsFontSizeToFit
                numberOfLines={1}
                style={styles.heroValue}
              >
                {formatAmount(summary.currentValue)}
              </Text>
              <View style={styles.heroStats}>
                <Metric
                  label="Invested"
                  styles={styles}
                  value={formatAmount(summary.investedAmount)}
                />
                <Metric
                  label="Gain or loss"
                  styles={styles}
                  tone={summary.pnlAmount >= 0 ? "positive" : "negative"}
                  value={formatAmount(summary.pnlAmount)}
                />
                <Metric
                  label="Return"
                  styles={styles}
                  tone={
                    (overview.data?.performance.absoluteReturnPercent ??
                      summary.pnlPercent) >= 0
                      ? "positive"
                      : "negative"
                  }
                  value={`${percentage.format(overview.data?.performance.absoluteReturnPercent ?? summary.pnlPercent)}%`}
                />
                <Metric
                  label="XIRR"
                  styles={styles}
                  value={
                    overview.data?.performance.xirr == null
                      ? "N/A"
                      : `${percentage.format(overview.data.performance.xirr)}%`
                  }
                />
              </View>
            </View>

            <ValueHistory data={overview.data?.timeline ?? []} />
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Asset allocation</Text>
              <Text style={styles.sectionDescription}>
                Share of current household value.
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  height: 8,
                  borderRadius: 4,
                  overflow: "hidden",
                  marginTop: 20,
                }}
              >
                {summary.allocationByAssetClass.map((item, index) => (
                  <View
                    key={item.assetClass}
                    style={{
                      flex: Math.max(0, item.weight),
                      backgroundColor: theme.foreground,
                      opacity: Math.max(0.25, 1 - index * 0.15),
                    }}
                  />
                ))}
              </View>
              {summary.allocationByAssetClass.length === 0 ? (
                <Text style={styles.emptyText}>
                  Import data on the web app to build your allocation.
                </Text>
              ) : (
                <View style={styles.allocationList}>
                  {summary.allocationByAssetClass.map((item, index) => (
                    <View
                      key={item.assetClass}
                      style={[
                        styles.allocationRow,
                        index === 0 && styles.firstAllocationRow,
                      ]}
                    >
                      <View style={styles.allocationLabel}>
                        <Text numberOfLines={1} style={styles.rowLabel}>
                          {assetClassLabel(item.assetClass)}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {formatAmount(item.currentValue)}
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

            {largestHoldings.length ? (
              <View>
                <Text style={styles.sectionTitle}>Largest holdings</Text>
                <View
                  style={{
                    marginTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: theme.border,
                  }}
                >
                  {largestHoldings.map((holding) => (
                    <View
                      key={holding.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: 16,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.border,
                      }}
                    >
                      <InstrumentMark
                        name={holding.instrumentName}
                        symbol={holding.symbol}
                        isin={holding.isin}
                        exchange={holding.exchange}
                        assetClass={holding.assetClass}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowLabel} numberOfLines={1}>
                          {holding.symbol ?? holding.instrumentName}
                        </Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {holding.instrumentName}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.rowValue,
                          { flexShrink: 1, textAlign: "right" },
                        ]}
                      >
                        {formatAmount(holding.currentValueInInr)}
                      </Text>
                    </View>
                  ))}
                </View>
                <LogoAttribution />
              </View>
            ) : null}

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
      <Text style={styles.metricLabel}>Total value</Text>
      <View style={[styles.loadingBar, styles.loadingValue]} />
      <View style={styles.loadingGrid}>
        {["Invested", "Gain or loss", "Return", "XIRR"].map((label) => (
          <View key={label} style={styles.metric}>
            <Text style={styles.metricLabel}>{label}</Text>
            <View style={[styles.loadingBar, { height: 18, width: 100 }]} />
          </View>
        ))}
      </View>
    </View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.background, flex: 1 },
    content: {
      padding: 20,
      paddingBottom: 32,
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
    },
    sections: { gap: 24 },
    hero: {
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      paddingBottom: 24,
    },
    heroValue: {
      color: theme.foreground,
      fontSize: 42,
      fontVariant: ["tabular-nums"],
      fontWeight: "600",
      letterSpacing: -1.4,
      lineHeight: 52,
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
      fontWeight: "600",
      textAlign: "right",
    },
    positive: { color: theme.positive },
    negative: { color: theme.negative },
    section: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 16,
      borderWidth: 1,
      paddingHorizontal: 18,
      paddingTop: 18,
    },
    sectionTitle: {
      color: theme.foreground,
      fontSize: 18,
      fontWeight: "600",
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
      fontWeight: "600",
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
      fontWeight: "600",
    },
    loadingPanel: {
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      paddingBottom: 24,
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
