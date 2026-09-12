import { StyleSheet, View } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";
import { AppText as Text } from "./app-text";
import { useAmounts } from "./amounts";
import { useTheme } from "./theme";

type HistoryPoint = {
  snapshotDate: string;
  currentValue: number;
  investedAmount: number;
};

export function ValueHistory({ data }: { data: HistoryPoint[] }) {
  const theme = useTheme();
  const { formatAmount } = useAmounts();
  const points = data.filter(
    (point) =>
      Number.isFinite(point.currentValue) &&
      Number.isFinite(new Date(point.snapshotDate).getTime()),
  );
  const first = points[0];
  const last = points.at(-1);
  const values = points.map((point) => point.currentValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const firstTime = first ? new Date(first.snapshotDate).getTime() : 0;
  const timeRange = last
    ? new Date(last.snapshotDate).getTime() - firstTime
    : 0;
  const coordinates = points
    .map((point) => {
      const x =
        8 +
        ((new Date(point.snapshotDate).getTime() - firstTime) /
          (timeRange || 1)) *
          304;
      const y =
        max === min
          ? 80
          : 148 - ((point.currentValue - min) / (max - min)) * 132;

      return `${x},${y}`;
    })
    .join(" ");

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <View style={styles.heading}>
        <Text style={[styles.title, { color: theme.foreground }]}>
          Value history
        </Text>
        <Text style={{ color: theme.mutedForeground, fontSize: 11 }}>
          All snapshots
        </Text>
      </View>
      {points.length < 2 || !first || !last ? (
        <View style={{ paddingVertical: 28, gap: 8 }}>
          <Text style={{ color: theme.foreground, fontWeight: "500" }}>
            Your history starts here
          </Text>
          <Text style={[styles.caption, { color: theme.mutedForeground }]}>
            Import another dated snapshot on the web to compare portfolio
            values.
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.caption, { color: theme.mutedForeground }]}>
            {formatAmount(min)} to {formatAmount(max)}
          </Text>
          <View
            accessible
            accessibilityLabel={`Portfolio value from ${first.snapshotDate} to ${last.snapshotDate}: ${formatAmount(first.currentValue)} to ${formatAmount(last.currentValue)}`}
          >
            <Svg
              width="100%"
              height={180}
              viewBox="0 0 320 160"
              accessibilityElementsHidden
            >
              {[16, 80, 148].map((y) => (
                <Line
                  key={y}
                  x1={8}
                  x2={312}
                  y1={y}
                  y2={y}
                  stroke={theme.border}
                  strokeDasharray="3 5"
                />
              ))}
              <Polyline
                points={coordinates}
                fill="none"
                stroke={
                  last.currentValue >= last.investedAmount
                    ? theme.positive
                    : theme.negative
                }
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
            </Svg>
          </View>
          <View style={styles.heading}>
            <Text style={[styles.caption, { color: theme.mutedForeground }]}>
              {first.snapshotDate}
            </Text>
            <Text style={[styles.caption, { color: theme.mutedForeground }]}>
              {last.snapshotDate}
            </Text>
          </View>
          <Text
            style={[
              styles.caption,
              { color: theme.mutedForeground, marginTop: 12 },
            ]}
          >
            Value changes include deposits and withdrawals.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 20 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  title: { fontSize: 17, fontWeight: "600" },
  caption: { fontSize: 12, lineHeight: 18 },
});
