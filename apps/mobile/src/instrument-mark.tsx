import Ionicons from "@expo/vector-icons/Ionicons";
import {
  canRequestLogo,
  initialsFrom,
  instrumentLogoUrls,
  recordLogoFailure,
  usesPictogram,
  type InstrumentLogoInput,
} from "@investment-sync/instruments";
import { useState } from "react";
import { Image, Linking, Pressable, View } from "react-native";
import { AppText as Text } from "./app-text";
import { useTheme } from "./theme";

export function InstrumentMark({
  name,
  ...instrument
}: InstrumentLogoInput & { name: string }) {
  const theme = useTheme();
  const urls = instrumentLogoUrls(
    { ...instrument, name },
    process.env.EXPO_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY,
  );

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        overflow: "hidden",
        backgroundColor: theme.elevated,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <LogoImage key={urls.join("|")} urls={urls}>
        {usesPictogram(instrument.assetClass ?? "") ? (
          <Ionicons
            name={
              instrument.assetClass === "nps"
                ? "business-outline"
                : instrument.assetClass === "cash"
                  ? "cash-outline"
                  : "layers-outline"
            }
            size={18}
            color={theme.mutedForeground}
          />
        ) : (
          <Text
            style={{
              color: theme.mutedForeground,
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            {initialsFrom(instrument.symbol, name)}
          </Text>
        )}
      </LogoImage>
    </View>
  );
}

function LogoImage({
  urls,
  children,
}: {
  urls: string[];
  children: React.ReactNode;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const url = urls.find(
    (candidate) => !failed.includes(candidate) && canRequestLogo(candidate),
  );

  if (!url) return children;

  return (
    <Image
      source={{ uri: url }}
      style={{ width: 32, height: 32, backgroundColor: "#ffffff" }}
      resizeMode="contain"
      onError={() => {
        recordLogoFailure(url);
        setFailed((previous) => [...previous, url]);
      }}
    />
  );
}

export function LogoAttribution() {
  const theme = useTheme();

  if (!process.env.EXPO_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY?.startsWith("pk_"))
    return null;

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => void Linking.openURL("https://logo.dev").catch(() => {})}
      style={{ minHeight: 44, justifyContent: "center" }}
    >
      <Text style={{ color: theme.mutedForeground, fontSize: 12 }}>
        Logos provided by Logo.dev
      </Text>
    </Pressable>
  );
}
