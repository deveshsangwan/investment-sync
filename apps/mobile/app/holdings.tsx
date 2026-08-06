import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton, PageHeader, StatePanel } from "../src/mobile-ui";
import { type Theme, useTheme } from "../src/theme";
import { trpc } from "../src/trpc";

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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const data = holdings.data ?? [];

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={data}
        keyExtractor={(item) => item.id}
        onRefresh={() => void holdings.refetch()}
        refreshing={holdings.isFetching && !holdings.isLoading}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <PageHeader
            description="Latest committed position in each account."
            eyebrow="Current positions"
            title="Holdings"
          />
        }
        ListEmptyComponent={
          holdings.isLoading ? (
            <LoadingList styles={styles} />
          ) : holdings.isError ? (
            <StatePanel
              action={
                <AppButton
                  label="Try loading holdings again"
                  onPress={() => void holdings.refetch()}
                  variant="secondary"
                >
                  Try again
                </AppButton>
              }
              description="Your saved portfolio has not changed."
              title="Holdings unavailable"
              tone="error"
            />
          ) : (
            <StatePanel
              description="Import portfolio data from the web app first."
              title="No committed holdings"
            />
          )
        }
        renderItem={({ index, item }) => {
          const pnl = item.pnlAmountInInr ?? 0;
          const returnTone =
            pnl > 0
              ? styles.positive
              : pnl < 0
                ? styles.negative
                : styles.mutedReturn;
          const returnColor =
            pnl > 0
              ? theme.positive
              : pnl < 0
                ? theme.negative
                : theme.mutedForeground;
          const name = item.symbol ?? item.instrumentName;
          const formattedReturn = `${percentage.format(
            Number(item.pnlPercent ?? 0),
          )}%`;

          return (
            <View
              accessible
              accessibilityLabel={`${name}, ${inrCurrency.format(
                item.currentValueInInr,
              )}, return ${formattedReturn}`}
              style={[
                styles.holdingRow,
                index === 0 && styles.firstHoldingRow,
                index === data.length - 1 && styles.lastHoldingRow,
              ]}
            >
              <View style={styles.holdingHeader}>
                <Text numberOfLines={1} style={styles.symbol}>
                  {name}
                </Text>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={styles.value}
                >
                  {inrCurrency.format(item.currentValueInInr)}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.meta}>
                {item.accountName} · {labelize(item.assetClass)}
              </Text>
              <View style={styles.holdingFooter}>
                <Text style={styles.date}>
                  As of {formatDate(item.snapshotDate)}
                </Text>
                <View style={styles.returnBlock}>
                  <Ionicons
                    color={returnColor}
                    name={
                      pnl > 0 ? "arrow-up" : pnl < 0 ? "arrow-down" : "remove"
                    }
                    size={13}
                  />
                  <Text style={[styles.returnValue, returnTone]}>
                    {formattedReturn}
                  </Text>
                </View>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function LoadingList({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View
      accessibilityLabel="Loading holdings"
      accessibilityRole="progressbar"
      style={styles.loadingList}
    >
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.loadingRow}>
          <View style={[styles.loadingBar, styles.loadingName]} />
          <View style={[styles.loadingBar, styles.loadingMeta]} />
          <View style={[styles.loadingBar, styles.loadingValue]} />
        </View>
      ))}
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
    holdingRow: {
      backgroundColor: theme.surface,
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      borderLeftColor: theme.border,
      borderLeftWidth: 1,
      borderRightColor: theme.border,
      borderRightWidth: 1,
      minHeight: 108,
      padding: 16,
    },
    firstHoldingRow: {
      borderTopColor: theme.border,
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      borderTopWidth: 1,
    },
    lastHoldingRow: {
      borderBottomLeftRadius: 12,
      borderBottomRightRadius: 12,
    },
    holdingHeader: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: 14,
      justifyContent: "space-between",
    },
    symbol: {
      color: theme.foreground,
      flex: 1,
      fontSize: 16,
      fontWeight: "700",
      minWidth: 0,
    },
    value: {
      color: theme.foreground,
      flexShrink: 1,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      fontWeight: "700",
      textAlign: "right",
    },
    meta: {
      color: theme.mutedForeground,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 4,
    },
    holdingFooter: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 15,
    },
    date: { color: theme.mutedForeground, fontSize: 12 },
    returnBlock: { alignItems: "center", flexDirection: "row", gap: 3 },
    returnValue: {
      fontSize: 13,
      fontVariant: ["tabular-nums"],
      fontWeight: "700",
    },
    positive: { color: theme.positive },
    negative: { color: theme.negative },
    mutedReturn: { color: theme.mutedForeground },
    loadingList: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      overflow: "hidden",
    },
    loadingRow: {
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      height: 108,
      padding: 16,
    },
    loadingBar: { backgroundColor: theme.skeleton, borderRadius: 5 },
    loadingName: { height: 15, width: "44%" },
    loadingMeta: { height: 11, marginTop: 8, width: "66%" },
    loadingValue: { height: 13, marginTop: 20, width: "32%" },
  });
}
