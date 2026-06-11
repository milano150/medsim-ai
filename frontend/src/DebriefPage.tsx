// DebriefPage.tsx — FR-04
// Full-page post-session debrief. Rendered instead of the sim layout after
// diagnosis submission and debrief data is returned.

import { useEffect, useState } from "react";
import type { DebriefPayload, DebriefResult, DiagnosisResult, DiagnosisForm } from "./types";

type Props = {
  caseId: string;
  patient: any;
  selectedSpecialty: string;
  timerSeconds: number;
  formatTime: (s: number) => string;
  diagnosisForm: DiagnosisForm;
  diagnosisResult: DiagnosisResult;
  debriefPayload: DebriefPayload;
  onNewSimulation: () => void;
};

const BASE = "http://127.0.0.1:8000";

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Partial";
  if (score >= 25) return "Poor";
  return "Needs Work";
}

function diffResultBadge(result?: "accepted" | "partial" | "incorrect") {
  if (!result) return null;
  const cfg = {
    accepted: { label: "Accepted", cls: "badge-success" },
    partial: { label: "Partial", cls: "badge-warning" },
    incorrect: { label: "Incorrect", cls: "badge-danger" },
  }[result];
  return <span className={`debrief-badge ${cfg.cls}`}>{cfg.label}</span>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreRing({ score, label }: { score: number; label: string }) {
  const circ = 213.6;
  const dash = (score / 100) * circ;
  return (
    <div className="db-ring-wrap">
      <svg viewBox="0 0 80 80" className="db-ring">
        <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="8" />
        <circle
          cx="40" cy="40" r="34" fill="none"
          stroke={scoreColor(score)} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 40 40)"
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
      </svg>
      <div className="db-ring-text">
        <span className="db-ring-score" style={{ color: scoreColor(score) }}>{score}</span>
        <span className="db-ring-denom">/100</span>
      </div>
    </div>
  );
}

function CompetencyBar({ label, score, feedback }: { label: string; score: number; feedback: string }) {
  return (
    <div className="db-comp-row">
      <div className="db-comp-header">
        <span className="db-comp-label">{label}</span>
        <span className="db-comp-pct" style={{ color: scoreColor(score) }}>{score}%</span>
      </div>
      <div className="db-progress-track">
        <div
          className="db-progress-fill"
          style={{
            width: `${score}%`,
            background: scoreColor(score),
            transition: "width 1s ease",
          }}
        />
      </div>
      {feedback && <p className="db-comp-feedback">{feedback}</p>}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="db-section">
      <div className="db-section-title">
        <span className="db-section-icon">{icon}</span>
        {title}
      </div>
      <div className="db-section-body">{children}</div>
    </div>
  );
}

