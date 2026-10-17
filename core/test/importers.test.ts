import { describe, expect, it } from "vitest";
import { parseChatCsv, parseChatExport, parseMessengerJson, parseSmsBackupXml, parseWhatsApp, parseWeChatText, senders } from "../src/importers/index";

describe("WhatsApp", () => {
  it("parses iOS format, multiline and skips media", () => {
    const raw = [
      "[3/4/22, 9:05:11 PM] Mum: Did you eat?",
      "Remember your coat",
      "[3/4/22, 9:06:00 PM] Me: yes mum",
      "[3/4/22, 9:07:00 PM] Mum: image omitted",
    ].join("\n");
    const m = parseWhatsApp(raw, "dmy");
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual({ time: "2022-04-03T21:05:11", sender: "Mum", text: "Did you eat?\nRemember your coat" });
    expect(parseWhatsApp(raw)[0]!.time).toBe("2022-03-04T21:05:11"); // ambiguous → US month-first
  });

  it("auto-detects month-first from an unambiguous line", () => {
    const raw = "[12/25/23, 8:00:00\u202fAM] Mom: Merry Christmas!\n[1/2/24, 9:00:00 AM] Mom: Happy new year";
    expect(parseWhatsApp(raw).map((m) => m.time)).toEqual(["2023-12-25T08:00:00", "2024-01-02T09:00:00"]);
  });

  it("parses Android format", () => {
    const m = parseWhatsApp("25/12/2021, 08:30 - Dad: Merry Christmas!");
    expect(m[0]).toEqual({ time: "2021-12-25T08:30:00", sender: "Dad", text: "Merry Christmas!" });
  });
});

describe("WeChat", () => {
  const raw = [
    "2023-05-01 20:15:03 妈妈",
    "吃饭了没",
    "",
    "2023-05-01 20:16:10 我",
    "吃了",
    "2023-05-01 20:16:30 妈妈",
    "[图片]",
    "2023-05-01 20:17:00 妈妈",
    "天冷了多穿点呢",
    "别感冒了",
  ].join("\n");

  it("parses header + body blocks and skips placeholders", () => {
    const m = parseWeChatText(raw);
    expect(m.map((x) => x.text)).toEqual(["吃饭了没", "吃了", "天冷了多穿点呢\n别感冒了"]);
    expect(m[0]!.time).toBe("2023-05-01T20:15:03");
  });

  it("is auto-detected", () => {
    expect(parseChatExport(raw)).toHaveLength(3);
    expect(senders(parseChatExport(raw))).toEqual(["妈妈", "我"]);
  });
});

describe("North American exports", () => {
  it("parses Messenger JSON, fixes mojibake, sorts oldest first", () => {
    const raw = JSON.stringify({
      participants: [{ name: "Mom" }, { name: "Alex" }],
      messages: [
        { sender_name: "Mom", timestamp_ms: 1700000100000, content: "Love you sweetie \u00e2\u009d\u00a4\u00ef\u00b8\u008f" },
        { sender_name: "Alex", timestamp_ms: 1700000000000, content: "Night mom" },
        { sender_name: "Mom", timestamp_ms: 1700000200000, content: "Mom sent an attachment." },
      ],
    });
    const m = parseChatExport(raw);
    expect(m.map((x) => x.sender)).toEqual(["Alex", "Mom"]);
    expect(m[1]!.text).toBe("Love you sweetie ❤️");
    expect(parseMessengerJson(raw)).toHaveLength(2);
  });

  it("parses SMS Backup & Restore XML", () => {
    const raw = `<?xml version='1.0'?><smses count="2">
<sms protocol="0" address="+15551234567" date="1700000000000" type="1" body="Call me when you land &amp; drive safe" contact_name="Dad" />
<sms protocol="0" address="+15551234567" date="1700000100000" type="2" body="Landed!" contact_name="Dad" />
</smses>`;
    const m = parseSmsBackupXml(raw);
    expect(m).toEqual([
      { time: "2023-11-14T22:13:20", sender: "Dad", text: "Call me when you land & drive safe" },
      { time: "2023-11-14T22:15:00", sender: "Me", text: "Landed!" },
    ]);
    expect(parseChatExport(raw)).toHaveLength(2);
  });

  it("parses iMessage-style CSV with quoted multiline text", () => {
    const raw = 'Message Date,Service,Type,Sender Name,Text\n2023-06-01T18:00:00Z,iMessage,Incoming,Grandpa,"Proud of you, kiddo.\nSee you Sunday"\n2023-06-01T18:05:00Z,iMessage,Outgoing,,Thanks grandpa!';
    const m = parseChatCsv(raw);
    expect(m.map((x) => x.sender)).toEqual(["Grandpa", "Me"]);
    expect(m[0]!.text).toBe("Proud of you, kiddo.\nSee you Sunday");
    expect(parseChatExport(raw)).toHaveLength(2);
  });
});
