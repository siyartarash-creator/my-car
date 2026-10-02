// Track B -- LLM integration boundary. No paid external LLM is wired up (the
// $0 external-spend gate); this interface lets the deterministic contract's
// output be turned into prose later (local-compatible model, e.g. the
// Qwen2.5-Coder local worker, or a paid API once authorized) without
// changing runDiagnosticQuery itself. The mock provider only narrates what
// is already in the DiagnosticResponse -- it never adds unsupported claims.
import type { DiagnosticQuery, DiagnosticResponse } from "./types";

export interface DiagnosticNarrationProvider {
  narrate(response: DiagnosticResponse, query: DiagnosticQuery): Promise<string>;
}

export const mockNarrationProvider: DiagnosticNarrationProvider = {
  async narrate(response, query) {
    if (response.status === "insufficient_data") {
      return `I don't have enough grounded knowledge to answer "${query.question}" yet. ${response.notes.join(" ")}`;
    }
    const lines: string[] = [];
    for (const f of response.findings) {
      lines.push(
        `- [${f.entryId}] (${f.sourceType}, confidence: ${f.confidence}, risk: ${f.riskLevel}) ${f.symptom} -> possible cause: ${f.possibleCause}` +
          (f.nextDiagnosticStep ? ` | next check: ${f.nextDiagnosticStep}` : "") +
          (f.actionGuidance ? ` | action: ${f.actionGuidance}` : ""),
      );
    }
    if (response.status === "clarification_needed") {
      lines.push("", "Before narrowing further:", ...response.clarifyingQuestions.map((q) => `- ${q}`));
    }
    if (response.notes.length) lines.push("", ...response.notes);
    return lines.join("\n");
  },
};
