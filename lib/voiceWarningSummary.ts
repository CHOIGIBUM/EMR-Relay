import type { VoiceProposalWarning } from "@/lib/emsApiTypes";

export type ActionableVoiceWarningSummary = {
  count: number;
  messages: string[];
};

/**
 * Builds a field-oriented, user-facing warning summary. Informational runtime
 * notices stay out of the clinical review UI, and repeated warnings for the
 * same field/code do not inflate the count.
 */
export function summarizeActionableVoiceWarnings(
  warnings: readonly VoiceProposalWarning[],
): ActionableVoiceWarningSummary {
  const targets = new Set<string>();
  const messages: string[] = [];
  const seenMessages = new Set<string>();

  for (const warning of warnings) {
    if (warning.severity === "info") continue;
    const warningTargets = warning.field_paths.length
      ? warning.field_paths.map((fieldPath) => `field:${fieldPath}`)
      : [`code:${warning.code}`];
    const addsTarget = warningTargets.some((target) => !targets.has(target));
    for (const target of warningTargets) targets.add(target);
    if (addsTarget && !seenMessages.has(warning.message)) {
      seenMessages.add(warning.message);
      messages.push(warning.message);
    }
  }

  return { count: targets.size, messages };
}
