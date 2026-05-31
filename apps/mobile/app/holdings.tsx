import { FlatList, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { trpc } from "../src/trpc";
import { colors } from "../src/theme";

const inrCurrency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const usdCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default function HoldingsScreen() {
  const holdings = trpc.portfolio.holdings.useQuery();

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Holdings</Text>
      <FlatList
        data={holdings.data ?? []}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <Text style={styles.muted}>No committed holdings yet.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.symbol}>
              {item.symbol ?? item.instrumentName}
            </Text>
            <Text style={styles.muted}>{item.accountName}</Text>
            <View style={styles.row}>
              <Text>
                {formatCurrency(Number(item.currentValue), item.currency)}
              </Text>
              <Text
                style={
                  Number(item.pnlAmount ?? 0) >= 0
                    ? styles.positive
                    : styles.negative
                }
              >
                {formatCurrency(Number(item.pnlAmount ?? 0), item.currency)}
              </Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function formatCurrency(value: number, currency: string) {
  if (currency === "USD") return usdCurrency.format(value);
  return inrCurrency.format(value);
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
    padding: 18,
  },
  title: {
    color: colors.foreground,
    fontSize: 30,
    fontWeight: "800",
    marginBottom: 16,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
  },
  symbol: {
    color: colors.foreground,
    fontSize: 17,
    fontWeight: "800",
  },
  muted: {
    color: colors.muted,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  positive: {
    color: colors.positive,
    fontWeight: "800",
  },
  negative: {
    color: colors.negative,
    fontWeight: "800",
  },
});
