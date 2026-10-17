import { ALL_MODALITIES, type Modality } from "./types";

/**
 * Consent model.
 *
 * Precedence, strongest first:
 *  1. The person's own wishes recorded while alive (advance directive). A refusal
 *     blocks everything, permanently; a grant defines the outer limit of what any
 *     relative can allow.
 *  2. First-tier family (spouse/domestic partner, children, parents). Every
 *     declared first-tier relative must consent; one objection blocks.
 *  3. Only when there is no first-tier relative do second-tier relatives
 *     (siblings, grandparents, grandchildren) decide, with the same unanimity rule.
 *
 * Jurisdiction adds rules on top:
 *  - US / CA (North America): post-mortem rights in a person's voice and likeness
 *    belong to the estate or heirs (Cal. Civ. Code §3344.1, N.Y. Civ. Rights Law
 *    §50-f, Tennessee ELVIS Act…). Unless the person left their own directive,
 *    a verified personal representative of the estate (executor/administrator)
 *    must also grant. Voice and face models are biometric identifiers under
 *    biometric-privacy laws (Illinois BIPA, Texas CUBI, Washington); they are
 *    only enabled when the personal representative signs a written biometric
 *    release. Without one, the simulation is text-only.
 *  - CN: tier order follows 《民法典》第994条; no estate requirement.
 *
 * Revocation by anyone whose consent was needed turns the persona off and
 * creates a deletion obligation for every derived model (voice, face, LoRA…).
 */

export type Jurisdiction = "US" | "CA" | "CN";

export type Relationship =
  | "spouse"
  | "partner"
  | "child"
  | "parent"
  | "sibling"
  | "grandparent"
  | "grandchild"
  | "other";

const FIRST_TIER: ReadonlySet<Relationship> = new Set(["spouse", "partner", "child", "parent"]);
const SECOND_TIER: ReadonlySet<Relationship> = new Set(["sibling", "grandparent", "grandchild"]);
const BIOMETRIC: readonly Modality[] = ["voice", "image", "video"];

export interface Relative {
  id: string;
  name: string;
  relationship: Relationship;
  /** Identity checked against an ID document or by an existing verified member. */
  verified: boolean;
  /**
   * Executor / administrator of the estate. May also be a relative; may be a
   * non-relative (e.g. an attorney) with relationship "other".
   */
  personalRepresentative?: boolean;
  /** Hash of letters testamentary / letters of administration / small-estate affidavit. */
  authorityEvidenceHash?: string;
}

export type ConsentDecision = "grant" | "refuse";

export interface KinConsent {
  relativeId: string;
  decision: ConsentDecision;
  modalities: Modality[];
  /** ISO-8601. */
  signedAt: string;
  /** Set when the relative later withdraws. Withdrawal is final for that record. */
  revokedAt?: string;
  /**
   * Written release for creating voice/face models (BIPA-style: purpose,
   * retention until revocation, on-device only). Only meaningful from a
   * personal representative.
   */
  biometricRelease?: boolean;
}

export interface AdvanceDirective {
  decision: ConsentDecision;
  modalities: Modality[];
  /** Relative ids allowed to talk to the simulation. Empty = any consenting relative. */
  allowedUsers: string[];
  recordedAt: string;
  /** e.g. a signed in-app recording, notarised letter. Stored as a hash. */
  evidenceHash?: string;
}

export interface ConsentCase {
  /** Defaults to "US". */
  jurisdiction?: Jurisdiction;
  deceasedName: string;
  /** Hash of the death certificate or equivalent; required before anything is built. */
  deathEvidenceHash?: string;
  /** The applicant attests this list contains every living relative of the decisive tier. */
  kinListAttested: boolean;
  relatives: Relative[];
  consents: KinConsent[];
  directive?: AdvanceDirective;
}

