import { describe, expect, it } from "vitest";
import { accessFor, describeReason, evaluateConsent, type ConsentCase } from "../src/consent";

const base = (): ConsentCase => ({
  jurisdiction: "CN",
  deceasedName: "王秀兰",
  deathEvidenceHash: "sha256:abc",
  kinListAttested: true,
  relatives: [
    { id: "son", name: "儿子", relationship: "child", verified: true },
    { id: "dau", name: "女儿", relationship: "child", verified: true },
    { id: "bro", name: "弟弟", relationship: "sibling", verified: true },
  ],
  consents: [
    { relativeId: "son", decision: "grant", modalities: ["text", "voice", "image"], signedAt: "2026-01-01" },
    { relativeId: "dau", decision: "grant", modalities: ["text", "voice"], signedAt: "2026-01-02" },
  ],
});

describe("evaluateConsent", () => {
  it("is active with the intersection of first-tier grants", () => {
    expect(evaluateConsent(base())).toEqual({ state: "active", modalities: ["text", "voice"], allowedUsers: "all-consenting", notes: [] });
  });

  it("ignores second tier when first tier exists", () => {
    const c = base();
    c.consents.push({ relativeId: "bro", decision: "refuse", modalities: [], signedAt: "2026-01-03" });
    expect(evaluateConsent(c).state).toBe("active");
  });

  it("blocks on any first-tier refusal", () => {
    const c = base();
    c.consents[1] = { relativeId: "dau", decision: "refuse", modalities: [], signedAt: "2026-01-02" };
    expect(evaluateConsent(c).state).toBe("blocked");
  });

  it("is pending until every decisive relative signs and is verified", () => {
    const c = base();
    c.consents.pop();
    c.relatives[0]!.verified = false;
    const s = evaluateConsent(c);
    expect(s.state).toBe("pending");
    expect("reasons" in s && s.reasons.length).toBe(2);
  });

  it("requires death evidence and kin attestation", () => {
    const c = base();
    delete c.deathEvidenceHash;
    c.kinListAttested = false;
    expect(evaluateConsent(c).state).toBe("pending");
  });

  it("revocation wins and requires deleting everything", () => {
    const c = base();
    c.consents.push({ relativeId: "son", decision: "grant", modalities: ["text"], signedAt: "2026-02-01", revokedAt: "2026-03-01" });
    const s = evaluateConsent(c);
    expect(s.state).toBe("revoked");
    expect(s.state === "revoked" && s.mustDelete).toContain("voice");
  });

  it("a refusal in the person's own directive overrides unanimous family consent", () => {
    const c = base();
    c.directive = { decision: "refuse", modalities: [], allowedUsers: [], recordedAt: "2020-01-01" };
    expect(evaluateConsent(c).state).toBe("blocked");
  });

  it("the person's own directive caps modalities and users", () => {
    const c = base();
    c.directive = { decision: "grant", modalities: ["text"], allowedUsers: ["dau"], recordedAt: "2020-01-01" };
    expect(accessFor(c, "dau")).toEqual(["text"]);
    expect(accessFor(c, "son")).toEqual([]);
  });

  it("falls back to second tier when there is no first tier", () => {
    const c = base();
    c.relatives = c.relatives.filter((r) => r.relationship === "sibling");
    c.consents = [{ relativeId: "bro", decision: "grant", modalities: ["text"], signedAt: "2026-01-01" }];
    expect(evaluateConsent(c).state).toBe("active");
  });

  it("needs text in the agreed scope", () => {
    const c = base();
    c.consents[1] = { relativeId: "dau", decision: "grant", modalities: ["image"], signedAt: "2026-01-02" };
    expect(evaluateConsent(c).state).toBe("blocked");
  });
});

describe("accessFor", () => {
  it("denies relatives without their own grant on file", () => {
    expect(accessFor(base(), "bro")).toEqual([]);
    expect(accessFor(base(), "son")).toEqual(["text", "voice"]);
  });
});

describe("North America", () => {
  const na = (): ConsentCase => ({
    jurisdiction: "US",
    deceasedName: "Margaret Lee",
    deathEvidenceHash: "sha256:abc",
    kinListAttested: true,
    relatives: [
      { id: "son", name: "David Lee", relationship: "child", verified: true, personalRepresentative: true, authorityEvidenceHash: "sha256:letters" },
      { id: "dau", name: "Grace Lee", relationship: "child", verified: true },
    ],
    consents: [
      { relativeId: "son", decision: "grant", modalities: ["text", "voice", "image"], signedAt: "2026-01-01", biometricRelease: true },
      { relativeId: "dau", decision: "grant", modalities: ["text", "voice", "image"], signedAt: "2026-01-02" },
    ],
  });

  it("is active with the executor's biometric release", () => {
    const s = evaluateConsent(na());
    expect(s.state === "active" && s.modalities).toEqual(["text", "voice", "image"]);
  });

  it("defaults to US rules when no jurisdiction is set", () => {
    const c = na();
    delete c.jurisdiction;
    c.relatives[0]!.personalRepresentative = false;
    const s = evaluateConsent(c);
    expect(s.state).toBe("pending");
    expect("reasons" in s && s.reasons.map((r) => r.code)).toContain("no-personal-representative");
  });

  it("requires the executor's letters", () => {
    const c = na();
    delete c.relatives[0]!.authorityEvidenceHash;
    const s = evaluateConsent(c);
    expect(s.state === "pending" && describeReason(s.reasons[0]!, "en")).toContain("letters");
  });

  it("drops voice and image without a biometric release, keeping text", () => {
    const c = na();
    c.consents[0]!.biometricRelease = false;
    const s = evaluateConsent(c);
    expect(s.state === "active" && s.modalities).toEqual(["text"]);
    expect(s.state === "active" && s.notes[0]!.code).toBe("biometric-release-missing");
  });

  it("an executor who is not family must still sign, and can block", () => {
    const c = na();
    c.relatives[0]!.personalRepresentative = false;
    c.relatives.push({ id: "atty", name: "J. Smith, Esq.", relationship: "other", verified: true, personalRepresentative: true, authorityEvidenceHash: "sha256:l" });
    c.consents.push({ relativeId: "atty", decision: "refuse", modalities: [], signedAt: "2026-01-03" });
    expect(evaluateConsent(c).state).toBe("blocked");
  });

  it("the person's own directive replaces the estate requirement", () => {
    const c = na();
    c.relatives[0]!.personalRepresentative = false;
    c.consents[0]!.biometricRelease = false;
    c.directive = { decision: "grant", modalities: ["text", "voice"], allowedUsers: [], recordedAt: "2024-05-01" };
    const s = evaluateConsent(c);
    expect(s.state === "active" && s.modalities).toEqual(["text", "voice"]);
  });

  it("domestic partners are first tier", () => {
    const c = na();
    c.relatives.push({ id: "p", name: "Sam", relationship: "partner", verified: true });
    expect(evaluateConsent(c).state).toBe("pending");
  });
});
