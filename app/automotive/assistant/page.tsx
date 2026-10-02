// Track B -- internal, admin-only, read-only diagnostic prototype.
// Not linked from public navigation; proves the retrieval -> evidence ->
// safety -> grounded-response flow against real (or not-yet-applied) data.
import { requireRole } from "@/lib/auth-server";
import { AssistantForm } from "./AssistantForm";

export default async function AutomotiveAssistantPage() {
  await requireRole("admin");
  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Automotive Assistant (internal prototype)</h1>
      <p style={{ color: "#666" }}>
        Read-only diagnostic prototype. Answers are grounded in published knowledge entries only and cite their
        source IDs; no step-by-step action text is shown for safety-critical systems.
      </p>
      <AssistantForm />
    </main>
  );
}