/** Machine-readable reason; `describeReason` renders it for the UI. */
export type ReasonCode =
  | "directive-refused"
  | "revoked"
  | "refused"
  | "no-death-evidence"
  | "kin-list-not-attested"
  | "no-decision-maker"
  | "not-verified"
  | "awaiting-signature"
  | "no-personal-representative"
  | "pr-authority-missing"
  | "no-common-scope"
  | "biometric-release-missing"
  | "not-authorized-user";

export interface Reason {
  code: ReasonCode;
  name?: string;
}

export type ConsentStatus =
  | { state: "active"; modalities: Modality[]; allowedUsers: string[] | "all-consenting"; notes: Reason[] }
  | { state: "pending"; reasons: Reason[] }
  | { state: "blocked"; reasons: Reason[] }
  | { state: "revoked"; reasons: Reason[]; mustDelete: Modality[] };

function intersect(a: readonly Modality[], b: readonly Modality[]): Modality[] {
  return a.filter((m) => b.includes(m));
}

export function jurisdictionOf(c: ConsentCase): Jurisdiction {
  return c.jurisdiction ?? "US";
}

const isNorthAmerica = (c: ConsentCase) => jurisdictionOf(c) !== "CN";

/** Relatives whose consent is required, per the tier rule above. */
export function decisiveRelatives(c: ConsentCase): Relative[] {
  const first = c.relatives.filter((r) => FIRST_TIER.has(r.relationship));
  if (first.length > 0) return first;
  return c.relatives.filter((r) => SECOND_TIER.has(r.relationship));
}

/** Everyone whose signature is required: decisive family plus, in North America, the estate's representative(s). */
export function requiredSigners(c: ConsentCase): Relative[] {
  const out = new Map(decisiveRelatives(c).map((r) => [r.id, r]));
  if (isNorthAmerica(c) && !c.directive) {
    for (const r of c.relatives) if (r.personalRepresentative) out.set(r.id, r);
  }
  return [...out.values()];
}

function latestConsent(c: ConsentCase, relativeId: string): KinConsent | undefined {
  let latest: KinConsent | undefined;
  for (const k of c.consents) {
    if (k.relativeId !== relativeId) continue;
    if (!latest || k.signedAt > latest.signedAt) latest = k;
  }
  return latest;
}

export function evaluateConsent(c: ConsentCase): ConsentStatus {
  if (c.directive?.decision === "refuse") {
    return { state: "blocked", reasons: [{ code: "directive-refused", name: c.deceasedName }] };
  }

  const required = requiredSigners(c);

  // Revocation by a required signer is checked first: it overrides everything
  // else and must trigger deletion even if other paperwork is incomplete.
  const revokers = required.filter((r) => latestConsent(c, r.id)?.revokedAt);
  if (revokers.length > 0) {
    return {
      state: "revoked",
      reasons: revokers.map((r) => ({ code: "revoked", name: r.name })),
      mustDelete: [...ALL_MODALITIES],
    };
  }

  const refusers = required.filter((r) => latestConsent(c, r.id)?.decision === "refuse");
  if (refusers.length > 0) {
    return { state: "blocked", reasons: refusers.map((r) => ({ code: "refused", name: r.name })) };
  }

  const pending: Reason[] = [];
  if (!c.deathEvidenceHash) pending.push({ code: "no-death-evidence" });
  if (!c.kinListAttested) pending.push({ code: "kin-list-not-attested" });

  if (decisiveRelatives(c).length === 0 && !c.directive) pending.push({ code: "no-decision-maker" });

  const reps = c.relatives.filter((r) => r.personalRepresentative);
  if (isNorthAmerica(c) && !c.directive) {
    if (reps.length === 0) pending.push({ code: "no-personal-representative" });
    for (const r of reps) if (!r.authorityEvidenceHash) pending.push({ code: "pr-authority-missing", name: r.name });
  }

  let modalities: Modality[] = c.directive ? [...c.directive.modalities] : [...ALL_MODALITIES];
  for (const r of required) {
    if (!r.verified) pending.push({ code: "not-verified", name: r.name });
    const k = latestConsent(c, r.id);
    if (!k) {
      pending.push({ code: "awaiting-signature", name: r.name });
      continue;
    }
    modalities = intersect(modalities, k.modalities);
  }

  if (pending.length > 0) return { state: "pending", reasons: pending };
  if (!modalities.includes("text")) return { state: "blocked", reasons: [{ code: "no-common-scope" }] };

  // Biometric models need a written release from the estate (or the person's own directive).
  const notes: Reason[] = [];
  if (isNorthAmerica(c) && !c.directive) {
    const released = reps.some((r) => {
      const k = latestConsent(c, r.id);
      return k?.decision === "grant" && !k.revokedAt && k.biometricRelease;
    });
    if (!released && modalities.some((m) => BIOMETRIC.includes(m))) {
      modalities = modalities.filter((m) => !BIOMETRIC.includes(m));
      notes.push({ code: "biometric-release-missing" });
    }
  }

  const allowedUsers =
    c.directive && c.directive.allowedUsers.length > 0 ? [...c.directive.allowedUsers] : "all-consenting";
  return { state: "active", modalities, allowedUsers, notes };
}

