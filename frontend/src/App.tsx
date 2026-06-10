import { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "patient";
  text: string;
};

type DiagnosisResult = {
  score: number;
  feedback: string;
  patientReaction: string;
};

function App() {
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [caseId, setCaseId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [patient, setPatient] = useState<any>(null);
  const [patientOpening, setPatientOpening] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showVitals, setShowVitals] = useState(false);
  const [visibleVitals, setVisibleVitals] = useState<string[]>([]);
  const [visibleInvestigations, setVisibleInvestigations] = useState<string[]>([]);

  // Diagnose feature state
  const [showDiagnoseBox, setShowDiagnoseBox] = useState(false);
  const [diagnosisInput, setDiagnosisInput] = useState("");
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisSubmitted, setDiagnosisSubmitted] = useState(false);

  // Timer state
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const specialties = ["Cardiology", "Pulmonology", "Neurology"];

  const specialtyIcons: Record<string, string> = {
    Cardiology: "♥",
    Pulmonology: "◎",
    Neurology: "⊕",
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    chatInputRef.current?.focus();
  }, [messages]);

  // Timer logic
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerRunning]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const startSimulation = async () => {
    setLoading(true);
    try {
      const caseResponse = await fetch(
        `http://127.0.0.1:8000/specialty/${selectedSpecialty.toLowerCase()}`
      );
      const caseData = await caseResponse.json();
      setCaseId(caseData.case_id);
      setPatient(caseData);
      const startResponse = await fetch(
        `http://127.0.0.1:8000/start/${caseData.case_id}`,
        {
          method: "POST"
        }
      );

      const startData = await startResponse.json();

      setSessionId(startData.session_id);

      const llmResponse = await fetch(`http://127.0.0.1:8000/llm/${caseData.case_id}`);
      const llmData = await llmResponse.json();
      setPatientOpening(llmData.patient_start_sentence);
      setMessages([{ role: "patient", text: llmData.patient_start_sentence }]);
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 100);
      setSuggestions([]);
      setShowVitals(false);
      setVisibleVitals([]);
      setVisibleInvestigations([]);

      // Reset diagnosis state
      setShowDiagnoseBox(false);
      setDiagnosisInput("");
      setDiagnosisResult(null);
      setDiagnosisSubmitted(false);

      // Start timer
      setTimerSeconds(0);
      setTimerRunning(true);
    } catch (error) {
      console.error("Error:", error);
      setPatient(null);
      setPatientOpening("");
      setMessages([]);
      setSuggestions([]);
      setShowVitals(false);
      setVisibleVitals([]);
      setVisibleInvestigations([]);
    } finally {
      setLoading(false);
    }
  };

  const sendChat = async () => {
    const raw = chatInput.trim();
    if (!raw) return;

    const isVitalQuestion = (q: string) => {
      const s = q.toLowerCase();
      const vitalsMap: { [key: string]: string[] } = {
        bp: ["blood pressure", "bp", "bloodpressure", "pressure"],
        hr: ["heart rate", "hr", "pulse", "heartbeat"],
        spo2: ["oxygen", "spo2", "blood oxygen", "oxygen level", "o2"],
        temp: ["temperature", "temp", "fever", "hot"],
        rr: ["respiratory rate", "rr", "breathing rate", "respiration", "breaths per minute"],
      };
      const found: string[] = [];
      for (const key of Object.keys(vitalsMap)) {
        for (const v of vitalsMap[key]) {
          if (s.includes(v) && !found.includes(key)) found.push(key);
        }
      }
      return found;
    };

    const isInvestigationQuestion = (q: string) => {
      const s = q.toLowerCase();
      const invMap: { [key: string]: string[] } = {};
      if (patient && patient.investigations) {
        Object.keys(patient.investigations).forEach((k: string) => {
          const lower = k.toLowerCase();
          const variants = [lower];
          if (lower.includes("cbc") || lower.includes("complete blood")) variants.push("cbc", "blood count");
          if (lower.includes("chest") || lower.includes("x-ray") || lower.includes("xray")) variants.push("chest x-ray", "xray", "cxr", "x ray");
          if (lower.includes("peak")) variants.push("peak flow", "peakflow");
          if (lower.includes("ecg") || lower.includes("ekg")) variants.push("ecg", "ekg");
          if (lower.includes("ct")) variants.push("ct", "ct scan");
          invMap[k] = variants;
        });
      }
      const found: string[] = [];
      for (const key of Object.keys(invMap)) {
        for (const v of invMap[key]) {
          if (s.includes(v) && !found.includes(key)) found.push(key);
        }
      }
      return found;
    };

    const question = raw;
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", text: question }]);

    const requestedVitals = isVitalQuestion(question);
    const requestedInv = isInvestigationQuestion(question);

    if (requestedVitals.length > 0) {
      setShowVitals(true);
      setVisibleVitals((prev) => Array.from(new Set([...prev, ...requestedVitals])));
    }
    if (requestedInv.length > 0) {
      setVisibleInvestigations((prev) => Array.from(new Set([...prev, ...requestedInv])));
    }

    setLoading(true);
    try {
      const response = await fetch(`http://127.0.0.1:8000/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          question,
        }),
      });
      if (!response.ok) throw new Error("Failed to get response from patient chat.");
      const data = await response.json();
      setMessages((prev) => [...prev, { role: "patient", text: data.answer }]);
      setSuggestions(data.suggestions || []);
    } catch (error) {
      console.error("Chat error:", error);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const submitDiagnosis = async () => {
    const diagnosis = diagnosisInput.trim();
    if (!diagnosis || !patient) return;

    setDiagnosisLoading(true);
    setDiagnosisSubmitted(true);

    // Stop the timer when diagnosis is submitted
    setTimerRunning(false);

    try {
  const response = await fetch(`http://127.0.0.1:8000/diagnose/${caseId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      diagnosis,
      time_taken: formatTime(timerSeconds),
    }),
  });

  if (!response.ok) throw new Error("Backend diagnosis scoring failed.");
  const parsed: DiagnosisResult = await response.json();
  setDiagnosisResult(parsed);

      // Add patient reaction to the chat
      setMessages((prev) => [
        ...prev,
        { role: "patient", text: parsed.patientReaction },
      ]);
    } catch (err) {
      console.error("Diagnosis scoring error:", err);
      setDiagnosisResult({
        score: 0,
        feedback: "Could not evaluate diagnosis. Please check your connection.",
        patientReaction: "I... I'm not sure what's happening, doctor.",
      });
    } finally {
      setDiagnosisLoading(false);
    }
  };

  const resetSimulation = () => {
    setSelectedSpecialty("");
    setPatient(null);
    setPatientOpening("");
    setMessages([]);
    setChatInput("");
    setSuggestions([]);
    setShowVitals(false);
    setVisibleVitals([]);
    setVisibleInvestigations([]);
    setShowDiagnoseBox(false);
    setDiagnosisInput("");
    setDiagnosisResult(null);
    setDiagnosisSubmitted(false);
    setTimerSeconds(0);
    setTimerRunning(false);
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

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="header-inner">
          <div className="logo-group">
            <span className="logo-icon">⚕</span>
            <span className="logo-text">MedSim <span className="logo-accent">AI</span></span>
          </div>
          {patient && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {/* Timer */}
              <div className={`timer-badge ${diagnosisSubmitted ? "stopped" : "running"}`}>
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

      <main className="app-main">
        {!patient ? (
          /* ── Landing / Specialty Selection ── */
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
                  {loading ? (
                    <><span className="spinner" /> Generating Case…</>
                  ) : (
                    "Start Simulation →"
                  )}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ── Simulation Layout ── */
          <div className="sim-layout">
            {/* Left: Patient Info + Chat */}
            <div className="sim-main">
              {/* Patient Card */}
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
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`message-row ${message.role === "user" ? "user-row" : "patient-row"}`}
                    >
                      <div className="message-avatar">
                        {message.role === "user"
                          ? "DR"
                          : patient?.name
                              ?.split(" ")
                              .map((n: string) => n[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase() || "PT"}
                      </div>
                      <div className={`message-bubble ${message.role}`}>
                        <span className="message-sender">
                          {message.role === "user"
                            ? "You (Doctor)"
                            : patient?.name || "Patient"}
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

                {suggestions.length > 0 && (
                  <div className="suggestions-bar">
                    <span className="suggestions-label">💡 Suggested:</span>
                    {suggestions.map((s, i) => (
                      <span key={i} className="suggestion-chip">{s}</span>
                    ))}
                  </div>
                )}

                <div className="chat-input-row">
                  <input
                    ref={chatInputRef}
                    className="chat-input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about symptoms, history, or request tests…"
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

              {/* Red Flags */}
              {patient.red_flags && patient.red_flags.length > 0 && (
                <div className="red-flags-card">
                  <div className="red-flags-title">🚨 Red Flags</div>
                  <ul className="red-flags-list">
                    {patient.red_flags.map((flag: string, index: number) => (
                      <li key={index}>{flag}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Right: Vitals + Investigations */}
            <div className="sim-sidebar">
              <div className="sidebar-card">
                <div className="sidebar-section-title">
                  <span className="sidebar-icon">📊</span> Vitals
                </div>
                {showVitals && visibleVitals.length > 0 && patient?.vitals ? (
                  <div className="vitals-list">
                    {visibleVitals.map((key) => (
                      <div key={key} className="vital-row">
                        <span className="vital-key">{key.toUpperCase()}</span>
                        <span className="vital-val">{patient.vitals[key] ?? "N/A"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sidebar-hint">
                    Ask about blood pressure, heart rate, SpO₂, temperature, or respiratory rate to reveal vitals.
                  </p>
                )}

                <div className="sidebar-divider" />

                <div className="sidebar-section-title">
                  <span className="sidebar-icon">🔬</span> Investigations
                </div>
                {visibleInvestigations.length > 0 && patient?.investigations ? (
                  <div className="vitals-list">
                    {visibleInvestigations.map((key) => (
                      <div key={key} className="vital-row">
                        <span className="vital-key">{key}</span>
                        <span className="vital-val">{patient.investigations[key] ?? "N/A"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sidebar-hint">
                    Request specific tests like CBC, chest X-ray, or ECG to reveal results here.
                  </p>
                )}

                <div className="sidebar-divider" />

                {/* ── Diagnose Section ── */}
                <div className="sidebar-section-title">
                  <span className="sidebar-icon">🩺</span> Diagnosis
                </div>

                {!diagnosisSubmitted ? (
                  <>
                    <button
                      className="btn-diagnose"
                      onClick={() => setShowDiagnoseBox((prev) => !prev)}
                      disabled={diagnosisLoading}
                    >
                      {showDiagnoseBox ? "✕ Cancel Diagnosis" : "🩺 Submit Diagnosis"}
                    </button>

                    {showDiagnoseBox && (
                      <div className="diagnose-box">
                        <p className="diagnose-hint">Enter your final diagnosis below. The AI will score your answer based on accuracy and relevance.</p>
                        <textarea
                          className="diagnose-textarea"
                          value={diagnosisInput}
                          onChange={(e) => setDiagnosisInput(e.target.value)}
                          placeholder="e.g. Acute STEMI, Migraine with aura, Asthma exacerbation…"
                          rows={3}
                          disabled={diagnosisLoading}
                        />
                        <button
                          className={`btn-primary btn-diagnose-submit ${diagnosisLoading || !diagnosisInput.trim() ? "loading" : ""}`}
                          onClick={submitDiagnosis}
                          disabled={diagnosisLoading || !diagnosisInput.trim()}
                        >
                          {diagnosisLoading ? (
                            <><span className="spinner" /> Scoring…</>
                          ) : (
                            "Submit & Score →"
                          )}
                        </button>
                      </div>
                    )}
                  </>
                ) : diagnosisResult ? (
                  <div className="diagnosis-result">
                    <div className="score-ring-wrap">
                      <svg viewBox="0 0 80 80" className="score-ring">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="8" />
                        <circle
                          cx="40" cy="40" r="34"
                          fill="none"
                          stroke={getScoreColor(diagnosisResult.score)}
                          strokeWidth="8"
                          strokeDasharray={`${(diagnosisResult.score / 100) * 213.6} 213.6`}
                          strokeLinecap="round"
                          transform="rotate(-90 40 40)"
                          style={{ transition: "stroke-dasharray 1s ease" }}
                        />
                      </svg>
                      <div className="score-ring-text">
                        <span className="score-number" style={{ color: getScoreColor(diagnosisResult.score) }}>
                          {diagnosisResult.score}
                        </span>
                        <span className="score-denom">/100</span>
                      </div>
                    </div>
                    <div className="score-label" style={{ color: getScoreColor(diagnosisResult.score) }}>
                      {getScoreLabel(diagnosisResult.score)}
                    </div>
                    <div className="time-taken">
                      ⏱ Completed in <strong>{formatTime(timerSeconds)}</strong>
                    </div>
                    <div className="score-feedback">
                      <div className="score-feedback-title">Feedback</div>
                      <p>{diagnosisResult.feedback}</p>
                    </div>
                    <div className="score-answer">
                      <span className="score-answer-label">Correct diagnosis:</span>
                      <span className="score-answer-val">{patient.hidden_diagnosis}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <button className="btn-new-sim" onClick={resetSimulation}>
                ← New Simulation
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
