import type { ChatMessage } from "../types";

/**
 * Chat history importers. Everything runs on the phone; raw exports are never uploaded.
 *
 * Supported:
 *  - WhatsApp "Export chat" (iOS `[m/d/yy, h:mm:ss AM] Name: text` and
 *    Android `m/d/yy, h:mm - Name: text`; day-first locales auto-detected).
 *  - Facebook Messenger / Instagram "Download your information" JSON.
 *  - Android "SMS Backup & Restore" XML.
 *  - CSV with a header row, e.g. iMessage exports from Mac/PC backup tools
 *    (columns like "Message Date", "Sender Name", "Type", "Text").
 *  - WeChat text exports as produced by common PC backup tools
 *    (`2023-05-01 20:15:03 妈妈` header line, message body on following lines).
 * Continuation lines (multi-line messages) are appended to the previous message.
 */

const WA_IOS = /^‎?\[(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\]\s+([^:]+):\s?(.*)$/i;
const WA_ANDROID = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\s+-\s+([^:]+):\s?(.*)$/i;
const WECHAT_HEADER = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(.+?)\s*$/;

/** WhatsApp placeholders for media and system lines that carry no words of the person. */
const WA_SKIP = /^(<Media omitted>|<附件：.*>|image omitted|audio omitted|video omitted|sticker omitted|This message was deleted|‎?Messages and calls are end-to-end encrypted.*)$/i;
const WECHAT_SKIP = /^(\[图片\]|\[语音\]|\[视频\]|\[表情\]|\[动画表情\]|\[文件\]|\[位置\]|\[链接\].*|.*撤回了一条消息)$/;

/** What an import dropped, so the app can tell the family. */
export interface ImportStats {
  /** Rows/messages dropped because they were malformed or had an impossible date. */
  skipped: number;
  /** Messages kept but whose date couldn't be read (time left empty). */
  undated: number;
}

export const newImportStats = (): ImportStats => ({ skipped: 0, undated: 0 });

function validDateTime(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): boolean {
  if (!(y >= 1970 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && h >= 0 && h < 24 && mi >= 0 && mi < 60 && s >= 0 && s < 61)) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Epoch ms → "YYYY-MM-DDTHH:MM:SS", or undefined if not a plausible date. */
function isoFromMs(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  return y >= 1970 && y <= 2100 ? d.toISOString().slice(0, 19) : undefined;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export type DateOrder = "auto" | "mdy" | "dmy";

function waTime(m: RegExpMatchArray, order: "mdy" | "dmy"): string | undefined {
  const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
  let year = y, month: number, day: number;
  if (a > 31) {
    // year-first export: y/m/d
    year = a;
    month = b;
    day = y;
  } else if (order === "mdy") {
    month = a;
    day = b;
  } else {
    day = a;
    month = b;
  }
  if (year < 100) year += 2000;
  let h = Number(m[4]);
  const ampm = m[7]?.toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  if (!validDateTime(year, month, day, h, Number(m[5]), Number(m[6] ?? 0))) return undefined;
  return `${year}-${pad(month)}-${pad(day)}T${pad(h)}:${m[5]}:${m[6] ?? "00"}`;
}

/**
 * WhatsApp writes dates in the phone's locale with no marker. Look at the whole
 * file: any first field > 12 means day-first, any second field > 12 means
 * month-first; otherwise fall back (US/Canada default: month-first).
 */
function detectOrder(matches: RegExpMatchArray[], fallback: "mdy" | "dmy"): "mdy" | "dmy" {
  for (const m of matches) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 31) continue;
    if (a > 12) return "dmy";
    if (b > 12) return "mdy";
  }
  return fallback;
}

export function parseWhatsApp(raw: string, dateOrder: DateOrder = "auto", stats: ImportStats = newImportStats()): ChatMessage[] {
  const lines = raw.split(/\r?\n/);
  const matched = lines.map((l) => l.match(WA_IOS) ?? l.match(WA_ANDROID));
  const order = dateOrder === "auto" ? detectOrder(matched.filter((m): m is RegExpMatchArray => !!m), "mdy") : dateOrder;
  const out: ChatMessage[] = [];
  // After a dropped message, its continuation lines are dropped too.
  let dropping = false;
  lines.forEach((line, i) => {
    const m = matched[i];
    if (m) {
      const text = (m[9] ?? "").trim();
      dropping = false;
      if (WA_SKIP.test(text)) return;
      const time = waTime(m, order);
      if (!time) {
        stats.skipped++;
        dropping = true;
        return;
      }
      out.push({ time, sender: (m[8] ?? "").trim(), text });
    } else if (line.trim()) {
      if (dropping) return;
      if (out.length > 0) out[out.length - 1]!.text += "\n" + line.trim();
    }
  });
  return out.filter((x) => x.text.length > 0);
}

export function parseWeChatText(raw: string, stats: ImportStats = newImportStats()): ChatMessage[] {
  const out: ChatMessage[] = [];
  let current: ChatMessage | undefined;
  let skipBody = false;
  const flush = () => {
    if (current && current.text && !WECHAT_SKIP.test(current.text)) out.push(current);
    current = undefined;
  };
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(WECHAT_HEADER);
    if (m) {
      flush();
      if (!validDateTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))) {
        stats.skipped++;
        current = undefined;
        skipBody = true;
        continue;
      }
      skipBody = false;
      current = {
        time: `${m[1]}-${m[2]}-${m[3]}T${pad(Number(m[4]))}:${m[5]}:${m[6]}`,
        sender: m[7] ?? "",
        text: "",
      };
    } else if (current && !skipBody && line.trim()) {
      current.text = current.text ? current.text + "\n" + line.trim() : line.trim();
    }
  }
  flush();
  return out;
}

