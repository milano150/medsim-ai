import { useState, useEffect, useMemo } from "react";
import "./App.css";

// Cases available in the cases folder
import cardio_stemi from "../../cases/cardiology/stemi_01.json";

import pulm_asthma from "../../cases/pulmonology/asthma_01.json";

import neuro_migraine from "../../cases/neurology/migraine_01.json";

const CASES: Record<string, any[]> = {
  cardio: [cardio_stemi],
  pulmo: [pulm_asthma],
  neuro: [neuro_migraine],
};

function ChatInput({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form className="chat-input" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; onSend(text.trim()); setText(""); }}>
      <input className="chat-input-field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type message..." />
      <button className="chat-input-send" type="submit">Send</button>
    </form>
  );
}

function SimulationPage({ route, onBack }: { route: string; onBack: () => void }) {
  const params = new URLSearchParams(route.split("?")[1] || "");
  const spec = params.get("spec") || "cardio";
  const caseIdx = parseInt(params.get("case") || "0", 10) || 0;
  const caseList = CASES[spec] || [];
  const simCase = caseList[caseIdx] || caseList[0] || null;
  const specInfo = SPECIALTIES.find(s => s.id === spec) || null;

  const [messages, setMessages] = useState<{from: 'ai'|'user', text: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);

  // Fetch initial patient message from backend
  useEffect(() => {
    const fetchPatientMessage = async () => {
      try {
        const response = await fetch(`http://localhost:8000/llm/${spec}`);
        if (!response.ok) throw new Error('Failed to fetch patient message');
        const data = await response.json();
        setMessages([{ from: 'ai', text: data.patient_start_sentence }]);
      } catch (error) {
        console.error('Error fetching patient message:', error);
        setMessages([{ from: 'ai', text: 'Unable to load patient response. Please try again.' }]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchPatientMessage();
  }, [spec]);

  return (
    <div className="sim-page">
      <header className="sim-header">
        <button className="btn-secondary" onClick={onBack}>← Back</button>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          <div style={{fontSize:22}}>{specInfo ? specInfo.icon : '⚕️'}</div>
          <div>
            <div className="panel-specialty">{specInfo ? specInfo.name : spec.toUpperCase()}</div>
            <div className="sim-sub">Simulation</div>
          </div>
        </div>
      </header>

      <main className="sim-main">
        <section className="sim-chat">
          <div className="chat-body">
            {messages.map((m, i) => (
              <div key={i} className={`chat-message ${m.from}`}>
                <strong>{m.from === 'ai' ? 'Patient' : 'You'}:</strong> {m.text}
              </div>
            ))}
          </div>
          <ChatInput onSend={(text) => {
            if (isWaitingForResponse) return; // Prevent duplicate requests
            
            setIsWaitingForResponse(true);
            setMessages((prevMessages) => [...prevMessages, { from: 'user', text }]);
            
            const requestBody = {
              specialty: spec,
              user_message: text,
              history: messages.map(m => ({ from_: m.from, text: m.text }))
            };
            
            fetch('http://localhost:8000/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody)
            })
            .then(res => res.json())
            .then(data => {
              setMessages((s) => [...s, { from: 'ai', text: data.patient_response }]);
            })
            .catch(err => {
              console.error('Chat error:', err);
              setMessages((s) => [...s, { from: 'ai', text: 'Error getting response from AI.' }]);
            })
            .finally(() => {
              setIsWaitingForResponse(false);
            });
          }} />
        </section>
      </main>
    </div>
  );
}

/* ─── Data ─────────────────────────────────────────────────── */
type Tag = "surgical" | "internal" | "diagnostics" | "emergency" | "neuro";

interface Specialty {
  id: string;
  name: string;
  icon: string;
  desc: string;
  tag: Tag;
  cases: number;
  animDelay: number;
}

const SPECIALTIES: Specialty[] = [
  { id: "cardio", name: "Cardiology", icon: "🫀", desc: "Heart disease, arrhythmias, interventional procedures.", tag: "internal", cases: 340, animDelay: 0 },
  { id: "pulmo", name: "Pulmonology", icon: "🫁", desc: "Respiratory conditions, COPD, asthma management.", tag: "internal", cases: 218, animDelay: 50 },
  { id: "neuro", name: "Neurology", icon: "🧠", desc: "Stroke, epilepsy, movement and peripheral nerve disorders.", tag: "neuro", cases: 285, animDelay: 0 },
];

const FILTERS: { label: string; value: string }[] = [
  { label: "All",         value: "all"        },
  { label: "Internal",    value: "internal"   },
  { label: "Surgical",    value: "surgical"   },
  { label: "Emergency",   value: "emergency"  },
  { label: "Neuro",       value: "neuro"      },
  { label: "Diagnostics", value: "diagnostics"},
];

/* ─── Component ────────────────────────────────────────────── */
function App() {
  const [selected, setSelected]   = useState<Specialty | null>(null);
  const [filter, setFilter]       = useState("all");
  const [search, setSearch]       = useState("");
  const [selectedCaseIndex, setSelectedCaseIndex] = useState<number | null>(null);
  const [route, setRoute] = useState<string>(window.location.pathname + window.location.search);

  const currentCaseList = selected ? (CASES[selected.id] || []) : [];
  const currentCase = (selectedCaseIndex != null && currentCaseList[selectedCaseIndex]) || null;
  /* Mouse-tracking shimmer on cards */
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width)  * 100;
    const my = ((e.clientY - rect.top)  / rect.height) * 100;
    card.style.setProperty("--mx", `${mx}%`);
    card.style.setProperty("--my", `${my}%`);
  };

  const filtered = useMemo(() => {
    return SPECIALTIES.filter((s) => {
      const matchesFilter = filter === "all" || s.tag === filter;
      const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
                            s.desc.toLowerCase().includes(search.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [filter, search]);

  /* Dismiss panel on Escape */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setSelectedCaseIndex(null);
        // navigate home
        history.pushState({}, "", "/");
        setRoute(window.location.pathname + window.location.search);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // route-level short-circuit: if navigating to simulation, render that page
  if (route.startsWith("/simulation")) {
    return <SimulationPage route={route} onBack={() => { history.pushState({}, "", "/"); setRoute(window.location.pathname + window.location.search); }} />;
  }

  return (
    <div className="app-shell">
      {/* Background effects */}
      <div className="bg-grid" />
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />

      {/* Header */}
      <header className="header">
        <div className="logo-mark">
          <div className="logo-icon">⚕️</div>
          <div className="logo-text">Med<span>Sim</span> AI</div>
        </div>
        <div className="header-badge">v2.0 BETA</div>
      </header>

      {/* Hero */}
      <section className="hero-section">
        <div className="hero-eyebrow">
          <span className="eyebrow-dot" />
          Clinical Simulation Platform
        </div>
        <h1 className="hero-title">
          Choose your <em>Specialty</em>
        </h1>
        <p className="hero-sub">
          Immersive AI-driven simulations across 29 medical specialties.
          Practice, diagnose, and refine your clinical reasoning.
        </p>
        <div className="hero-stats">
          <div className="stat">
            <span className="stat-value">29</span>
            <span className="stat-label">Specialties</span>
          </div>
          <div className="stat-sep" />
          <div className="stat">
            <span className="stat-value">5K+</span>
            <span className="stat-label">Case Scenarios</span>
          </div>
          <div className="stat-sep" />
          <div className="stat">
            <span className="stat-value">AI</span>
            <span className="stat-label">Powered</span>
          </div>
        </div>
      </section>

      {/* Search */}
      <div className="search-wrap">
        <span className="search-icon">🔍</span>
        <input
          className="search-input"
          type="text"
          placeholder="Search specialties…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filter Pills */}
      <div className="filter-row">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`filter-pill${filter === f.value ? " active" : ""}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="specialty-grid">
        {filtered.length === 0 && (
          <div className="empty-state">No specialties match your search.</div>
        )}
        {filtered.map((s, i) => (
          <div
            key={s.id}
            className={`specialty-card${selected?.id === s.id ? " selected" : ""}`}
            style={{ animationDelay: `${i * 40}ms` }}
            onClick={() => {
              const newSel = s.id === selected?.id ? null : s;
              setSelected(newSel);
              setSelectedCaseIndex(null);
            }}
            onMouseMove={handleMouseMove}
          >
            <div className="card-header">
              <span className="card-icon" style={{ animationDelay: `${i * 200}ms` }}>
                {s.icon}
              </span>
              <span className={`card-tag tag-${s.tag}`}>{s.tag}</span>
            </div>
            <div className="card-name">{s.name}</div>
            <div className="card-desc">{s.desc}</div>
            <div className="card-footer">
              <div className="card-cases">
                <span className="card-cases-dot" />
                {s.cases} cases
              </div>
              <div className="card-arrow">→</div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Action Panel */}
      <div className={`action-panel${selected ? " visible" : ""}`}>
        <div className="panel-info">
          <div className="panel-label">Selected Specialty</div>
          <div className="panel-specialty">
            {selected ? `${selected.icon}  ${selected.name}` : "—"}
          </div>
        </div>
        {currentCase && (
          <div className="panel-case">
            <div className="case-title">{currentCase.presenting_complaint}</div>
            <div className="case-patient">{currentCase.patient_persona.name} — {currentCase.patient_persona.age}yo {currentCase.patient_persona.sex}</div>
            <div className="case-tags">{(currentCase.metadata?.tags || []).join(", ")}</div>
            <div className="case-dx"><strong>Likely Diagnosis:</strong> {currentCase.hidden_diagnosis}</div>
          </div>
        )}
        <div className="panel-actions">
          <button className="btn-secondary" onClick={() => { setSelected(null); setSelectedCaseIndex(null); }}>
            Clear
          </button>
          <button className="btn-primary" onClick={() => {
            // ensure a case is chosen
            const caseIdx = (currentCaseList.length > 0 && selectedCaseIndex == null) ? 0 : selectedCaseIndex ?? 0;
            if (!selected) return;
            // navigate to simulation page with query params
            const url = `/simulation?spec=${encodeURIComponent(selected.id)}&case=${caseIdx}`;
            history.pushState({}, "", url);
            setRoute(window.location.pathname + window.location.search);
          }}>
            ▶ &nbsp;Start Simulation
          </button>
        </div>
        <div className="panel-case-picker">
          {currentCaseList.slice(0,3).map((c, idx) => (
            <label key={c.case_id} className={`case-option${selectedCaseIndex===idx?" selected":""}`}>
              <input type="radio" name="case" checked={selectedCaseIndex===idx} onChange={() => setSelectedCaseIndex(idx)} />
              <div className="case-meta">
                <div className="case-title-small">{c.presenting_complaint}</div>
                <div className="case-sub">{c.patient_persona.name} — {c.patient_persona.age}yo</div>
              </div>
            </label>
          ))}
        </div>
        {/* nothing: simulation page rendered at route /simulation */}
      </div>
  
    </div>
  );
}

export default App;