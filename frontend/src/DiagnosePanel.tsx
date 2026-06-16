// DiagnosePanel.tsx — FR-03
// Replaces the single diagnosis textarea with a 4-field structured submission form.
// Drop-in replacement for the old "Diagnosis" section of the sidebar.

import { useState } from "react";
import type { DiagnosisForm, DiagnosisResult } from "./types";

type Props = {
  caseId: string;
  sessionId: string;
  timerSeconds: number;
  formatTime: (s: number) => string;
  onSubmitted: (form: DiagnosisForm, result: DiagnosisResult) => void;
  onTimerStop: () => void;
};

const BASE = "http://127.0.0.1:8000";

export function DiagnosePanel({
  caseId,
  sessionId,
  timerSeconds,
  formatTime,
  onSubmitted,
  onTimerStop,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<DiagnosisForm>>({});

  const [form, setForm] = useState<DiagnosisForm>({
    primaryDiagnosis: "",
    differential1: "",
    differential2: "",
    managementPlan: "",
  });

  const set = (field: keyof DiagnosisForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const errs: Partial<DiagnosisForm> = {};
    if (!form.primaryDiagnosis.trim()) errs.primaryDiagnosis = "Required";
    if (!form.managementPlan.trim()) errs.managementPlan = "Required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    onTimerStop();

    try {
      const res = await fetch(`${BASE}/diagnose/${caseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          diagnosis: form.primaryDiagnosis.trim(),
          time_taken: formatTime(timerSeconds),
          differential_1: form.differential1.trim() || undefined,
          differential_2: form.differential2.trim() || undefined,
          management_plan: form.managementPlan.trim(),
        }),
      });
      if (!res.ok) throw new Error("Scoring request failed");
      const result: DiagnosisResult = await res.json();
      onSubmitted(form, result);
    } catch (err) {
      console.error("DiagnosePanel error:", err);
      onSubmitted(form, {
        score: 0,
        feedback: "Could not evaluate diagnosis. Please check your connection.",
        patientReaction: "I… I'm not sure what's happening, doctor.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="diagnose-panel">
      {!open ? (
        <button className="btn-diagnose" onClick={() => setOpen(true)}>
          🩺 Submit Diagnosis
        </button>
      ) : (
        <div className="diagnose-form">
          {/* Primary diagnosis */}
          <div className="dform-field">
            <label className="dform-label">
              Primary Diagnosis <span className="dform-required">*</span>
            </label>
            <input
              className={`dform-input ${errors.primaryDiagnosis ? "dform-error" : ""}`}
              value={form.primaryDiagnosis}
              onChange={set("primaryDiagnosis")}
              placeholder="e.g. Acute STEMI"
              disabled={loading}
            />
            {errors.primaryDiagnosis && (
              <span className="dform-error-msg">{errors.primaryDiagnosis}</span>
            )}
          </div>

          {/* Differential 1 */}
          <div className="dform-field">
            <label className="dform-label">Differential Diagnosis #1</label>
            <input
              className="dform-input"
              value={form.differential1}
              onChange={set("differential1")}
              placeholder="e.g. Unstable angina"
              disabled={loading}
            />
          </div>

          {/* Differential 2 */}
          <div className="dform-field">
            <label className="dform-label">Differential Diagnosis #2</label>
            <input
              className="dform-input"
              value={form.differential2}
              onChange={set("differential2")}
              placeholder="e.g. Aortic dissection"
              disabled={loading}
            />
          </div>

          {/* Management plan */}
          <div className="dform-field">
            <label className="dform-label">
              Management Plan <span className="dform-required">*</span>
            </label>
            <textarea
              className={`dform-textarea ${errors.managementPlan ? "dform-error" : ""}`}
              value={form.managementPlan}
              onChange={set("managementPlan")}
              placeholder="e.g. Aspirin 300mg, urgent PCI, IV access, morphine…"
              rows={3}
              disabled={loading}
            />
            {errors.managementPlan && (
              <span className="dform-error-msg">{errors.managementPlan}</span>
            )}
          </div>

          <div className="dform-actions">
            <button
              className="btn-ghost dform-cancel"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className={`btn-primary ${loading ? "loading" : ""}`}
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <><span className="spinner" /> Scoring…</>
              ) : (
                "Submit & Score →"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}