"use client";
import { useState } from "react";
import { askAssistant, type AssistantResult } from "./actions";

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
        <pre style={{ whiteSpace: "pre-wrap", marginTop: "1rem", background: "#f5f5f5", padding: "1rem" }}>
          {result.narrative}
        </pre>
      )}
    </div>
  );
}
