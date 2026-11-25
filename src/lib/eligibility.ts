import type { Eligibility, EligibilityOutcome, MappingStatus, Parameter, QuantClaim } from "./types";

export const isLive = (p: Parameter) =>
  p.authorDecision?.action !== "exclude" && !!p.selectedIndicatorId &&
  (p.status === "verified" || (p.status === "review" && p.authorDecision?.action === "approve"));

/** Contextual items are shown beside the text as separate observations, never as updates. */
export const isContextual = (p: Parameter) => p.authorDecision?.action !== "exclude" && p.status === "contextual" && !!p.selectedIndicatorId;

export const STRONG_RULE = { minLive: 2, minShare: 0.6 };

export const OUTCOME_LABEL: Record<EligibilityOutcome, string> = {
  strong: "Eligible — strong match",
  partial: "Eligible — partial match",
  contextual: "Contextual update only",
  not_eligible: "Not eligible",
};

export function assess(parameters: Parameter[], claims: QuantClaim[]): Eligibility {
  const by = (s: MappingStatus) => parameters.filter((p) => p.status === s).length;
  const live = parameters.filter(isLive).length;
  const contextual = parameters.filter(isContextual).length;
  const pending = parameters.filter((p) => p.status === "review" && !p.authorDecision && p.candidates.some((c) => c.status === "review" || c.status === "verified")).length;
  const measured = parameters.length;
  const share = measured ? live / measured : 0;
  const reasons: string[] = [];
  let outcome: EligibilityOutcome;

  if (live >= STRONG_RULE.minLive && share >= STRONG_RULE.minShare) {
    outcome = "strong";
    reasons.push(`${live} of ${measured} measured claims have a verified, compatible source (strong match requires at least ${STRONG_RULE.minLive} and ${STRONG_RULE.minShare * 100}%).`);
  } else if (live >= 1) {
    outcome = "partial";
    reasons.push(`${live} of ${measured} measured claims can be refreshed. The rest remain exactly as published and are marked as static.`);
  } else if (contextual + pending > 0) {
    outcome = "contextual";
    reasons.push("No claim can be refreshed as a like-for-like update. Related observations can be shown only as separate context.");
    if (pending) reasons.push(`${pending} flagged mapping(s) are unresolved; reviewing them may change this result.`);
  } else {
    outcome = "not_eligible";
    if (!claims.length) reasons.push("No numeric content was found in the body of the document.");
    else if (!measured) reasons.push("The numbers found are years, references, sample descriptions, forecasts, constants or the study's own analytical results. None is a repeatable external measurement.");
    else reasons.push("None of the measured claims has a source with a compatible concept, unit and geography in the configured catalogue.");
  }
  if (by("unsupported")) reasons.push(`${by("unsupported")} claim(s) have no supported source.`);
  if (by("rejected")) reasons.push(`${by("rejected")} candidate mapping(s) were rejected as incompatible.`);

  return {
    outcome,
    label: OUTCOME_LABEL[outcome],
    reasons,
    counts: {
      verified: by("verified"), review: by("review"), contextual: by("contextual"), unsupported: by("unsupported"), rejected: by("rejected"),
      live, measuredClaims: measured, allNumbers: claims.length,
    },
    limitations: [
      "This decision measures technical data suitability only. It says nothing about the quality, truth or merit of the research.",
      "Only concepts in the curated catalogue can be matched; a provider may hold relevant data outside it.",
      "Numbers inside tables, figures and equations are not extracted.",
      "All configured statistical sources are annual. Nothing here is real-time.",
    ],
  };
}
