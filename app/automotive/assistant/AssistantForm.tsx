"use client";
import { useState } from "react";
import { askAssistant, type AssistantResult } from "./actions";

const CLAIM_LABEL: Record<string, string> = {
  FACT: "Retrieved fact",
  OBSERVATION: "Observation",
  HYPOTHESIS: "Hypothesis",
  RECOMMENDED_NEXT_CHECK: "Recommended next check",
  SAFETY_NOTICE: "Safety notice",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
};

export function AssistantForm() {
  const [question, setQuestion] = useState("");
  const [allowActionGuidance, setAllowActionGuidance] = useState(false);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      setResult(await askAssistant(question, allowActionGuidance));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <form onSubmit={onSubmit}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Describe the symptom, e.g. 'engine cranks but does not start'"
          rows={3}
          style={{ width: "100%" }}
        />
        <label style={{ display: "block", margin: "0.5rem 0" }}>
          <input
            type="checkbox"
            checked={allowActionGuidance}
            onChange={(e) => setAllowActionGuidance(e.target.checked)}
          />{" "}
          I want step-by-step action guidance where the risk level allows it
        </label>
        <button type="submit" disabled={pending || !question.trim()}>
          {pending ? "Thinking..." : "Ask"}
        </button>
      </form>
      {result && (
        <div style={{ marginTop: "1rem" }}>
          <p>
            <strong>Status:</strong> {result.status}
            {result.status === "insufficient_data" && " -- no fabricated cause; insufficient grounded evidence."}
          </p>

          <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: "1rem" }}>{result.narrative}</pre>

          {result.clarifyingQuestions.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <strong>Clarifying / next-check questions:</strong>
              <ul>
                {result.clarifyingQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {result.claims.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <strong>Structured claims (evidence-traced):</strong>
              <ul>
                {result.claims.map((c, i) => (
                  <li key={i}>
                    <strong>[{CLAIM_LABEL[c.type] ?? c.type}]</strong> {c.text}
                    {c.evidenceIds.length > 0 && (
                      <span style={{ color: "#666" }}> (evidence: {c.evidenceIds.join(", ")})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.evidence.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <strong>Evidence used:</strong>
              <ul>
                {result.evidence.map((e) => (
                  <li key={e.id}>
                    <code>{e.id}</code> -- {e.type}
                    {e.provenance && ` (provenance: ${e.provenance})`}
                    {e.confidence && `, confidence: ${e.confidence}`}: {e.content}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
