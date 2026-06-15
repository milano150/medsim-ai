// App.tsx — MedSim AI
// Integrates FR-03 (DiagnosePanel) and FR-04 (DebriefPage).
// View is controlled by `appView`: "landing" | "simulation" | "debrief"

import { useState, useRef, useEffect } from "react";
import type {
  Message,
  AppView,
  DiagnosisForm,
  DiagnosisResult,
  DebriefPayload,
} from "./types";
import { DiagnosePanel } from "./DiagnosePanel";
import { DebriefPage } from "./DebriefPage";

const VITALS_CONFIG: { key: string; label: string; icon: string }[] = [
  { key: "bp",   label: "Blood Pressure",   icon: "🩸" },
  { key: "hr",   label: "Heart Rate",       icon: "💓" },
  { key: "rr",   label: "Respiratory Rate", icon: "🌬" },
  { key: "spo2", label: "SpO₂",             icon: "🫁" },
  { key: "temp", label: "Temperature",      icon: "🌡" },
];

const BASE = "http://127.0.0.1:8000";

// Debug info shape returned from /start
type DebugInfo = {
  hidden_diagnosis: string;
  acceptable_differentials: string[];
  management_actions: string[];
};

function App() {
  // ── View state ──────────────────────────────────────────────────────────────
  const [appView, setAppView] = useState<AppView>("landing");

  // ── Simulation state ────────────────────────────────────────────────────────
  const [selectedSpecialty, setSelectedSpecialty]   = useState("");
  const [caseId, setCaseId]                         = useState("");
  const [sessionId, setSessionId]                   = useState("");
  const [patient, setPatient]                       = useState<any>(null);
  const [messages, setMessages]                     = useState<Message[]>([]);
  const [chatInput, setChatInput]                   = useState("");
  const [suggestions, setSuggestions]               = useState<string[]>([]);
  const [loading, setLoading]                       = useState(false);
  const [visibleVitals, setVisibleVitals]           = useState<string[]>([]);
  const [visibleInvestigations, setVisibleInvestigations] = useState<string[]>([]);

  // ── FR-03 state ─────────────────────────────────────────────────────────────
  const [diagnosisForm, setDiagnosisForm]       = useState<DiagnosisForm | null>(null);
  const [diagnosisResult, setDiagnosisResult]   = useState<DiagnosisResult | null>(null);

  // ── FR-04 state ─────────────────────────────────────────────────────────────
  const [debriefPayload, setDebriefPayload]     = useState<DebriefPayload | null>(null);

  // ── Debug panel state ───────────────────────────────────────────────────────
  const [debugInfo, setDebugInfo]   = useState<DebugInfo | null>(null);
  const [showDebug, setShowDebug]   = useState(false);

  // ── Timer ───────────────────────────────────────────────────────────────────
  const [timerSeconds, setTimerSeconds]   = useState(0);
  const [timerRunning, setTimerRunning]   = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chatEndRef   = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const specialties = ["Cardiology", "Pulmonology", "Neurology"];
  const specialtyIcons: Record<string, string> = {
    Cardiology: "♥",
    Pulmonology: "◎",
    Neurology:  "⊕",
  };

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (appView !== "simulation") return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, appView]);

  useEffect(() => {
    if (appView !== "simulation") return;
    if (!loading) chatInputRef.current?.focus();
  }, [messages, loading, appView]);

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setTimerSeconds((p) => p + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return "#22c55e";
    if (score >= 50) return "#f59e0b";
    return "#ef4444";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 90) return "Excellent";
    if (score >= 75) return "Good";
    if (score >= 50) return "Partial";
    if (score >= 25) return "Poor";
    return "Incorrect";
  };

  // ── Simulation start ─────────────────────────────────────────────────────────
  const startSimulation = async () => {
    setLoading(true);
    try {
      const caseRes  = await fetch(`${BASE}/specialty/${selectedSpecialty.toLowerCase()}`);
      const caseData = await caseRes.json();
      setCaseId(caseData.case_id);
      setPatient(caseData);

      const startRes  = await fetch(`${BASE}/start/${caseData.case_id}`, { method: "POST" });
      const startData = await startRes.json();
      setSessionId(startData.session_id);
      setDebugInfo({
        hidden_diagnosis: startData.hidden_diagnosis || "",
        acceptable_differentials: startData.acceptable_differentials || [],
        management_actions: startData.management_actions || [],
      });

      const llmRes  = await fetch(`${BASE}/llm/${caseData.case_id}`);
      const llmData = await llmRes.json();

      setMessages([{ role: "patient", text: llmData.patient_start_sentence }]);
      setSuggestions([]);
      setVisibleVitals([]);
      setVisibleInvestigations([]);
      setDiagnosisForm(null);
      setDiagnosisResult(null);
      setDebriefPayload(null);
      setShowDebug(false);
      setTimerSeconds(0);
      setTimerRunning(true);
      setAppView("simulation");
      setTimeout(() => chatInputRef.current?.focus(), 100);
    } catch (err) {
      console.error("startSimulation error:", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Chat ────────────────────────────────────────────────────────────────────
  const sendChat = async () => {
    const raw = chatInput.trim();
    if (!raw) return;
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", text: raw }]);
    setLoading(true);
    try {
      const res  = await fetch(`${BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, question: raw }),
      });
      if (!res.ok) throw new Error("Chat request failed");
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "patient", text: data.answer }]);
      setSuggestions(data.suggestions || []);
    } catch (err) {
      console.error("Chat error:", err);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const revealVital = (key: string) =>
    setVisibleVitals((prev) => prev.includes(key) ? prev : [...prev, key]);

  const revealInvestigation = (key: string) =>
    setVisibleInvestigations((prev) => prev.includes(key) ? prev : [...prev, key]);

  // ── FR-03: diagnosis submitted ───────────────────────────────────────────────
  // ── FR-03: diagnosis submitted ───────────────────────────────────────────────
  const handleDiagnosisSubmitted = (form: DiagnosisForm, result: DiagnosisResult) => {
    setDiagnosisForm(form);
    setDiagnosisResult(result);
    setTimerRunning(false);

    setMessages((prevMessages) => {
      const updatedMessages = prevMessages.concat([
        { role: "patient" as const, text: result.patientReaction },
      ]);

      const payload: DebriefPayload = {
        session_id: sessionId,
        time_taken: formatTime(timerSeconds),

        primary_diagnosis: form.primaryDiagnosis,
        differential_1: form.differential1 || undefined,
        differential_2: form.differential2 || undefined,
        management_plan: form.managementPlan || undefined,

        ordered_investigations: visibleInvestigations,

        transcript: updatedMessages,

        diagnosis_score: result.score,
        management_score: result.management_score ?? 0,
        management_matched: result.management_matched ?? [],
        management_missed: result.management_missed ?? [],
      };
      setDebriefPayload(payload);

      return updatedMessages;
    });

    setAppView("debrief");
  };

  // ── Reset ────────────────────────────────────────────────────────────────────
  const resetSimulation = () => {
    setSelectedSpecialty("");
    setPatient(null);
    setMessages([]);
    setChatInput("");
    setSuggestions([]);
    setVisibleVitals([]);
    setVisibleInvestigations([]);
    setDiagnosisForm(null);
    setDiagnosisResult(null);
    setDebriefPayload(null);
    setDebugInfo(null);
    setShowDebug(false);
    setTimerSeconds(0);
    setTimerRunning(false);
    setAppView("landing");
  };

  const availableInvestigations = patient?.investigations
    ? Object.keys(patient.investigations)
    : [];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="app-root">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-inner">
          <div className="logo-group">
            <span className="logo-icon">⚕</span>
            <span className="logo-text">MedSim <span className="logo-accent">AI</span></span>
          </div>
          {appView !== "landing" && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {debugInfo && (
                <button
                  className="btn-ghost"
                  onClick={() => setShowDebug((p) => !p)}
                  style={{ borderColor: "#a855f7", color: "#a855f7" }}
                >
                  temporary answer key😝
                </button>
              )}
              <div className={`timer-badge ${diagnosisResult ? "stopped" : "running"}`}>
                <span className="timer-icon">⏱</span>
                <span className="timer-value">{formatTime(timerSeconds)}</span>
              </div>
              <button className="btn-ghost" onClick={resetSimulation}>
                ← New Simulation
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Debug panel ── */}
      {showDebug && debugInfo && (
        <div
          style={{
            position: "fixed",
            top: 64,
            right: 16,
            zIndex: 1000,
            background: "#1e1b2e",
            border: "1px solid #a855f7",
            borderRadius: 8,
            padding: "12px 16px",
            maxWidth: 360,
            color: "#e5e7eb",
            fontSize: 13,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ color: "#a855f7" }}>Debug — Answer Key</strong>
            <button
              className="btn-ghost"
              style={{ padding: "2px 8px", fontSize: 12 }}
              onClick={() => setShowDebug(false)}
            >
              ✕
            </button>
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>Hidden diagnosis:</strong> {debugInfo.hidden_diagnosis || "—"}
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>Acceptable differentials:</strong>
            {debugInfo.acceptable_differentials.length ? (
              <ul style={{ margin: "4px 0 0 18px" }}>
                {debugInfo.acceptable_differentials.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            ) : " —"}
          </div>
          <div>
            <strong>Expected management:</strong>
            {debugInfo.management_actions.length ? (
              <ul style={{ margin: "4px 0 0 18px" }}>
                {debugInfo.management_actions.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            ) : " —"}
          </div>
        </div>
      )}

      <main className="app-main">

        {/* ══════════════════ LANDING ══════════════════ */}
        {appView === "landing" && (
          <div className="landing">
            <div className="landing-hero">
              <p className="landing-eyebrow">Clinical Training Platform</p>
              <h1 className="landing-title">Choose a Specialty</h1>
              <p className="landing-sub">Select a medical specialty to begin your simulated patient encounter.</p>
            </div>
            <div className="specialty-grid">
              {specialties.map((specialty) => (
                <button
                  key={specialty}
                  className={`specialty-card ${selectedSpecialty === specialty ? "selected" : ""}`}
                  onClick={() => setSelectedSpecialty(specialty)}
                >
                  <span className="specialty-icon">{specialtyIcons[specialty]}</span>
                  <span className="specialty-name">{specialty}</span>
                  <span className="specialty-check">{selectedSpecialty === specialty ? "✓" : ""}</span>
                </button>
              ))}
            </div>
            {selectedSpecialty && (
              <div className="start-panel">
                <div className="selected-badge">
                  {specialtyIcons[selectedSpecialty]} {selectedSpecialty} selected
                </div>
                <button
                  className={`btn-primary ${loading ? "loading" : ""}`}
                  onClick={startSimulation}
                  disabled={loading}
                >
                  {loading ? <><span className="spinner" /> Generating Case…</> : "Start Simulation →"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ SIMULATION ══════════════════ */}
        {appView === "simulation" && patient && (
          <div className="sim-layout">
            {/* ── Left: Chat ── */}
            <div className="sim-main">
              {/* Patient card */}
              <div className="patient-card">
                <div className="patient-header">
                  <div>
                    <div className="patient-tag">Active Case · {selectedSpecialty}</div>
                    <h2 className="patient-name">{patient.name}</h2>
                  </div>
                  <div className="patient-meta-pills">
                    <span className="pill">{patient.age} yrs</span>
                    <span className="pill">{patient.sex}</span>
                    <span className="pill">{patient.occupation}</span>
                  </div>
                </div>
                <div className="complaint-row">
                  <span className="complaint-label">Chief Complaint</span>
                  <span className="complaint-text">{patient.complaint}</span>
                </div>
              </div>

              {/* Chat */}
              <div className="chat-card">
                <div className="chat-title">Patient Interview</div>
                <div className="chat-messages">
                  {messages.map((message, i) => (
                    <div key={i} className={`message-row ${message.role === "user" ? "user-row" : "patient-row"}`}>
                      <div className="message-avatar">
                        {message.role === "user"
                          ? "DR"
                          : patient?.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() || "PT"}
                      </div>
                      <div className={`message-bubble ${message.role}`}>
                        <span className="message-sender">
                          {message.role === "user" ? "You (Doctor)" : patient?.name || "Patient"}
                        </span>
                        <p>{message.text}</p>
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="message-row patient-row">
                      <div className="message-avatar">PT</div>
                      <div className="message-bubble patient typing-indicator">
                        <span /><span /><span />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                

                <div className="chat-input-row">
                  <input
                    ref={chatInputRef}
                    className="chat-input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about symptoms, history…"
                    onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                    disabled={loading}
                  />
                  <button
                    className={`btn-send ${loading || !chatInput.trim() ? "disabled" : ""}`}
                    onClick={sendChat}
                    disabled={loading || !chatInput.trim()}
                  >
                    {loading ? <span className="spinner sm" /> : "Send"}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Right: Sidebar ── */}
            <div className="sim-sidebar">
              <div className="sidebar-card">

                {/* Vitals */}
                <div className="sidebar-section-title">
                  <span className="sidebar-icon">📊</span> Vitals
                </div>
                <div className="action-buttons-grid">
                  {VITALS_CONFIG.map(({ key, label, icon }) => {
                    const revealed = visibleVitals.includes(key);
                    const value    = patient?.vitals?.[key];
                    return (
                      <button
                        key={key}
                        className={`action-btn ${revealed ? "revealed" : ""}`}
                        onClick={() => revealVital(key)}
                        disabled={revealed || !value}
                        title={revealed ? `${label}: ${value}` : `Take ${label}`}
                      >
                        <span className="action-btn-icon">{icon}</span>
                        <span className="action-btn-label">{label}</span>
                        {revealed && value
                          ? <span className="action-btn-value">{value}</span>
                          : <span className="action-btn-cta">{!value ? "N/A" : "Take →"}</span>
                        }
                      </button>
                    );
                  })}
                </div>

                <div className="sidebar-divider" />

                {/* Investigations */}
                <div className="sidebar-section-title">
                  <span className="sidebar-icon">🔬</span> Investigations
                </div>
                {availableInvestigations.length > 0 ? (
                  <div className="action-buttons-list">
                    {availableInvestigations.map((key) => {
                      const revealed = visibleInvestigations.includes(key);
                      const value    = patient?.investigations?.[key];
                      return (
                        <button
                          key={key}
                          className={`action-btn wide ${revealed ? "revealed" : ""}`}
                          onClick={() => revealInvestigation(key)}
                          disabled={revealed}
                          title={revealed ? `${key}: ${value}` : `Order ${key}`}
                        >
                          <span className="action-btn-label">{key}</span>
                          {revealed && value
                            ? <span className="action-btn-value">{value}</span>
                            : <span className="action-btn-cta">Order →</span>
                          }
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="sidebar-hint">No investigations available.</p>
                )}

                <div className="sidebar-divider" />

                {/* FR-03: Diagnosis section */}
                <div className="sidebar-section-title">
                  <span className="sidebar-icon">🩺</span> Diagnosis
                </div>

                <DiagnosePanel
                  caseId={caseId}
                  sessionId={sessionId}
                  timerSeconds={timerSeconds}
                  formatTime={formatTime}
                  onSubmitted={handleDiagnosisSubmitted}
                  onTimerStop={() => setTimerRunning(false)}
                />
              </div>
              <button className="btn-new-sim" onClick={resetSimulation}>← New Simulation</button>
            </div>
          </div>
        )}

        {/* ══════════════════ DEBRIEF (FR-04) ══════════════════ */}
        {appView === "debrief" && patient && debriefPayload && diagnosisForm && diagnosisResult && (
          <DebriefPage
            caseId={caseId}
            patient={patient}
            selectedSpecialty={selectedSpecialty}
            timerSeconds={timerSeconds}
            formatTime={formatTime}
            diagnosisForm={diagnosisForm}
            diagnosisResult={diagnosisResult}
            debriefPayload={debriefPayload}
            onNewSimulation={resetSimulation}
          />
        )}

      </main>
    </div>
  );
}

export default App;