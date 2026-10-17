import { describe, expect, it } from "vitest";
import { importChatExport, parseChatExport } from "../src/importers/index";

describe("importers skip and report bad rows", () => {
  it("WhatsApp: drops impossible dates and their continuation lines", () => {
    const raw = [
      "[1/2/23, 9:00:00 AM] Mom: good morning",
      "[13/45/23, 9:01:00 AM] Mom: broken date",
      "continuation of broken",
      "[1/2/23, 9:02:00 AM] Me: hi mom",
      "[2/30/23, 9:03:00 AM] Mom: feb 30",
    ].join("\n");
    const r = importChatExport(raw);
    expect(r.format).toBe("whatsapp");
    expect(r.messages.map((m) => m.text)).toEqual(["good morning", "hi mom"]);
    expect(r.skipped).toBe(2);
  });

  it("WeChat: skips headers with impossible dates", () => {
    const raw = "2023-05-01 20:15:03 妈妈\n吃饭了吗\n2023-13-01 20:16:00 妈妈\n坏日期\n2023-05-01 20:17:00 我\n吃了";
    const r = importChatExport(raw);
    expect(r.format).toBe("wechat");
    expect(r.messages.map((m) => m.text)).toEqual(["吃饭了吗", "吃了"]);
    expect(r.skipped).toBe(1);
  });

  it("SMS XML: an invalid date no longer throws", () => {
    const raw = `<smses><sms address="1" date="1700000000000" type="1" body="hello" contact_name="Mom"/><sms address="1" date="not-a-number" type="1" body="bad" contact_name="Mom"/><sms address="1" date="99999999999999999" type="1" body="far future" contact_name="Mom"/><sms address="1" type="2" body="no date"/></smses>`;
    const r = importChatExport(raw);
    expect(r.format).toBe("sms");
    expect(r.messages.map((m) => m.text).sort()).toEqual(["hello", "no date"]);
    expect(r.skipped).toBe(2);
    expect(r.undated).toBe(1);
  });

  it("Messenger JSON: skips malformed entries, not attachments", () => {
    const raw = JSON.stringify({
      messages: [
        { sender_name: "Mom", timestamp_ms: 1700000000000, content: "love you" },
        { sender_name: "Mom", timestamp_ms: 1700000001000 }, // photo: no content, silently ignored
        { sender_name: "Mom", timestamp_ms: "garbage", content: "bad time" },
        { timestamp_ms: 1700000002000, content: "no sender" },
        { sender_name: "Mom", content: 42 },
        null,
      ],
    });
    const r = importChatExport(raw);
    expect(r.messages.map((m) => m.text)).toEqual(["love you"]);
    expect(r.skipped).toBe(4);
  });

  it("CSV: keeps messages with unreadable dates (undated) and skips empty rows", () => {
    const raw = 'Message Date,Sender Name,Text\n2023-05-01 20:15:03,Mom,hi\nyesterday-ish,Mom,still kept\n2023-05-01 20:16:00,Mom,\n';
    const r = importChatExport(raw);
    expect(r.format).toBe("csv");
    expect(r.messages.map((m) => m.text)).toEqual(["hi", "still kept"]);
    expect(r.messages[0]!.time).toBe("2023-05-01T20:15:03");
    expect(r.messages[1]!.time).toBe("");
    expect(r.undated).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it("parseChatExport keeps its old behaviour (messages only)", () => {
    expect(parseChatExport("[1/2/23, 9:00:00 AM] Mom: hey")).toHaveLength(1);
  });

  it("a clean file reports nothing skipped", () => {
    const r = importChatExport("[1/2/23, 9:00:00 AM] Mom: hey\n[1/2/23, 9:01:00 AM] Me: hi");
    expect(r).toMatchObject({ skipped: 0, undated: 0 });
  });
});
