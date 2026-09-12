import { assetClassLabel, formatDate } from "../src/format";
import { InstrumentMark, LogoAttribution } from "../src/instrument-mark";
import { useAmounts } from "../src/amounts";
import { FilterField } from "../src/filter-field";
import { AppText as Text } from "../src/app-text";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  FlatList,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
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

export default function HoldingsScreen() {
  const holdings = trpc.portfolio.positions.useQuery();
  const { formatAmount } = useAmounts();
  const [search, setSearch] = useState("");
  const [assetClass, setAssetClass] = useState("all");
  const [account, setAccount] = useState("all");
  const [status, setStatus] = useState("current");
  const [sort, setSort] = useState("value");
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const positions = [
    ...(holdings.data?.current ?? []).map((item) => ({
      ...item,
      isExited: false,
    })),
    ...(holdings.data?.exited ?? []).map((item) => ({
      ...item,
      isExited: true,
    })),
  ];
  const normalizedSearch = search.trim().toLowerCase();
  const data = positions
    .filter(
      (item) =>
        (status === "all" || item.isExited === (status === "exited")) &&
        (assetClass === "all" || item.assetClass === assetClass) &&
        (account === "all" || item.accountName === account) &&
        [item.instrumentName, item.symbol, item.accountName].some((value) =>
          value?.toLowerCase().includes(normalizedSearch),
        ),
    )
    .sort((left, right) =>
      sort === "name"
        ? left.instrumentName.localeCompare(right.instrumentName)
        : right.currentValueInInr - left.currentValueInInr,
    );

  function resetFilters() {
    setSearch("");
    setAssetClass("all");
    setAccount("all");
    setStatus("current");
    setSort("value");
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <FlatList
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        data={data}
        keyExtractor={(item) => item.id}
        onRefresh={() => void holdings.refetch()}
        refreshing={holdings.isFetching && !holdings.isLoading}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <PortfolioToolbar />
            <PageHeader
              title="Holdings"
              description="Every position, across your accounts."
            />
            <View
              style={[
                styles.search,
                { borderColor: theme.input, backgroundColor: theme.card },
              ]}
            >
              <Ionicons
                name="search-outline"
                color={theme.mutedForeground}
                size={18}
              />
              <TextInput
                accessibilityLabel="Search holdings"
                placeholder="Search holdings"
                placeholderTextColor={theme.mutedForeground}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                style={{
                  flex: 1,
                  color: theme.foreground,
                  minHeight: 44,
                  fontFamily: "PublicSans_400Regular",
                }}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 12 }}
            >
              <FilterField
                label="Position status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "current", label: "Current" },
                  { value: "exited", label: "Exited" },
                  { value: "all", label: "All positions" },
                ]}
              />
              <FilterField
                label="Asset class"
                value={assetClass}
                onChange={setAssetClass}
                options={[
                  { value: "all", label: "All assets" },
                  ...[...new Set(positions.map((item) => item.assetClass))]
                    .sort()
                    .map((value) => ({ value, label: assetClassLabel(value) })),
                ]}
              />
              <FilterField
                label="Account"
                value={account}
                onChange={setAccount}
                options={[
                  { value: "all", label: "All accounts" },
                  ...[...new Set(positions.map((item) => item.accountName))]
                    .sort()
                    .map((value) => ({ value, label: value })),
                ]}
              />
              <FilterField
                label="Sort holdings"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "value", label: "Highest value" },
                  { value: "name", label: "Name" },
                ]}
              />
            </ScrollView>
            <Text
              style={{
                color: theme.mutedForeground,
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              {holdings.isLoading
                ? "Loading positions"
                : `${data.length} positions`}
            </Text>
          </View>
        }
        ListFooterComponent={<LogoAttribution />}
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
              description={
                positions.length
                  ? "Try another search or clear your filters."
                  : "Import a statement on the web to see your holdings here."
              }
              title={
                positions.length
                  ? "No matching holdings"
                  : "Your portfolio starts here"
              }
              action={
                positions.length ? (
                  <AppButton
                    label="Clear filters"
                    variant="secondary"
                    onPress={resetFilters}
                  >
                    Clear filters
                  </AppButton>
                ) : undefined
              }
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
          const formattedReturn =
            item.pnlPercent == null
              ? "N/A"
              : `${percentage.format(Number(item.pnlPercent))}%`;

          return (
            <View
              accessible
              accessibilityLabel={`${name}, ${formatAmount(
                item.currentValueInInr,
              )}, return ${formattedReturn}`}
              style={[
                styles.holdingRow,
                index === 0 && styles.firstHoldingRow,
                index === data.length - 1 && styles.lastHoldingRow,
              ]}
            >
              <View style={styles.holdingHeader}>
                <InstrumentMark
                  name={item.instrumentName}
                  symbol={item.symbol}
                  assetClass={item.assetClass}
                  isin={item.isin}
                  exchange={item.exchange}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styles.symbol}>
                    {name}
                  </Text>
                  <Text numberOfLines={1} style={styles.meta}>
                    {item.instrumentName}
                  </Text>
                </View>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={styles.value}
                >
                  {formatAmount(item.currentValueInInr)}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.meta}>
                {item.accountName} · {assetClassLabel(item.assetClass)}
                {item.isExited ? " · Exited" : ""}
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
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderRadius: 8,
    },
    holdingRow: {
      backgroundColor: theme.surface,
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      borderLeftColor: theme.border,
      borderLeftWidth: 0,
      borderRightColor: theme.border,
      borderRightWidth: 0,
      minHeight: 108,
      paddingVertical: 18,
    },
    firstHoldingRow: {
      borderTopColor: theme.border,

      borderTopWidth: 1,
    },
    lastHoldingRow: {},
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
      fontWeight: "600",
      minWidth: 0,
    },
    value: {
      color: theme.foreground,
      flexShrink: 1,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      fontWeight: "600",
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
      fontWeight: "600",
    },
    positive: { color: theme.positive },
    negative: { color: theme.negative },
    mutedReturn: { color: theme.mutedForeground },
    loadingList: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 16,
      borderWidth: 1,
      overflow: "hidden",
    },
    loadingRow: {
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      height: 108,
      paddingVertical: 18,
    },
    loadingBar: { backgroundColor: theme.skeleton, borderRadius: 5 },
    loadingName: { height: 15, width: "44%" },
    loadingMeta: { height: 11, marginTop: 8, width: "66%" },
    loadingValue: { height: 13, marginTop: 20, width: "32%" },
  });
}
