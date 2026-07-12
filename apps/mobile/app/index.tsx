import { Link } from "expo-router";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { trpc } from "../src/trpc";
import { colors } from "../src/theme";

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const percentage = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

export default function DashboardScreen() {
  const summary = trpc.portfolio.summary.useQuery();

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Household portfolio</Text>
          <Text style={styles.title}>Overview</Text>
          <Text style={styles.subtitle}>
            {summary.data?.asOfDate
              ? `As of ${formatDate(summary.data.asOfDate)}`
              : "Latest committed positions"}
          </Text>
        </View>

        {summary.isLoading ? <LoadingPanel /> : null}

        {summary.isError ? (
          <StatusPanel
            title="Portfolio unavailable"
            description="Your saved data has not changed."
            actionLabel="Try again"
            onPress={() => void summary.refetch()}
          />
        ) : null}

        {summary.isSuccess && summary.data ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.metricLabel}>Current value</Text>
              <Text style={styles.heroValue}>
                {currency.format(summary.data.currentValue)}
              </Text>
              <View style={styles.heroStats}>
                <Metric
                  label="Invested"
                  value={currency.format(summary.data.investedAmount)}
                />
                <Metric
                  label="Gain / loss"
                  value={currency.format(summary.data.pnlAmount)}
                  tone={summary.data.pnlAmount >= 0 ? "positive" : "negative"}
                />
                <Metric
                  label="Return"
                  value={`${percentage.format(summary.data.pnlPercent)}%`}
                  tone={summary.data.pnlPercent >= 0 ? "positive" : "negative"}
                />
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Allocation</Text>
              <Text style={styles.sectionDescription}>
                Share of current household value.
              </Text>
              {summary.data.allocationByAssetClass.length === 0 ? (
                <Text style={styles.emptyText}>
                  Import data on the web app to build your allocation.
                </Text>
              ) : (
                summary.data.allocationByAssetClass.map((item) => (
                  <View key={item.assetClass} style={styles.allocationRow}>
                    <View style={styles.allocationLabel}>
                      <View style={styles.dot} />
                      <View>
                        <Text style={styles.rowLabel}>
                          {labelize(item.assetClass)}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {currency.format(item.currentValue)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.rowValue}>
                      {percentage.format(item.weight)}%
                    </Text>
                  </View>
                ))
              )}
            </View>

            <Link href="/holdings" asChild>
              <Pressable style={styles.primaryAction}>
                <Text style={styles.primaryActionText}>Browse holdings</Text>
                <Text style={styles.primaryActionArrow}>→</Text>
              </Pressable>
            </Link>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
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

function LoadingPanel() {
  return (
    <View accessibilityLabel="Loading portfolio" style={styles.loadingPanel}>
      <View style={[styles.loadingBar, { width: "28%" }]} />
      <View style={[styles.loadingBar, styles.loadingValue]} />
      <View style={styles.loadingGrid}>
        <View style={styles.loadingMetric} />
        <View style={styles.loadingMetric} />
        <View style={styles.loadingMetric} />
      </View>
    </View>
  );
}

function StatusPanel({
  title,
  description,
  actionLabel,
  onPress,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.statusPanel}>
      <Text style={styles.statusTitle}>{title}</Text>
      <Text style={styles.statusDescription}>{description}</Text>
      <Pressable onPress={onPress} style={styles.secondaryAction}>
        <Text style={styles.secondaryActionText}>{actionLabel}</Text>
      </Pressable>
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

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { padding: 18, paddingBottom: 36 },
  header: { marginBottom: 22, marginTop: 8 },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.3,
  },
  title: {
    color: colors.foreground,
    fontSize: 38,
    fontWeight: "700",
    letterSpacing: -1.5,
    lineHeight: 42,
    marginTop: 6,
  },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 8 },
  hero: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
  },
  heroValue: {
    color: colors.foreground,
    fontSize: 34,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    letterSpacing: -1.4,
    marginTop: 8,
  },
  heroStats: { gap: 10, marginTop: 22 },
  metric: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 11,
  },
  metricLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  metricValue: {
    color: colors.foreground,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  sectionDescription: { color: colors.muted, fontSize: 13, marginTop: 5 },
  emptyText: { color: colors.muted, lineHeight: 21, marginTop: 18 },
  allocationRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 13,
    paddingTop: 13,
  },
  allocationLabel: { alignItems: "center", flexDirection: "row", gap: 10 },
  dot: {
    backgroundColor: colors.accent,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  rowLabel: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  rowMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  rowValue: {
    color: colors.foreground,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 18,
  },
  primaryActionText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  primaryActionArrow: { color: "#ffffff", fontSize: 20 },
  loadingPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
  },
  loadingBar: {
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    height: 12,
  },
  loadingValue: { height: 34, marginTop: 14, width: "68%" },
  loadingGrid: { gap: 10, marginTop: 22 },
  loadingMetric: {
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    height: 38,
  },
  statusPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
  },
  statusTitle: { color: colors.foreground, fontSize: 17, fontWeight: "700" },
  statusDescription: { color: colors.muted, lineHeight: 20, marginTop: 5 },
  secondaryAction: {
    alignSelf: "flex-start",
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryActionText: { color: colors.foreground, fontWeight: "700" },
});