/** Whether a given relative may open a chat, and with which modalities. */
export function accessFor(c: ConsentCase, relativeId: string): Modality[] {
  const s = evaluateConsent(c);
  if (s.state !== "active") return [];
  if (s.allowedUsers === "all-consenting") {
    const k = latestConsent(c, relativeId);
    // A non-decisive relative (e.g. a cousin) still needs their own grant on file.
    if (!k || k.decision !== "grant" || k.revokedAt) return [];
    return s.modalities;
  }
  return s.allowedUsers.includes(relativeId) ? s.modalities : [];
}

const REASONS: Record<"en" | "zh", Record<ReasonCode, (n: string) => string>> = {
  en: {
    "directive-refused": (n) => `${n} said, while alive, that they did not want to be simulated.`,
    revoked: (n) => `${n} withdrew consent.`,
    refused: (n) => `${n} declined.`,
    "no-death-evidence": () => "Death certificate not yet provided.",
    "kin-list-not-attested": () => "The family list has not been confirmed as complete.",
    "no-decision-maker": () => "No close family member and no directive from the person.",
    "not-verified": (n) => `${n}'s identity has not been verified.`,
    "awaiting-signature": (n) => `Waiting for ${n} to sign.`,
    "no-personal-representative": () => "Add the estate's executor or administrator.",
    "pr-authority-missing": (n) => `Upload ${n}'s letters testamentary / administration.`,
    "no-common-scope": () => "What family members agreed to doesn't overlap (text chat must be allowed by everyone).",
    "biometric-release-missing": () => "Voice and photos stay off until the executor signs the biometric release.",
    "not-authorized-user": () => "You haven't signed consent yourself, so you can't open this conversation.",
  },
  zh: {
    "directive-refused": (n) => `${n} 生前明确拒绝被数字化模拟。`,
    revoked: (n) => `${n} 已撤回同意。`,
    refused: (n) => `${n} 不同意。`,
    "no-death-evidence": () => "尚未上传死亡证明。",
    "kin-list-not-attested": () => "申请人尚未声明近亲属名单完整。",
    "no-decision-maker": () => "没有可作出决定的近亲属，也没有本人生前授权。",
    "not-verified": (n) => `${n} 的身份尚未核验。`,
    "awaiting-signature": (n) => `等待 ${n} 签署同意书。`,
    "no-personal-representative": () => "请添加遗产执行人或管理人。",
    "pr-authority-missing": (n) => `请上传 ${n} 的遗嘱执行/遗产管理授权文件。`,
    "no-common-scope": () => "各方同意的范围没有交集（至少需要所有人都允许文字对话）。",
    "biometric-release-missing": () => "遗产执行人签署生物特征授权前，声音和照片功能保持关闭。",
    "not-authorized-user": () => "你本人尚未签署同意书，不能开启对话。",
  },
};

export function describeReason(r: Reason, lang: "en" | "zh"): string {
  return REASONS[lang][r.code](r.name ?? "");
}
