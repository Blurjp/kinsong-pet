import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { StoreProvider, useStore, type PetState } from "./src/state/store";
import { SetupScreen } from "./src/screens/SetupScreen";
import { GardenScreen } from "./src/screens/GardenScreen";
import { WishesScreen } from "./src/screens/WishesScreen";
import { DaysScreen } from "./src/screens/DaysScreen";
import { MemoriesScreen } from "./src/screens/MemoriesScreen";
import { colors } from "./src/ui";

const TABS = [
  { key: "garden", label: "Garden" },
  { key: "memories", label: "Memories" },
  { key: "wishes", label: "Wishes" },
  { key: "days", label: "Days" },
] as const;
type Tab = (typeof TABS)[number]["key"] | "edit";

function Shell() {
  const { state, ready } = useStore();
  const [tab, setTab] = useState<Tab>("garden");
  if (!ready) return null;
  const pet = state.pet;

  let body;
  if (!pet || tab === "edit") body = <SetupScreen onDone={() => setTab("garden")} />;
  else if (tab === "wishes") body = <WishesScreen pet={pet} />;
  else if (tab === "memories") body = <MemoriesScreen pet={pet} />;
  else if (tab === "days") body = <DaysScreen pet={pet} onEdit={() => setTab("edit")} />;
  else body = <GardenScreen pet={pet} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 16, maxWidth: 560, width: "100%", alignSelf: "center" }}>{body}</ScrollView>
      {pet && (
        <View style={{ flexDirection: "row", borderTopWidth: 0.5, borderColor: "#e3d9cc", backgroundColor: colors.card }}>
          {TABS.map((t) => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" style={{ flex: 1, paddingVertical: 14, alignItems: "center" }}>
              <Text style={{ color: tab === t.key ? colors.accent : colors.muted, fontWeight: tab === t.key ? "600" : "400" }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

/** `initial` lets tests and previews start from a given state instead of storage. */
export function PetsApp({ initial }: { initial?: Partial<PetState> }) {
  return (
    <SafeAreaProvider>
      <StoreProvider initial={initial}>
        <Shell />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

export default function App() {
  return <PetsApp />;
}
