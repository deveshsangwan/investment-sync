import { Link } from "expo-router";
import { FlatList, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { trpc } from "../src/trpc";
import { colors } from "../src/theme";

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function DashboardScreen() {
  const summary = trpc.portfolio.summary.useQuery();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Dashboard</Text>
        <Text style={styles.title}>Portfolio overview</Text>
      </View>

      <View style={styles.grid}>
        <Metric
          label="Current value"
          value={currency.format(summary.data?.currentValue ?? 0)}
        />
        <Metric
          label="Invested"
          value={currency.format(summary.data?.investedAmount ?? 0)}
        />
        <Metric
          label="Gain/Loss"
          value={currency.format(summary.data?.pnlAmount ?? 0)}
        />
        <Metric label="Return" value={`${summary.data?.pnlPercent ?? 0}%`} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Allocation</Text>
        <FlatList
          data={summary.data?.allocationByAssetClass ?? []}
          keyExtractor={(item) => item.assetClass}
          ListEmptyComponent={
            <Text style={styles.muted}>
              Upload data from the web app to see allocation.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                {item.assetClass.replaceAll("_", " ")}
              </Text>
              <Text style={styles.rowValue}>{item.weight}%</Text>
            </View>
          )}
        />
      </View>

      <Link href="/holdings" style={styles.link}>
        View holdings
      </Link>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
    padding: 18,
  },
  header: {
    marginBottom: 16,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: {
    color: colors.foreground,
    fontSize: 30,
    fontWeight: "800",
  },
  grid: {
    gap: 12,
  },
  metric: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  metricValue: {
    color: colors.foreground,
    fontSize: 24,
    fontWeight: "800",
    marginTop: 8,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  muted: {
    color: colors.muted,
  },
  row: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  rowLabel: {
    color: colors.foreground,
    textTransform: "capitalize",
  },
  rowValue: {
    color: colors.foreground,
    fontWeight: "700",
  },
  link: {
    color: colors.accent,
    fontWeight: "800",
    marginTop: 18,
  },
});
