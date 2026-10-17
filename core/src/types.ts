/** Media modalities a simulation may use. Consent is granted per modality. */
export type Modality = "text" | "voice" | "image" | "video";

export const ALL_MODALITIES: readonly Modality[] = ["text", "voice", "image", "video"];

/** One message from an imported chat history. */
export interface ChatMessage {
  /** ISO-8601 timestamp, or "" when the export has none. */
  time: string;
  sender: string;
  text: string;
}

/** A piece of retrievable memory: a story, a fact, or a slice of chat history. */
export interface MemoryItem {
  id: string;
  kind: "story" | "fact" | "chat";
  text: string;
  /** Who contributed it, e.g. "女儿 小雨". Shown to the family, never to the model as authority. */
  contributedBy?: string;
}

/** How the deceased wrote, distilled from their own messages. */
export interface StyleProfile {
  messageCount: number;
  avgChars: number;
  /** Phrases they used often, most frequent first. */
  catchphrases: string[];
  /** Emoji / emoticons they used, most frequent first. */
  emoji: string[];
  /** Sentence-final particles (呢、啊、哈…) by frequency. */
  particles: string[];
  /** Share of messages ending in "!" / "！". */
  exclaimRate: number;
  /** Real exchanges (someone said X, they replied Y) used as few-shot examples. */
  examples: { prompt: string; reply: string }[];
}

export interface PersonaProfile {
  /** Name the family uses for the simulation, e.g. "妈妈". */
  displayName: string;
  /** The person's real name, used only in the system prompt. */
  fullName: string;
  /** Free-text biography written by the family. */
  bio: string;
  /** What they called the current user, e.g. "囡囡". */
  addressesUserAs?: string;
  style: StyleProfile;
  /** Topics the family asked the simulation never to raise. */
  avoidTopics: string[];
  language: "zh" | "en";
}
