import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText as Text } from "./app-text";
import { AppButton } from "./mobile-ui";
import { useTheme } from "./theme";

export function FilterField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const selected =
    options.find((option) => option.value === value)?.label ?? value;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => ({
          minHeight: 44,
          paddingHorizontal: 12,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: pressed ? theme.elevated : theme.card,
        })}
      >
        <Text style={{ color: theme.foreground, fontSize: 13 }}>
          {selected}
        </Text>
        <Ionicons name="chevron-down" color={theme.mutedForeground} size={14} />
      </Pressable>
      <Modal
        visible={isOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          <View
            style={{
              padding: 20,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{
                color: theme.foreground,
                fontSize: 20,
                fontWeight: "600",
              }}
            >
              {label}
            </Text>
            <AppButton
              label="Close choices"
              variant="secondary"
              onPress={() => setIsOpen(false)}
            >
              Done
            </AppButton>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: option.value === value }}
                onPress={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                style={{
                  minHeight: 52,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <Text style={{ color: theme.foreground, flex: 1 }}>
                  {option.label}
                </Text>
                {option.value === value ? (
                  <Ionicons
                    name="checkmark"
                    color={theme.foreground}
                    size={20}
                  />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