function ListItems({ items, empty, variant = "neutral" }: {
  items: string[];
  empty: string;
  variant?: "success" | "danger" | "neutral";
}) {
  if (!items || items.length === 0) {
    return <p className="db-empty">{empty}</p>;
  }
  return (
    <ul className={`db-list db-list-${variant}`}>
      {items.map((item, i) => (
        <li key={i} className="db-list-item">{item}</li>
      ))}
    </ul>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DebriefPage({
  caseId,
  patient,
  selectedSpecialty,
  timerSeconds,
  formatTime,
  diagnosisForm,
  diagnosisResult,
  debriefPayload,
  onNewSimulation,
}: Props) {
  const [debrief, setDebrief] = useState<DebriefResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/debrief/${caseId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(debriefPayload),
        });
        if (!res.ok) throw new Error(`Debrief request failed: ${res.status}`);
        setDebrief(await res.json());
      } catch (err: any) {
        setError(err.message || "Failed to load debrief.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="debrief-loading">
        <div className="debrief-loading-inner">
          <span className="spinner lg" />
          <p>Generating your debrief…</p>
          <span className="debrief-loading-sub">Analysing transcript and scoring competencies</span>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error || !debrief) {
    return (
      <div className="debrief-error">
        <p>⚠ Could not load debrief: {error}</p>
        <button className="btn-primary" onClick={onNewSimulation}>Start New Simulation</button>
      </div>
    );
  }

  const overall = debrief.overall_score;

  return (
    <div className="debrief-root">
      {/* ── Header ── */}
      <div className="debrief-header">
        <div className="debrief-header-left">
          <span className="debrief-eyebrow">Session Complete · {selectedSpecialty}</span>
          <h1 className="debrief-title">Post-Session Debrief</h1>
          <div className="debrief-meta">
            <span className="pill">{patient?.name}</span>
            <span className="pill">{patient?.age} yrs · {patient?.sex}</span>
            <span className="pill">⏱ {formatTime(timerSeconds)}</span>
          </div>
        </div>
        <div className="debrief-header-right">
          <ScoreRing score={overall} label="Overall" />
          <div className="debrief-overall-label" style={{ color: scoreColor(overall) }}>
            {scoreLabel(overall)}
          </div>
          <button className="btn-new-sim" onClick={onNewSimulation} style={{ marginTop: 12 }}>
            ← New Simulation
          </button>
        </div>
      </div>

      <div className="debrief-grid">
        {/* ── Left column ── */}
        <div className="debrief-col">

          {/* FR-04 § Final Diagnosis */}
          <Section title="Final Diagnosis" icon="🩺">
            <div className="db-diagnosis-compare">
              <div className="db-diag-row">
                <span className="db-diag-label">Your answer</span>
                <span className="db-diag-value">{debrief.primary_diagnosis}</span>
                <span
                  className={`debrief-badge ${diagnosisResult.score >= 70 ? "badge-success" : diagnosisResult.score >= 50 ? "badge-warning" : "badge-danger"}`}
                >
                  {scoreLabel(diagnosisResult.score)}
                </span>
              </div>
              <div className="db-diag-row db-diag-correct">
                <span className="db-diag-label">Correct diagnosis</span>
                <span className="db-diag-value">{debrief.correct_diagnosis}</span>
              </div>
            </div>
            <p className="db-feedback-text">{diagnosisResult.feedback}</p>
          </Section>

          {/* FR-04 § Differential Review */}
          <Section title="Differential Review" icon="🔀">
            {/* Student's submissions */}
            {[
              { label: "Differential #1", value: debrief.differential_1, result: diagnosisResult.differential_1_result, feedback: diagnosisResult.differential_1_feedback },
              { label: "Differential #2", value: debrief.differential_2, result: diagnosisResult.differential_2_result, feedback: diagnosisResult.differential_2_feedback },
            ].map(({ label, value, result, feedback }) => (
              <div key={label} className="db-diff-row">
                <div className="db-diff-header">
                  <span className="db-diff-label">{label}</span>
                  {value ? diffResultBadge(result) : <span className="debrief-badge badge-neutral">Not provided</span>}
                </div>
                {value && <span className="db-diff-value">{value}</span>}
                {feedback && <p className="db-comp-feedback">{feedback}</p>}
              </div>
            ))}
            <div className="db-divider" />
            <div className="db-diff-label" style={{ marginBottom: 6 }}>Accepted differentials for this case</div>
            <ListItems items={debrief.acceptable_differentials} empty="None specified." variant="neutral" />
          </Section>

          {/* FR-04 § Management Review */}
          <Section title="Management Review" icon="💊">
            <div className="db-management-plan">
              <span className="db-diag-label">Your plan</span>
              <p className="db-management-text">
                {debrief.management_plan || <em>Not provided</em>}
              </p>
            </div>
            <p className="db-feedback-text">{debrief.management_feedback}</p>
            <div className="db-two-col">
              <div>
                <div className="db-diff-label" style={{ marginBottom: 6 }}>✓ Actions covered</div>
                <ListItems
                  items={diagnosisResult.management_matched || []}
                  empty="None matched."
                  variant="success"
                />
              </div>
              <div>
                <div className="db-diff-label" style={{ marginBottom: 6 }}>✗ Critical actions missed</div>
                <ListItems
                  items={diagnosisResult.management_missed || debrief.expected_management.filter(
                    a => !(diagnosisResult.management_matched || []).some(
                      m => m.toLowerCase().includes(a.toLowerCase().slice(0, 8))
                    )
                  )}
                  empty="None missed — well done!"
                  variant="danger"
                />
              </div>
            </div>
          </Section>
        </div>

        {/* ── Right column ── */}
        <div className="debrief-col">

          {/* FR-04 § Competency Scores */}
          <Section title="Competency Scores" icon="📊">
            <div className="db-overall-row">
              <span className="db-comp-label">Overall score</span>
              <span className="db-overall-score" style={{ color: scoreColor(overall) }}>
                {overall}<span className="db-ring-denom">/100</span>
              </span>
            </div>
            <div className="db-comp-list">
              <CompetencyBar label="History Taking" score={debrief.history_score} feedback={debrief.history_feedback} />
              <CompetencyBar label="Investigation Selection" score={debrief.investigation_score} feedback="" />
              <CompetencyBar label="Clinical Reasoning" score={debrief.reasoning_score} feedback={debrief.reasoning_feedback} />
              <CompetencyBar label="Management" score={debrief.management_score} feedback="" />
            </div>
          </Section>

          {/* FR-04 § Investigation Review */}
          <Section title="Investigation Review" icon="🔬">
            <div className="db-inv-stats">
              <div className="db-inv-stat">
                <span className="db-inv-stat-num">{debrief.ordered_investigations.length}</span>
                <span className="db-inv-stat-label">Total ordered</span>
              </div>
              <div className="db-inv-stat">
                <span className="db-inv-stat-num" style={{ color: "#22c55e" }}>{debrief.important_ordered.length}</span>
                <span className="db-inv-stat-label">Key tests ordered</span>
              </div>
              <div className="db-inv-stat">
                <span className="db-inv-stat-num" style={{ color: debrief.important_missed.length > 0 ? "#ef4444" : "#22c55e" }}>
                  {debrief.important_missed.length}
                </span>
                <span className="db-inv-stat-label">Key tests missed</span>
              </div>
            </div>
            <div className="db-inv-score-bar">
              <CompetencyBar
                label="Investigation score"
                score={debrief.investigation_score}
                feedback=""
              />
            </div>
            {debrief.important_missed.length > 0 && (
              <>
                <div className="db-diff-label" style={{ margin: "10px 0 6px" }}>Missed important tests</div>
                <ListItems items={debrief.important_missed} empty="" variant="danger" />
              </>
            )}
          </Section>

          {/* FR-04 § Annotated Session Review */}
          <Section title="Session Review" icon="📋">
            <div className="db-review-grid">
              <div className="db-review-col">
                <div className="db-review-heading db-review-success">✓ Strong questions asked</div>
                <ListItems
                  items={debrief.good_questions}
                  empty="No standout questions identified."
                  variant="success"
                />
              </div>
              <div className="db-review-col">
                <div className="db-review-heading db-review-danger">✗ Questions not asked</div>
                <ListItems
                  items={debrief.missed_questions}
                  empty="No critical questions missed."
                  variant="danger"
                />
              </div>
              <div className="db-review-col">
                <div className="db-review-heading db-review-success">✓ Key findings discovered</div>
                <ListItems
                  items={debrief.key_findings_discovered}
                  empty="No key findings noted."
                  variant="success"
                />
              </div>
              <div className="db-review-col">
                <div className="db-review-heading db-review-danger">✗ Key findings missed</div>
                <ListItems
                  items={debrief.key_findings_missed}
                  empty="No major findings missed."
                  variant="danger"
                />
              </div>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}