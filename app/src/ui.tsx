import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

export const colors = {
  bg: "#fbf6ee",
  card: "#ffffff",
  ink: "#2e2a26",
  muted: "#7d746b",
  accent: "#6b8fc7",
  accentSoft: "#e6eef9",
  danger: "#b3261e",
};

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {title ? <Text style={s.h2}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "soft" | "danger";
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.btn, kind === "soft" && s.btnSoft, kind === "danger" && s.btnDanger, disabled && { opacity: 0.4 }]}
    >
      <Text style={[s.btnText, kind === "soft" && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.label}>{props.label}</Text>
      <TextInput placeholderTextColor="#b0a89e" {...props} style={[s.input, props.multiline && { minHeight: 72, textAlignVertical: "top" }]} />
    </View>
  );
}

export function Chip({ label, on, onPress, swatch }: { label?: string; on: boolean; onPress: () => void; swatch?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      style={[s.chip, on && s.chipOn, swatch ? { backgroundColor: swatch, width: 32, height: 32, borderRadius: 16, paddingHorizontal: 0 } : null, swatch && on ? { borderWidth: 3 } : null]}
    >
      {swatch ? null : <Text style={{ color: on ? "#fff" : colors.accent }}>{label}</Text>}
    </Pressable>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <Text style={s.note}>{children}</Text>;
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  h1: { fontSize: 22, fontWeight: "700", color: colors.ink },
  h2: { fontSize: 17, fontWeight: "600", color: colors.ink, marginBottom: 10 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderColor: "#d8cfc3", borderRadius: 10, padding: 10, fontSize: 16, color: colors.ink, backgroundColor: "#fff" },
  btn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: "center", marginTop: 8 },
  btnSoft: { backgroundColor: colors.accentSoft },
  btnDanger: { backgroundColor: colors.danger },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  note: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 16, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 12, paddingVertical: 6, justifyContent: "center", alignItems: "center" },
  chipOn: { backgroundColor: colors.accent },
});
