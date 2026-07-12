import {
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { trpc } from "../src/trpc";
import { colors } from "../src/theme";

const inrCurrency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const percentage = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

export default function HoldingsScreen() {
  const holdings = trpc.portfolio.holdings.useQuery();

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={holdings.data ?? []}
        keyExtractor={(item) => item.id}
        onRefresh={() => void holdings.refetch()}
        refreshing={holdings.isFetching && !holdings.isLoading}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Current positions</Text>
            <Text style={styles.title}>Holdings</Text>
            <Text style={styles.subtitle}>
              Latest committed position in each account.
            </Text>
          </View>
        }
        ListEmptyComponent={
          holdings.isLoading ? (
            <LoadingList />
          ) : holdings.isError ? (
            <StatusPanel onRetry={() => void holdings.refetch()} />
          ) : (
            <View style={styles.emptyPanel}>
              <Text style={styles.emptyTitle}>No committed holdings</Text>
              <Text style={styles.muted}>
                Import portfolio data from the web app first.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const pnl = item.pnlAmountInInr ?? 0;
          const tone = pnl >= 0 ? styles.positive : styles.negative;
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.nameBlock}>
                  <Text numberOfLines={1} style={styles.symbol}>
                    {item.symbol ?? item.instrumentName}
                  </Text>
                  <Text numberOfLines={1} style={styles.muted}>
                    {item.accountName} · {labelize(item.assetClass)}
                  </Text>
                </View>
                <Text style={styles.value}>
                  {inrCurrency.format(item.currentValueInInr)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.date}>
                  As of {formatDate(item.snapshotDate)}
                </Text>
                <Text style={[styles.returnValue, tone]}>
                  {pnl >= 0 ? "↑" : "↓"}{" "}
                  {percentage.format(Number(item.pnlPercent ?? 0))}%
                </Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function LoadingList() {
  return (
    <View accessibilityLabel="Loading holdings" style={styles.loadingList}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.loadingCard} />
      ))}
    </View>
  );
}

function StatusPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.emptyPanel}>
      <Text style={styles.emptyTitle}>Holdings unavailable</Text>
      <Text style={styles.muted}>Your saved portfolio has not changed.</Text>
      <Pressable onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>Try again</Text>
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
  header: { marginBottom: 18, marginTop: 4 },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: {
    color: colors.foreground,
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1.2,
    marginTop: 5,
  },
  subtitle: { color: colors.muted, marginTop: 7 },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 10,
    padding: 16,
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  nameBlock: { flex: 1, marginRight: 14 },
  symbol: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 3 },
  value: {
    color: colors.foreground,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  row: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 11,
  },
  date: { color: colors.muted, fontSize: 12 },
  returnValue: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  emptyPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  emptyTitle: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
  retryButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryText: { color: colors.foreground, fontWeight: "700" },
  loadingList: { gap: 10 },
  loadingCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: 18,
    height: 108,
  },
});
