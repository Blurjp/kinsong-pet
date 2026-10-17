import { useState } from "react";
import { Text, View } from "react-native";
import Svg from "react-native-svg";
import type { PetProfile, Species } from "@sinian/core";
import { useStore } from "../state/store";
import { PetSprite } from "../components/PetSprite";
import { Button, Card, Chip, Field, Note, s } from "../ui";

const SPECIES: { key: Species; label: string }[] = [
  { key: "dog", label: "Dog" },
  { key: "cat", label: "Cat" },
  { key: "rabbit", label: "Rabbit" },
  { key: "bird", label: "Bird" },
  { key: "other", label: "Other" },
];

const COATS = ["#f6efe3", "#f1dcb5", "#e0b67a", "#c8955a", "#d9792b", "#8a5a36", "#5b3d2a", "#9a9a9a", "#3a3634"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const list = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);

/** Create or edit the pet. Everything is optional except a name, species and the day they passed. */
export function SetupScreen({ onDone }: { onDone: () => void }) {
  const { state, update } = useStore();
  const p = state.pet;
  const [name, setName] = useState(p?.name ?? "");
  const [species, setSpecies] = useState<Species>(p?.species ?? "dog");
  const [coat, setCoat] = useState(p?.coat ?? "#c8955a");
  const [accent, setAccent] = useState(p?.accent ?? "#8a5a36");
  const [born, setBorn] = useState(p?.born ?? "");
  const [adopted, setAdopted] = useState(p?.adopted ?? "");
  const [passed, setPassed] = useState(p?.passed ?? "");
  const [toys, setToys] = useState(p?.favorites.toys.join(", ") ?? "");
  const [treats, setTreats] = useState(p?.favorites.treats.join(", ") ?? "");
  const [spots, setSpots] = useState(p?.favorites.spots.join(", ") ?? "");
  const [traits, setTraits] = useState(p?.traits.join(", ") ?? "");

  const datesOk = DAY.test(passed) && [born, adopted].every((d) => !d || DAY.test(d));
  const valid = name.trim().length > 0 && datesOk;

  const save = () => {
    const pet: PetProfile = {
      name: name.trim(),
      species,
      coat,
      accent,
      ...(born ? { born } : {}),
      ...(adopted ? { adopted } : {}),
      passed,
      favorites: { toys: list(toys), treats: list(treats), spots: list(spots) },
      traits: list(traits),
      wishes: p?.wishes ?? [],
    };
    update((st) => ({ ...st, pet }));
    onDone();
  };

  return (
    <View>
      <Text style={[s.h1, { marginBottom: 4 }]}>{p ? `About ${p.name}` : "A garden for your friend"}</Text>
      <Note>A quiet place to visit them on the days that matter. Everything stays on this phone.</Note>

      <Card>
        <View style={{ alignItems: "center", marginBottom: 6 }}>
          <Svg width={130} height={130} viewBox="0 0 100 100">
            <PetSprite species={species} coat={coat} accent={accent} x={50} y={50} size={96} />
          </Svg>
        </View>
        <Field label="Their name" value={name} onChangeText={setName} placeholder="Max" autoCapitalize="words" />
        <Text style={s.label}>They were a…</Text>
        <View style={s.row}>
          {SPECIES.map((x) => (
            <Chip key={x.key} label={x.label} on={species === x.key} onPress={() => setSpecies(x.key)} />
          ))}
        </View>
        <Text style={[s.label, { marginTop: 12 }]}>Coat</Text>
        <View style={s.row}>
          {COATS.map((c) => (
            <Chip key={c} label={`Coat ${c}`} swatch={c} on={coat === c} onPress={() => setCoat(c)} />
          ))}
        </View>
        <Text style={[s.label, { marginTop: 12 }]}>Ears and markings</Text>
        <View style={s.row}>
          {COATS.map((c) => (
            <Chip key={c} label={`Markings ${c}`} swatch={c} on={accent === c} onPress={() => setAccent(c)} />
          ))}
        </View>
      </Card>

      <Card title="Their days">
        <Field label="The day they crossed the bridge (YYYY-MM-DD)" value={passed} onChangeText={setPassed} placeholder="2025-10-20" />
        <Field label="Birthday (optional)" value={born} onChangeText={setBorn} placeholder="2012-03-14" />
        <Field label="Gotcha day — when they came home (optional)" value={adopted} onChangeText={setAdopted} placeholder="2012-06-01" />
        {!datesOk && passed.length > 0 && <Note>Please use the format YYYY-MM-DD.</Note>}
      </Card>

      <Card title="What they loved">
        <Field label="Favorite toys (comma-separated)" value={toys} onChangeText={setToys} placeholder="squeaky duck, tennis ball" />
        <Field label="Favorite treats" value={treats} onChangeText={setTreats} placeholder="peanut butter, cheese" />
        <Field label="Favorite spots" value={spots} onChangeText={setSpots} placeholder="the back porch, the sunny window" />
        <Field label="A few words about them" value={traits} onChangeText={setTraits} placeholder="goofy, gentle, always hungry" />
      </Card>

      <Button label={p ? "Save" : "Plant their garden"} onPress={save} disabled={!valid} />
    </View>
  );
}
