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
    setSelectedInvestigation("");
    setInvestigationSearch("");
    setInvestigationDropdownOpen(false);
    setAppView("landing");
  };

  // ── Investigation dropdown state ────────────────────────────────────────────
  const [selectedInvestigation, setSelectedInvestigation] = useState<string>("");
  const [investigationDropdownOpen, setInvestigationDropdownOpen] = useState(false);
  const [investigationSearch, setInvestigationSearch] = useState<string>("");
  const invDropdownRef = useRef<HTMLDivElement>(null);
  const invSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (invDropdownRef.current && !invDropdownRef.current.contains(e.target as Node)) {
        setInvestigationDropdownOpen(false);
        setInvestigationSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus the search input whenever the dropdown opens
  useEffect(() => {
    if (investigationDropdownOpen && invSearchRef.current) {
      invSearchRef.current.focus();
    }
  }, [investigationDropdownOpen]);

  // All investigations a clinician might order, grouped by category
  const INVESTIGATION_CATALOGUE: { group: string; items: string[] }[] = [
    {
      group: "Cardiac",
      items: ["ECG", "Troponin", "BNP / NT-proBNP", "CK-MB", "Echocardiogram", "Holter Monitor", "Cardiac Catheterisation"],
    },
    {
      group: "Imaging",
      items: ["Chest X-Ray", "CT Chest", "CT Head", "MRI Brain", "CT Abdomen/Pelvis", "Ultrasound Abdomen", "V/Q Scan", "CTPA"],
    },
    {
      group: "Blood Tests",
      items: [
        "FBC (Full Blood Count)", "CRP", "ESR", "Urea & Electrolytes", "LFTs (Liver Function Tests)",
        "Blood Glucose", "HbA1c", "Coagulation Screen (PT/APTT/INR)", "D-Dimer",
        "Thyroid Function (TSH/T4)", "Lipid Profile", "Lactate", "ABG (Arterial Blood Gas)",
        "Blood Culture", "Sputum Culture",
      ],
    },
    {
      group: "Urine & Other",
      items: ["Urinalysis", "Urine Culture", "Urine MC&S", "Lumbar Puncture (CSF)", "Spirometry", "Peak Flow", "Sputum AFB Smear"],
    },
  ];

  const ALL_INVESTIGATIONS: string[] = INVESTIGATION_CATALOGUE.flatMap((g) => g.items);

  // Map catalogue names → JSON investigation keys (for the ones the backend provides)
  const CATALOGUE_TO_CASE_KEY: Record<string, string> = {
    "ECG":               "ECG",
    "Troponin":          "Troponin",
    "Chest X-Ray":       "Chest X-Ray",
    "FBC (Full Blood Count)": "Lab Findings",
    "CRP":               "Lab Findings",
    "ESR":               "Lab Findings",
  };

  // Generate a normal/standard result for a test given the patient age
  const getNormalResult = (test: string, age: number): string => {
    const isElderly = age >= 65;
    const isPaediatric = age < 18;
    const normalMap: Record<string, string> = {
      "ECG":                         "Normal sinus rhythm, rate 72 bpm, no ST changes",
      "Troponin":                     isPaediatric ? "0.01 ng/mL (< 0.04 ng/mL normal)" : "0.02 ng/mL (< 0.04 ng/mL normal)",
      "BNP / NT-proBNP":             isElderly ? "88 pg/mL (normal < 100 pg/mL for age ≥ 75)" : "42 pg/mL (normal < 100 pg/mL)",
      "CK-MB":                        "3.2 ng/mL (normal < 5.0 ng/mL)",
      "Echocardiogram":               "Normal LV size and function. EF 60%. No valvular abnormality.",
      "Holter Monitor":               "24-hr monitor: normal sinus rhythm throughout. No significant arrhythmia.",
      "Cardiac Catheterisation":      "No significant coronary artery disease. Normal LV function.",
      "Chest X-Ray":                  "Clear lung fields. Normal cardiac silhouette. No consolidation, effusion, or pneumothorax.",
      "CT Chest":                     "No acute pulmonary pathology. Normal mediastinum.",
      "CT Head":                      "No intracranial haemorrhage, mass effect, or acute ischaemia.",
      "MRI Brain":                    "No acute infarct, demyelination, or structural abnormality.",
      "CT Abdomen/Pelvis":            "No acute intra-abdominal pathology.",
      "Ultrasound Abdomen":           "Liver, gallbladder, kidneys, and spleen appear normal. No free fluid.",
      "V/Q Scan":                     "Normal ventilation-perfusion ratio. No mismatch. Low probability for PE.",
      "CTPA":                         "No pulmonary embolism identified. No pulmonary artery filling defects.",
      "FBC (Full Blood Count)":       isPaediatric
        ? "Hb 12.5 g/dL, WBC 8.2 × 10⁹/L, Platelets 280 × 10⁹/L — all within normal paediatric range"
        : isElderly
        ? "Hb 13.0 g/dL, WBC 7.5 × 10⁹/L, Platelets 220 × 10⁹/L — within normal limits"
        : "Hb 14.2 g/dL, WBC 6.8 × 10⁹/L, Platelets 250 × 10⁹/L — within normal limits",
      "CRP":                          "3 mg/L (normal < 10 mg/L)",
      "ESR":                          isElderly ? "25 mm/hr (normal < 30 mm/hr for age)" : "10 mm/hr (normal < 20 mm/hr)",
      "Urea & Electrolytes":          "Na 139 mmol/L, K 4.1 mmol/L, Urea 5.2 mmol/L, Creatinine 82 µmol/L, eGFR > 60 — all normal",
      "LFTs (Liver Function Tests)":  "ALT 28 U/L, AST 25 U/L, ALP 72 U/L, Bilirubin 12 µmol/L, Albumin 41 g/L — normal",
      "Blood Glucose":                "5.2 mmol/L (fasting normal: 3.9–5.5 mmol/L)",
      "HbA1c":                        "37 mmol/mol / 5.6% (normal < 42 mmol/mol)",
      "Coagulation Screen (PT/APTT/INR)": "PT 12s, APTT 28s, INR 1.0 — normal coagulation",
      "D-Dimer":                      "0.3 mg/L FEU (normal < 0.5 mg/L FEU)",
      "Thyroid Function (TSH/T4)":    isElderly ? "TSH 3.1 mIU/L, Free T4 14 pmol/L — euthyroid" : "TSH 2.4 mIU/L, Free T4 16 pmol/L — normal thyroid function",
      "Lipid Profile":                "Total cholesterol 4.8 mmol/L, LDL 2.9 mmol/L, HDL 1.4 mmol/L, TG 1.2 mmol/L — within desirable range",
      "Lactate":                      "1.1 mmol/L (normal < 2.0 mmol/L)",
      "ABG (Arterial Blood Gas)":     "pH 7.41, PaO₂ 11.2 kPa, PaCO₂ 5.0 kPa, HCO₃⁻ 24 mmol/L, SaO₂ 98% — normal",
      "Blood Culture":                "No growth at 48 hours (preliminary). Awaiting 5-day result.",
      "Sputum Culture":               "Sparse oropharyngeal flora. No significant pathogen isolated.",
      "Urinalysis":                   "Clear, yellow. pH 6.0. No protein, glucose, blood, nitrites, or leucocytes. Normal.",
      "Urine Culture":                "No significant growth (< 10⁴ CFU/mL).",
      "Urine MC&S":                   "No growth. No pus cells or red cells on microscopy.",
      "Lumbar Puncture (CSF)":        "Opening pressure 14 cmH₂O. Clear CSF. Protein 0.35 g/L, Glucose 3.8 mmol/L, WBC 2 cells/µL — normal.",
      "Spirometry":                   "FEV₁ 88% predicted, FVC 90% predicted, FEV₁/FVC 0.82 — normal spirometry",
      "Peak Flow":                    "480 L/min (within 20% of personal best) — normal",
      "Sputum AFB Smear":             "Acid-fast bacilli not seen. Culture pending.",
    };
    return normalMap[test] ?? "Result within normal limits for age and sex.";
  };

  // Order an investigation from the dropdown
  const orderInvestigation = (testName: string) => {
    if (!testName || visibleInvestigations.includes(testName)) return;
    revealInvestigation(testName);
    setSelectedInvestigation("");
    setInvestigationDropdownOpen(false);
    setInvestigationSearch("");
  };

  // Get result for any ordered investigation
  const getInvestigationResult = (testName: string): string => {
    const caseKey = CATALOGUE_TO_CASE_KEY[testName];
    if (caseKey && patient?.investigations?.[caseKey]) {
      return patient.investigations[caseKey];
    }
    return getNormalResult(testName, patient?.age ?? 40);
  };

  // (availableInvestigations no longer needed — dropdown replaces fixed buttons)

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

                {/* Search-dropdown to order a test */}
                <div ref={invDropdownRef} style={{ position: "relative", marginBottom: 10 }}>
                  {/* Combobox trigger / search input */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    background: "var(--surface-elevated, #1a1a2e)",
                    border: `1px solid ${investigationDropdownOpen ? "var(--accent, #06b6d4)" : "var(--border, #2d2d44)"}`,
                    borderRadius: 8,
                    transition: "border-color 0.15s",
                  }}>
                    <span style={{ fontSize: 13, color: "var(--text-tertiary, #9ca3af)", flexShrink: 0 }}>🔍</span>
                    <input
                      ref={invSearchRef}
                      type="text"
                      placeholder={selectedInvestigation || "Search investigations…"}
                      value={investigationSearch}
                      onChange={(e) => {
                        setInvestigationSearch(e.target.value);
                        setInvestigationDropdownOpen(true);
                      }}
                      onFocus={() => setInvestigationDropdownOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setInvestigationDropdownOpen(false);
                          setInvestigationSearch("");
                        }
                      }}
                      style={{
                        flex: 1,
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        fontSize: 13,
                        color: "var(--text-primary, #e5e7eb)",
                        minWidth: 0,
                      }}
                    />
                    {(investigationSearch || selectedInvestigation) && (
                      <span
                        onClick={() => {
                          setInvestigationSearch("");
                          setSelectedInvestigation("");
                          setInvestigationDropdownOpen(false);
                        }}
                        style={{ fontSize: 12, color: "var(--text-tertiary, #9ca3af)", cursor: "pointer", flexShrink: 0 }}
                        title="Clear"
                      >✕</span>
                    )}
                    <span
                      onClick={() => {
                        setInvestigationDropdownOpen((p) => !p);
                        setInvestigationSearch("");
                      }}
                      style={{ fontSize: 10, color: "var(--text-tertiary, #9ca3af)", cursor: "pointer", flexShrink: 0 }}
                    >{investigationDropdownOpen ? "▲" : "▼"}</span>
                  </div>

                  {investigationDropdownOpen && (() => {
                    const q = investigationSearch.toLowerCase().trim();
                    const filtered = INVESTIGATION_CATALOGUE.map((group) => ({
                      ...group,
                      items: group.items.filter((item) => !q || item.toLowerCase().includes(q)),
                    })).filter((group) => group.items.length > 0);

                    return (
                      <div style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        left: 0,
                        right: 0,
                        zIndex: 200,
                        background: "var(--surface-elevated, #1a1a2e)",
                        border: "1px solid var(--border, #2d2d44)",
                        borderRadius: 8,
                        maxHeight: 280,
                        overflowY: "auto",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      }}>
                        {filtered.length === 0 ? (
                          <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-tertiary, #9ca3af)", textAlign: "center" }}>
                            No investigations match "{investigationSearch}"
                          </div>
                        ) : filtered.map((group) => (
                          <div key={group.group}>
                            <div style={{
                              padding: "6px 12px 4px",
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: "0.08em",
                              color: "var(--accent, #06b6d4)",
                              textTransform: "uppercase",
                              borderBottom: "1px solid var(--border, #2d2d44)",
                              position: "sticky",
                              top: 0,
                              background: "var(--surface-elevated, #1a1a2e)",
                            }}>
                              {group.group}
                            </div>
                            {group.items.map((item) => {
                              const alreadyOrdered = visibleInvestigations.includes(item);
                              const isRelevant = !!CATALOGUE_TO_CASE_KEY[item] && !!patient?.investigations?.[CATALOGUE_TO_CASE_KEY[item]];
                              // Highlight matching text
                              const renderLabel = () => {
                                if (!q) return <>{item}</>;
                                const idx = item.toLowerCase().indexOf(q);
                                if (idx === -1) return <>{item}</>;
                                return (
                                  <>
                                    {item.slice(0, idx)}
                                    <mark style={{ background: "rgba(6,182,212,0.25)", color: "inherit", borderRadius: 2 }}>
                                      {item.slice(idx, idx + q.length)}
                                    </mark>
                                    {item.slice(idx + q.length)}
                                  </>
                                );
                              };
                              return (
                                <div
                                  key={item}
                                  onClick={() => {
                                    if (!alreadyOrdered) {
                                      setSelectedInvestigation(item);
                                      setInvestigationDropdownOpen(false);
                                      setInvestigationSearch("");
                                    }
                                  }}
                                  style={{
                                    padding: "7px 12px",
                                    fontSize: 13,
                                    cursor: alreadyOrdered ? "default" : "pointer",
                                    color: alreadyOrdered
                                      ? "var(--text-tertiary, #9ca3af)"
                                      : "var(--text-primary, #e5e7eb)",
                                    background: "transparent",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    opacity: alreadyOrdered ? 0.5 : 1,
                                    transition: "background 0.15s",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!alreadyOrdered) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.05)";
                                  }}
                                  onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                                  }}
                                >
                                  {alreadyOrdered && <span style={{ fontSize: 10, color: "#22c55e" }}>✓</span>}
                                  {renderLabel()}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Order button */}
                {selectedInvestigation && (
                  <button
                    className="btn-primary"
                    style={{ width: "100%", marginBottom: 10, padding: "8px 12px", fontSize: 13 }}
                    onClick={() => orderInvestigation(selectedInvestigation)}
                  >
                    Order: {selectedInvestigation} →
                  </button>
                )}

                {/* Results of ordered investigations */}
                {visibleInvestigations.length > 0 && (
                  <div className="action-buttons-list">
                    {visibleInvestigations.map((testName) => {
                      const result = getInvestigationResult(testName);
                      return (
                        <div
                          key={testName}
                          className="action-btn wide revealed"
                          style={{ cursor: "default", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}
                        >
                          <span className="action-btn-label" style={{ fontWeight: 600 }}>{testName}</span>
                          <span className="action-btn-value" style={{ whiteSpace: "normal", lineHeight: 1.4, fontSize: 11 }}>{result}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {visibleInvestigations.length === 0 && (
                  <p className="sidebar-hint">No investigations ordered yet.</p>
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