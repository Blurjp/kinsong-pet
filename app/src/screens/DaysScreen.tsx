import { Alert, Platform, Text, View } from "react-native";
import { occasionTitle, upcomingOccasions, type PetProfile, type Visit } from "@sinian/core";
import { today, useStore } from "../state/store";
import { Button, Card, Note, colors } from "../ui";

function prettyDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function describe(v: Visit): string {
  switch (v.kind) {
    case "candle":
      return "🕯 Lit a candle";
    case "flower":
      return `🌼 Planted a ${v.flower}`;
    case "treat":
      return `🦴 Left ${v.treat}`;
    case "letter":
      return `✉️ “${v.text}”`;
  }
}

/** Remembrance days ahead, and a journal of every visit. */
export function DaysScreen({ pet, onEdit }: { pet: PetProfile; onEdit: () => void }) {
  const { state, reset } = useStore();
  const upcoming = upcomingOccasions(pet, today(), 365);
  const journal = [...state.visits].sort((a, b) => b.on.localeCompare(a.on));

  const confirmDelete = () => {
    const msg = `This removes ${pet.name}'s garden, letters and wishes from this phone. It can't be undone.`;
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(msg)) reset();
      return;
    }
    Alert.alert("Delete the garden?", msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: reset },
    ]);
  };

  return (
    <View>
      <Card title="Days to remember">
        <Note>{"We'll only remind you on these days — never on ordinary ones."}</Note>
        {upcoming.map((o) => (
          <View key={o.kind + o.on} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderColor: "#eee" }}>
            <Text style={{ fontSize: 15, color: colors.ink }}>{occasionTitle(pet, o)}</Text>
            <Text style={{ color: colors.muted }}>{prettyDay(o.on)}</Text>
          </View>
        ))}
      </Card>

      <Card title="Journal">
        {journal.length === 0 ? (
          <Note>Your visits and letters will appear here.</Note>
        ) : (
          journal.map((v) => (
            <View key={v.id} style={{ paddingVertical: 6 }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{prettyDay(v.on)}</Text>
              <Text style={{ color: colors.ink, fontSize: 15 }}>{describe(v)}</Text>
            </View>
          ))
        )}
      </Card>

      <Card title="Settings">
        <Button kind="soft" label={`Edit ${pet.name}'s details`} onPress={onEdit} />
        <Button kind="danger" label="Delete the garden" onPress={confirmDelete} />
        <Note>Nothing here is ever for sale: flowers, candles, treats and letters are always free.</Note>
      </Card>
    </View>
  );
}