// ---------- Facebook Messenger / Instagram JSON ----------

/**
 * Meta's exports write UTF-8 bytes as \u00XX escapes ("cafÃ©" for "café").
 * Re-decode when every code unit fits in a byte.
 */
function fixMetaMojibake(s: string): string {
  if (![...s].every((c) => c.charCodeAt(0) < 256) || !/[\u0080-\u00ff]/.test(s)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
}

const META_SKIP = /^(.* sent an attachment\.|.* sent a photo\.|.* sent a link\.|Reacted .* to your message|.* reacted .* to your message|.* unsent a message|You are now connected on Messenger)$/i;

interface MetaExport {
  messages?: { sender_name?: string; timestamp_ms?: number; content?: string }[];
}

export function parseMessengerJson(raw: string, stats: ImportStats = newImportStats()): ChatMessage[] {
  const data = JSON.parse(raw) as MetaExport;
  const out: ChatMessage[] = [];
  const list = Array.isArray(data.messages) ? data.messages : [];
  for (const m of list) {
    if (typeof m !== "object" || m === null) {
      stats.skipped++;
      continue;
    }
    // Photos, stickers etc. have no content: not an error, just nothing to learn from.
    if (m.content === undefined) continue;
    if (typeof m.content !== "string" || typeof m.sender_name !== "string" || !m.sender_name) {
      stats.skipped++;
      continue;
    }
    const text = fixMetaMojibake(m.content).trim();
    if (!text || META_SKIP.test(text)) continue;
    let time = "";
    if (m.timestamp_ms !== undefined) {
      const iso = isoFromMs(Number(m.timestamp_ms));
      if (!iso) {
        stats.skipped++;
        continue;
      }
      time = iso;
    } else stats.undated++;
    out.push({ time, sender: fixMetaMojibake(m.sender_name), text });
  }
  // Exports are newest-first.
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

// ---------- Android "SMS Backup & Restore" XML ----------

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]!] = unescapeXml(m[2]!);
  return out;
}

