import { useState } from "react";
import { Text, View } from "react-native";
import { imaginedPostcard, type PetProfile } from "@sinian/core";
import { newId, today, useStore } from "../state/store";
import { Postcard } from "../components/Postcard";
import { Button, Card, Field, Note, colors, s } from "../ui";

/**
 * Things they never got to do. Each wish gets an imagined postcard, and the
 * family can mark it done when they carry it out in real life for them.
 */
export function WishesScreen({ pet }: { pet: PetProfile }) {
  const { update } = useStore();
  const [text, setText] = useState("");
  const [open, setOpen] = useState<string | undefined>(pet.wishes[pet.wishes.length - 1]?.id);

  const add = () => {
    const id = newId();
    update((st) => (st.pet ? { ...st, pet: { ...st.pet, wishes: [...st.pet.wishes, { id, text: text.trim() }] } } : st));
    setText("");
    setOpen(id);
  };

  const markDone = (id: string) =>
    update((st) =>
      st.pet
        ? { ...st, pet: { ...st.pet, wishes: st.pet.wishes.map((w) => (w.id === id ? { ...w, doneInRealLife: { on: today() } } : w)) } }
        : st,
    );

  return (
    <View>
      <Text style={[s.h1, { marginBottom: 4 }]}>{`${pet.name}'s wishes`}</Text>
      <Note>{"Something they always wanted, or something you wish you'd done together. You can also carry it out for them in real life."}</Note>

      <Card>
        <Field label={`${pet.name} always wanted to…`} value={text} onChangeText={setText} placeholder="chase the seagulls at the beach" />
        <Button label="Add wish" onPress={add} disabled={!text.trim()} />
      </Card>

      {[...pet.wishes].reverse().map((w) => (
        <Card key={w.id}>
          <Text style={{ fontSize: 16, color: colors.ink }} onPress={() => setOpen(open === w.id ? undefined : w.id)}>
            {w.doneInRealLife ? "✓ " : "☆ "}
            {w.text}
          </Text>
          {w.doneInRealLife && <Note>You did this for {pet.name} on {w.doneInRealLife.on}.</Note>}
          {open === w.id && (
            <View style={{ marginTop: 10 }}>
              <Postcard pet={pet} card={imaginedPostcard(pet, w)} />
              {!w.doneInRealLife && <Button kind="soft" label={`We did this for ${pet.name} in real life`} onPress={() => markDone(w.id)} />}
            </View>
          )}
        </Card>
      ))}
    </View>
  );
}
