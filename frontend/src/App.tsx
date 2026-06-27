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
  const [history, setHistory] = useState<any[]>([]);
  const [historyDetail, setHistoryDetail] = useState<any>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarFilter, setSidebarFilter] = useState("all");

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


  useEffect(() => {
  if (appView !== "landing") return;
  fetch(`${BASE}/history`)
    .then(r => r.json())
    .then((data) => {
      const seen = new Set<string>();
      const unique = data.filter((s: any) => {
        if (seen.has(s.session_id)) return false;
        seen.add(s.session_id);
        return true;
      });
      setHistory(unique);
    })
    .catch(console.error);
}, [appView]);


  // ── Helpers ──────────────────────────────────────────────────────────────────


  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const loadHistoryDetail = async (sessionId: string) => {
    const res = await fetch(`${BASE}/history/${sessionId}`);
    const data = await res.json();
    setHistoryDetail(data);
    setAppView("history");
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
      setPatient({ ...caseData, investigations: caseData.investigations || {} });

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
    setHistory([]);
    setHistoryDetail(null);
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
      items: ["ECG", "Troponin", "BNP", "CK-MB", "Echocardiogram", "Holter Monitor", "Cardiac Catheterisation", "Exercise Stress Test"],
    },
    {
      group: "Imaging",
      items: ["Chest X-Ray", "CT Chest", "CT Head", "MRI Brain", "CT Abdomen/Pelvis", "CT Aortogram", "Ultrasound Abdomen", "V/Q Scan", "CTPA", "CT Coronary Angiography", "Coronary Angiography"],
    },
    {
      group: "Blood Tests",
      items: [
        "FBC (Full Blood Count)", "CRP", "ESR", "Urea & Electrolytes", "LFTs (Liver Function Tests)",
        "Blood Glucose", "HbA1c", "Coagulation Screen (PT/APPT/INR)", "D-Dimer",
        "Thyroid Function (TSH/T4)", "Lipid Profile", "Lactate", "ABG (Arterial Blood Gas)",
        "Blood Culture", "Sputum Culture", "Blood Group & Crossmatch",
      ],
    },
    {
      group: "Urine & Other",
      items: ["Urinalysis", "Urine Culture", "Urine MC&S", "Lumbar Puncture (CSF)", "Spirometry", "Peak Flow", "Sputum AFB Smear","Bilateral Leg Doppler Ultrasound"],
    },
  ];

  const ALL_INVESTIGATIONS: string[] = INVESTIGATION_CATALOGUE.flatMap((g) => g.items);

  const normalizeInvestigationName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[-_()/]/g, "")
    .replace(/\s+/g, "")
    .trim();
};

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
      "BNP":             isElderly ? "88 pg/mL (normal < 100 pg/mL for age ≥ 75)" : "42 pg/mL (normal < 100 pg/mL)",
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
      "Coagulation Screen (PT/APPT/INR)": "PT 12s, APPT 28s, INR 1.0 — normal coagulation",
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
      "CT Aortogram":           "No aortic dissection. Normal aortic calibre throughout. No aneurysmal dilatation.",
      "Blood Group & Crossmatch": "Group A positive. No atypical antibodies detected. Crossmatch not requested.",
      "CT Coronary Angiography": "No significant coronary artery disease. Normal coronary anatomy.",
      "Coronary Angiography":    "No significant coronary artery disease identified.",
      "Exercise Stress Test":    "No ST changes. No symptoms reproduced. Adequate heart rate achieved. Negative for inducible ischaemia.",
      "Bilateral Leg Doppler Ultrasound": "No deep vein thrombosis identified bilaterally.",
      "Magnesium":               "0.85 mmol/L (normal: 0.7–1.0 mmol/L)",
      "Fasting Blood Glucose":   "5.0 mmol/L (normal fasting: 3.9–5.5 mmol/L)",
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
    const investigations = patient?.investigations || {};
    const normalizedTest = normalizeInvestigationName(testName);
    for (const [key, value] of Object.entries(investigations)) {
      if (normalizeInvestigationName(key) === normalizedTest) {
        return value as string;
      }
    }
    return getNormalResult(testName, patient?.age ?? 40);
  };

  // (availableInvestigations no longer needed — dropdown replaces fixed buttons)

  // ── Filtered history for sidebar ────────────────────────────────────────────
  const filteredHistory = history.filter(s =>
    (sidebarFilter === "all" || s.specialty === sidebarFilter) &&
    (!sidebarSearch || [s.patient_name, s.hidden_diagnosis, s.specialty]
      .some(v => v?.toLowerCase().includes(sidebarSearch.toLowerCase())))
  );

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
  <>
    {/* Sidebar overlay */}
    {sidebarOpen && (
      <div
        onClick={() => setSidebarOpen(false)}
        style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:99 }}
      />
    )}

    {/* ── REVAMPED HISTORY SIDEBAR ── */}
    <div style={{
      position: "fixed", top: 0, left: 0, height: "100%", width: 340,
      background: "linear-gradient(180deg, #111126 0%, #0f0f22 100%)",
      borderRight: "1px solid var(--border, #2d2d44)",
      transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
      transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      zIndex: 100, 
      display: "flex", 
      flexDirection: "column",
      boxShadow: sidebarOpen ? "-4px 0 24px rgba(0, 0, 0, 0.4)" : "none",
    }}>
      {/* Header with close button */}
      <div style={{ 
        padding: "20px 20px 16px", 
        borderBottom: "1px solid rgba(45, 45, 68, 0.6)",
        display:"flex", 
        justifyContent:"space-between", 
        alignItems:"center"
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", color: "#06b6d4", textTransform: "uppercase" }}>Session History</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary, #9ca3af)", marginTop: 2 }}>
            {filteredHistory.length} session{filteredHistory.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button 
          className="btn-ghost" 
          style={{ 
            padding:"6px 8px", 
            fontSize:14,
            color: "#9ca3af",
            transition: "all 0.2s"
          }} 
          onClick={() => setSidebarOpen(false)}
          onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.color = "#e5e7eb"}
          onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"}
        >
          ✕
        </button>
      </div>

      {/* Search box */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(45, 45, 68, 0.6)" }}>
        <input
          type="text"
          placeholder="Search by name or diagnosis…"
          value={sidebarSearch}
          onChange={e => setSidebarSearch(e.target.value)}
          style={{ 
            width:"100%", 
            padding:"8px 12px", 
            background:"var(--surface, #1a1a2e)", 
            border:"1px solid var(--border, #2d2d44)", 
            borderRadius: 6, 
            color:"var(--text-primary, #e5e7eb)", 
            fontSize:13, 
            outline:"none",
            transition: "all 0.2s",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#06b6d4";
            e.currentTarget.style.background = "rgba(26, 26, 46, 0.8)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border, #2d2d44)";
            e.currentTarget.style.background = "var(--surface, #1a1a2e)";
          }}
        />
      </div>

      {/* Filter pills */}
      <div style={{ padding:"12px 16px", borderBottom:"1px solid rgba(45, 45, 68, 0.6)", display:"flex", gap:6, flexWrap:"wrap" }}>
        {["all", "Cardiology", "Pulmonology", "Neurology"].map(f => (
          <button
            key={f}
            onClick={() => setSidebarFilter(f)}
            style={{
              padding:"5px 12px", 
              borderRadius: 16, 
              fontSize:12, 
              fontWeight: sidebarFilter === f ? 500 : 400,
              cursor:"pointer",
              border: sidebarFilter === f ? "1px solid #06b6d4" : "1px solid rgba(45, 45, 68, 0.8)",
              background: sidebarFilter === f ? "rgba(6, 182, 212, 0.15)" : "rgba(255, 255, 255, 0.02)",
              color: sidebarFilter === f ? "#06b6d4" : "var(--text-secondary, #9ca3af)",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              if (sidebarFilter !== f) {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255, 255, 255, 0.05)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(6, 182, 212, 0.3)";
              }
            }}
            onMouseLeave={(e) => {
              if (sidebarFilter !== f) {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255, 255, 255, 0.02)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(45, 45, 68, 0.8)";
              }
            }}
          >
            {f === "all" ? "All" : f}
          </button>
        ))}
      </div>

      {/* Sessions list */}
      <div style={{ flex:1, overflowY:"auto", padding:"8px 12px" }}>
        {filteredHistory.length === 0 ? (
          <div style={{ 
            padding:"32px 16px", 
            textAlign:"center", 
            color:"var(--text-secondary, #9ca3af)",
            fontSize: 13,
            lineHeight: 1.6
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>No sessions found</div>
            <div style={{ fontSize: 12 }}>
              {sidebarSearch ? "Try adjusting your search" : "Start a new simulation to see your history"}
            </div>
          </div>
        ) : (
          filteredHistory.map((s, i) => {
            const score = s.overall_score ?? 0;
            const scoreColor = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
            const scoreLabel = getScoreLabel(score);
            const specialty = s.specialty || "Unknown";
            const icon = specialtyIcons[specialty] || "◆";
            
            return (
              <div
                key={`${s.session_id}-${i}`}
                onClick={() => { loadHistoryDetail(s.session_id); setSidebarOpen(false); }}
                style={{ 
                  padding:"12px 12px", 
                  borderRadius: 8, 
                  cursor:"pointer", 
                  marginBottom:8,
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(45, 45, 68, 0.4)",
                  transition: "all 0.2s",
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start"
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.background = "rgba(6, 182, 212, 0.08)";
                  el.style.borderColor = "rgba(6, 182, 212, 0.3)";
                  el.style.transform = "translateX(2px)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.background = "rgba(255, 255, 255, 0.02)";
                  el.style.borderColor = "rgba(45, 45, 68, 0.4)";
                  el.style.transform = "translateX(0)";
                }}
              >
                {/* Specialty icon */}
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  background: "rgba(6, 182, 212, 0.1)",
                  border: "1px solid rgba(6, 182, 212, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  flexShrink: 0,
                  color: "#06b6d4"
                }}>
                  {icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ 
                    fontSize: 11, 
                    fontWeight: 600,
                    color:"#06b6d4", 
                    textTransform:"uppercase", 
                    letterSpacing:".06em", 
                    marginBottom:3 
                  }}>
                    {specialty}
                  </div>
                  <div style={{ 
                    fontSize:13, 
                    fontWeight: 500, 
                    color:"var(--text-primary, #e5e7eb)",
                    marginBottom: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}>
                    {s.patient_name}
                  </div>
                  <div style={{ 
                    fontSize:11, 
                    color:"var(--text-secondary, #9ca3af)",
                    marginBottom: 4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}>
                    {s.patient_age}y · {s.hidden_diagnosis}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary, #6b7280)" }}>
                    {new Date(s.started_at).toLocaleDateString()}
                  </div>
                </div>

                {/* Score badge */}
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  flexShrink: 0
                }}>
                  <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: `rgba(${scoreColor === "#22c55e" ? "34, 197, 94" : scoreColor === "#f59e0b" ? "245, 158, 11" : "239, 68, 68"}, 0.1)`,
                    border: `1.5px solid ${scoreColor}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    color: scoreColor,
                  }}>
                    {score}%
                  </div>
                  <div style={{ fontSize: 10, color: scoreColor, fontWeight: 500 }}>
                    {scoreLabel}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>

    {/* Landing content */}
    <div className="landing" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HERO SECTION — Clean and minimal */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="landing-hero" style={{ paddingTop: 60, paddingBottom: 80, textAlign: "center" }}>
        <p className="landing-eyebrow">Clinical training platform</p>
        <h1 className="landing-title">Choose your specialty.</h1>
        <p className="landing-sub" style={{ maxWidth: 500, marginLeft: "auto", marginRight: "auto" }}>
          Start a simulation and begin practicing real patient consultations with instant AI feedback.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MAIN CTA — Specialty selection (center stage) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div style={{ paddingBottom: 80 }}>
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
          <div className="start-panel" style={{ marginTop: 32 }}>
            <button className={`btn-primary ${loading ? "loading" : ""}`} onClick={startSimulation} disabled={loading} style={{ width: "100%", padding: "14px 24px", fontSize: 16 }}>
              {loading ? <><span className="spinner" /> Generating case…</> : `Start ${selectedSpecialty} simulation →`}
            </button>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECONDARY ZONE — Your progress & history (below fold) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {history.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border, #2d2d44)", paddingTop: 60, paddingBottom: 60, flex: 1 }}>
          {/* Stats row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:48, maxWidth: 600, marginLeft: "auto", marginRight: "auto" }}>
            {[
              ["Sessions completed", history.length],
              ["Average score", Math.round(history.reduce((a,s) => a + (s.overall_score ?? 0), 0) / history.length) + "%"],
              ["Specialties practiced", new Set(history.map(s => s.specialty)).size],
            ].map(([label, val]) => (
              <div key={label} style={{ background:"transparent", border:"1px solid var(--border, #2d2d44)", borderRadius:12, padding:24, textAlign:"center", transition: "all 0.2s" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "#06b6d4";
                  (e.currentTarget as HTMLDivElement).style.background = "rgba(6, 182, 212, 0.05)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border, #2d2d44)";
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }}
              >
                <div style={{ fontSize:28, fontWeight:600, color:"#06b6d4", marginBottom: 6 }}>{val}</div>
                <div style={{ fontSize:13, color:"var(--text-secondary, #9ca3af)", fontWeight: 500 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Recent sessions section */}
          <div style={{ maxWidth: 760, marginLeft: "auto", marginRight: "auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div>
                <h2 style={{ fontSize:18, fontWeight: 600, marginBottom: 2 }}>Recent sessions</h2>
                <p style={{ fontSize:13, color:"var(--text-secondary, #9ca3af)" }}>Review your past simulations and progress</p>
              </div>
              {history.length > 3 && (
                <button className="btn-ghost" style={{ fontSize:13, padding:"8px 12px", whiteSpace: "nowrap" }} onClick={() => setSidebarOpen(true)}>View all</button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {history.slice(0, 3).map((s, i) => {
                const score = s.overall_score ?? 0;
                const scoreColor = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
                const scoreLabel = getScoreLabel(score);
                const specialty = s.specialty || "Unknown";
                
                return (
                  <div
                    key={`${s.session_id}-${i}`}
                    onClick={() => loadHistoryDetail(s.session_id)}
                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", background:"transparent", border:"1px solid var(--border, #2d2d44)", borderRadius:10, cursor:"pointer", transition: "all 0.2s" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "#06b6d4";
                      (e.currentTarget as HTMLDivElement).style.background = "rgba(6, 182, 212, 0.05)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border, #2d2d44)";
                      (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    }}
                  >
                    <div style={{ display:"flex", flexDirection:"column", gap:4, flex: 1 }}>
                      <span style={{ fontSize:11, color:"#06b6d4", textTransform:"uppercase", letterSpacing:".05em", fontWeight: 600 }}>{specialty}</span>
                      <span style={{ fontSize:14, color:"var(--text-primary, #e5e7eb)", fontWeight: 500 }}>{s.patient_name}, {s.patient_age}y</span>
                      <span style={{ fontSize:12, color:"var(--text-secondary, #9ca3af)" }}>{s.hidden_diagnosis}</span>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3, textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize:18, fontWeight:600, color:scoreColor }}>{score}%</div>
                      <span style={{ fontSize:11, color:"var(--text-secondary, #9ca3af)" }}>{scoreLabel}</span>
                      <span style={{ fontSize:11, color:"var(--text-tertiary, #6b7280)" }}>{new Date(s.started_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  </>
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
        {appView === "history" && historyDetail && (
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 16px" }}>
            <button className="btn-ghost" onClick={() => setAppView("landing")} style={{ marginBottom: 24 }}>
              ← Back to History
            </button>

            <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>
              {historyDetail.session?.specialty} — {historyDetail.session?.patient_name}
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-secondary, #9ca3af)", marginBottom: 24 }}>
              {new Date(historyDetail.session?.started_at).toLocaleString()} · {historyDetail.session?.time_taken}
            </p>

            {historyDetail.debrief?.full_debrief ? (() => {
              const d = historyDetail.debrief.full_debrief;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                  {/* Score grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {[
                      ["Overall",       d.overall_score],
                      ["Diagnosis",     d.diagnosis_score],
                      ["Management",    d.management_score],
                      ["History",       d.history_score],
                      ["Investigation", d.investigation_score],
                      ["Reasoning",     d.reasoning_score],
                    ].map(([label, score]) => (
                      <div key={label} style={{
                        padding: "12px 16px",
                        background: "var(--surface-elevated, #1a1a2e)",
                        border: "1px solid var(--border, #2d2d44)",
                        borderRadius: 8,
                        textAlign: "center",
                      }}>
                        <div style={{ fontSize: 22, fontWeight: 500, color: getScoreColor(Number(score)) }}>
                          {score}%
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary, #9ca3af)", marginTop: 4 }}>
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Diagnosis comparison */}
                  <div style={{ padding: "14px 16px", background: "var(--surface-elevated, #1a1a2e)", border: "1px solid var(--border, #2d2d44)", borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary, #9ca3af)", marginBottom: 4 }}>Correct diagnosis</div>
                    <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>{d.correct_diagnosis}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary, #9ca3af)", marginBottom: 4 }}>Your diagnosis</div>
                    <div style={{ fontSize: 14 }}>{d.primary_diagnosis}</div>
                    {d.differential_1 && <>
                      <div style={{ fontSize: 12, color: "var(--text-secondary, #9ca3af)", marginTop: 10, marginBottom: 4 }}>Differentials</div>
                      <div style={{ fontSize: 13 }}>{d.differential_1}{d.differential_2 ? ` · ${d.differential_2}` : ""}</div>
                    </>}
                    {d.management_plan && <>
                      <div style={{ fontSize: 12, color: "var(--text-secondary, #9ca3af)", marginTop: 10, marginBottom: 4 }}>Management plan</div>
                      <div style={{ fontSize: 13 }}>{d.management_plan}</div>
                    </>}
                  </div>

                  {/* Feedback blocks */}
                  {[
                    ["History feedback",     d.history_feedback],
                    ["Reasoning feedback",   d.reasoning_feedback],
                    ["Management feedback",  d.management_feedback],
                  ].map(([label, text]) => text && (
                    <div key={label} style={{ padding: "14px 16px", background: "var(--surface-elevated, #1a1a2e)", border: "1px solid var(--border, #2d2d44)", borderRadius: 8 }}>
                      <div style={{ fontSize: 12, color: "var(--text-secondary, #9ca3af)", marginBottom: 6 }}>{label}</div>
                      <div style={{ fontSize: 14, lineHeight: 1.6 }}>{text}</div>
                    </div>
                  ))}

                  {/* Good vs missed questions */}
                  {(d.good_questions?.length > 0 || d.missed_questions?.length > 0) && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {d.good_questions?.length > 0 && (
                        <div style={{ padding: "14px 16px", background: "var(--surface-elevated, #1a1a2e)", border: "1px solid #22c55e44", borderRadius: 8 }}>
                          <div style={{ fontSize: 12, color: "#22c55e", marginBottom: 8 }}>Strong questions</div>
                          {d.good_questions.map((q: string, i: number) => (
                            <div key={i} style={{ fontSize: 13, marginBottom: 6, paddingLeft: 8, borderLeft: "2px solid #22c55e44" }}>{q}</div>
                          ))}
                        </div>
                      )}
                      {d.missed_questions?.length > 0 && (
                        <div style={{ padding: "14px 16px", background: "var(--surface-elevated, #1a1a2e)", border: "1px solid #ef444444", borderRadius: 8 }}>
                          <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 8 }}>Missed questions</div>
                          {d.missed_questions.map((q: string, i: number) => (
                            <div key={i} style={{ fontSize: 13, marginBottom: 6, paddingLeft: 8, borderLeft: "2px solid #ef444444" }}>{q}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Key findings */}
                  {(d.key_findings_discovered?.length > 0 || d.key_findings_missed?.length > 0) && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {d.key_findings_discovered?.length > 0 && (
                        <div style={{ padding: "14px 16px", background: "var(--surface-elevated, #1a1a2e)", border: "1px solid #22c55e44", borderRadius: 8 }}>
                          <div style={{ fontSize: 12, color: "#22c55e", marginBottom: 8 }}>Findings discovered</div>
                          {d.key_findings_discovered.map((f: string, i: number) => (
                            <div key={i} style={{ fontSize: 13, marginBottom: 6, paddingLeft: 8, borderLeft: "2px solid #22c55e44" }}>{f}</div>
                          ))}
                        </div>
                      )}
                      {d.key_findings_missed?.length > 0 && (
                        <div style={{ padding: "14px 16px", background: "var(--surface-elevated, #1a1a2e)", border: "1px solid #ef444444", borderRadius: 8 }}>
                          <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 8 }}>Findings missed</div>
                          {d.key_findings_missed.map((f: string, i: number) => (
                            <div key={i} style={{ fontSize: 13, marginBottom: 6, paddingLeft: 8, borderLeft: "2px solid #ef444444" }}>{f}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Investigations */}
                  {(d.important_ordered?.length > 0 || d.important_missed?.length > 0) && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {d.important_ordered?.length > 0 && (
                        <div style={{ padding: "14px 16px", background: "var(--surface-elevated, #1a1a2e)", border: "1px solid #22c55e44", borderRadius: 8 }}>
                          <div style={{ fontSize: 12, color: "#22c55e", marginBottom: 8 }}>Key investigations ordered</div>
                          {d.important_ordered.map((inv: string, i: number) => (
                            <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>✓ {inv}</div>
                          ))}
                        </div>
                      )}
                      {d.important_missed?.length > 0 && (
                        <div style={{ padding: "14px 16px", background: "var(--surface-elevated, #1a1a2e)", border: "1px solid #ef444444", borderRadius: 8 }}>
                          <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 8 }}>Key investigations missed</div>
                          {d.important_missed.map((inv: string, i: number) => (
                            <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>✗ {inv}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transcript */}
                  {d.transcript?.length > 0 && (
                    <div style={{ padding: "14px 16px", background: "var(--surface-elevated, #1a1a2e)", border: "1px solid var(--border, #2d2d44)", borderRadius: 8 }}>
                      <div style={{ fontSize: 12, color: "var(--text-secondary, #9ca3af)", marginBottom: 12 }}>Full transcript</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
                        {d.transcript.map((msg: any, i: number) => (
                          <div key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                            <span style={{ color: msg.role === "user" ? "var(--accent, #06b6d4)" : "var(--text-secondary, #9ca3af)", fontWeight: 500, marginRight: 8 }}>
                              {msg.role === "user" ? "Doctor" : "Patient"}
                            </span>
                            {msg.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              );
            })() : (
              <div style={{ color: "var(--text-secondary, #9ca3af)", fontSize: 14 }}>
                No debrief data available for this session.
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}

export default App;