/** `me` is the label used for the phone owner's own messages. */
export function parseSmsBackupXml(raw: string, me = "Me", stats: ImportStats = newImportStats()): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of raw.matchAll(/<sms\s[^>]*?\/?>/g)) {
    const a = xmlAttrs(m[0]);
    const text = (a.body ?? "").trim();
    if (!text) continue;
    const contact = a.contact_name && a.contact_name !== "(Unknown)" ? a.contact_name : a.address ?? "Unknown";
    let time = "";
    if (a.date) {
      const iso = isoFromMs(Number(a.date));
      if (!iso) {
        stats.skipped++;
        continue;
      }
      time = iso;
    } else stats.undated++;
    out.push({
      time,
      // type 1 = received, 2 = sent
      sender: a.type === "2" ? me : contact,
      text,
    });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

// ---------- CSV (iMessage and generic) ----------

export function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (quoted) {
      if (c === '"' && raw[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

function findCol(header: string[], ...patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(h.trim()));
    if (i >= 0) return i;
  }
  return -1;
}

function csvHeader(header: string[]) {
  return {
    date: findCol(header, /^message date$/i, /^date$/i, /date|time/i),
    sender: findCol(header, /^sender name$/i, /^(from|sender|author)$/i, /sender|from|contact/i),
    text: findCol(header, /^(text|message|body|content)$/i, /text|message|body/i),
    type: findCol(header, /^(type|direction|is_from_me|is from me)$/i),
  };
}

/** Parse a CSV date leniently; "2023-05-01 20:15:03" is not ISO but is common. */
function csvDate(v: string): string | undefined {
  const s = v.trim();
  if (!s) return undefined;
  // Zone-less wall time: keep it as written (like the WhatsApp/WeChat parsers do).
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [y, mo, d, h, mi, sec] = m.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number, number, number];
    return validDateTime(y, mo, d, h, mi, sec) ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}` : undefined;
  }
  return isoFromMs(new Date(s).getTime());
}

export function parseChatCsv(raw: string, me = "Me", stats: ImportStats = newImportStats()): ChatMessage[] {
  const [header, ...rows] = parseCsvRows(raw.replace(/^\uFEFF/, ""));
  if (!header) return [];
  const col = csvHeader(header);
  if (col.text < 0) throw new Error("CSV has no message text column");
  const out: ChatMessage[] = [];
  for (const r of rows) {
    const text = (r[col.text] ?? "").trim();
    if (!text) {
      stats.skipped++;
      continue;
    }
    const type = col.type >= 0 ? (r[col.type] ?? "").trim().toLowerCase() : "";
    const outgoing = /^(outgoing|sent|out|1|true|yes)$/.test(type);
    let sender = col.sender >= 0 ? (r[col.sender] ?? "").trim() : "";
    if (outgoing || !sender) sender = outgoing ? me : sender || "Unknown";
    // A bad date shouldn't cost a message: keep it undated and count it.
    const time = col.date >= 0 ? csvDate(r[col.date] ?? "") : undefined;
    if (col.date >= 0 && !time) stats.undated++;
    out.push({ time: time ?? "", sender, text });
  }
  return out;
}

export type ExportFormat = "messenger" | "sms" | "wechat" | "whatsapp" | "csv";

export interface ImportResult extends ImportStats {
  messages: ChatMessage[];
  format: ExportFormat;
}

/** Pick a parser by sniffing the content, and report what was dropped. */
export function importChatExport(raw: string): ImportResult {
  const stats = newImportStats();
  const done = (format: ExportFormat, messages: ChatMessage[]): ImportResult => ({ messages, format, ...stats });
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{") && trimmed.includes('"messages"')) return done("messenger", parseMessengerJson(trimmed, stats));
  if (trimmed.includes("<smses")) return done("sms", parseSmsBackupXml(trimmed, "Me", stats));
  const head = raw.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  if (head.some((l) => WECHAT_HEADER.test(l))) return done("wechat", parseWeChatText(raw, stats));
  if (head.some((l) => WA_IOS.test(l) || WA_ANDROID.test(l))) return done("whatsapp", parseWhatsApp(raw, "auto", stats));
  const first = parseCsvRows(head[0] ?? "")[0] ?? [];
  if (first.length >= 2 && csvHeader(first).text >= 0) return done("csv", parseChatCsv(raw, "Me", stats));
  return done("whatsapp", parseWhatsApp(raw, "auto", stats));
}

/** Pick a parser by sniffing the content. */
export function parseChatExport(raw: string): ChatMessage[] {
  return importChatExport(raw).messages;
}

/** Distinct sender names, most active first — used for the "which one is them?" picker. */
export function senders(messages: ChatMessage[]): string[] {
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}
