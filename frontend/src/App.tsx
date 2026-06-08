import { useState } from "react";

function App() {
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [patient, setPatient] = useState<any>(null);
  const [patientOpening, setPatientOpening] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const specialties = [
    "Cardiology",
    "Pulmonology",
    "Neurology",
  ];

  const startSimulation = async () => {
    setLoading(true);
    try {
      // Get case details
      const caseResponse = await fetch(
        `http://127.0.0.1:8001/specialty/${selectedSpecialty.toLowerCase()}`
      );
      const caseData = await caseResponse.json();
      setPatient(caseData);

      // Get AI-generated patient opening
      const llmResponse = await fetch(
        `http://127.0.0.1:8001/llm/${selectedSpecialty.toLowerCase()}`
      );
      const llmData = await llmResponse.json();
      setPatientOpening(llmData.patient_start_sentence);
    } catch (error) {
      console.error("Error:", error);
      setPatient(null);
      setPatientOpening("");
    } finally {
      setLoading(false);
    }
  };

  const resetSimulation = () => {
    setSelectedSpecialty("");
    setPatient(null);
    setPatientOpening("");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "50px",
        backgroundColor: "#f9f9f9",
        color: "#333",
      }}
    >
      <h1 style={{ color: "#333", marginBottom: "20px" }}>MedSim AI</h1>

      {!patient ? (
        <>
          <h2 style={{ color: "#333", marginBottom: "20px" }}>Choose a Specialty</h2>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              width: "250px",
            }}
          >
            {specialties.map((specialty) => (
              <button
                key={specialty}
                onClick={() => setSelectedSpecialty(specialty)}
                style={{
                  padding: "12px",
                  cursor: "pointer",
                  backgroundColor:
                    selectedSpecialty === specialty ? "#007bff" : "#f0f0f0",
                  color: selectedSpecialty === specialty ? "white" : "black",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                {specialty}
              </button>
            ))}
          </div>

          {selectedSpecialty && (
            <div style={{ marginTop: "30px" }}>
              <h3 style={{ color: "#333", marginBottom: "15px" }}>Selected: {selectedSpecialty}</h3>

              <button
                onClick={startSimulation}
                disabled={loading}
                style={{
                  padding: "10px 20px",
                  marginTop: "10px",
                  cursor: loading ? "not-allowed" : "pointer",
                  backgroundColor: loading ? "#ccc" : "#28a745",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                {loading ? "Loading..." : "Start Simulation"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            maxWidth: "600px",
            padding: "20px",
            border: "1px solid #ddd",
            borderRadius: "8px",
            backgroundColor: "#fff",
            color: "#333",
          }}
        >
          <div style={{ marginBottom: "20px" }}>
            <h2 style={{ color: "#333" }}>{patient.name}</h2>
            <p style={{ color: "#555" }}>
              <strong>Age:</strong> {patient.age} years old
            </p>
            <p style={{ color: "#555" }}>
              <strong>Sex:</strong> {patient.sex}
            </p>
            <p style={{ color: "#555" }}>
              <strong>Occupation:</strong> {patient.occupation}
            </p>
            <p style={{ color: "#555" }}>
              <strong>Chief Complaint:</strong> {patient.complaint}
            </p>
          </div>

          <hr />

          <div style={{ marginTop: "20px", marginBottom: "20px" }}>
            <h3 style={{ color: "#333" }}>Patient Opening:</h3>
            {loading ? (
              <p style={{ fontStyle: "italic", color: "#666" }}>
                Generating patient statement...
              </p>
            ) : (
              <p
                style={{
                  fontSize: "16px",
                  fontStyle: "italic",
                  color: "#333",
                  padding: "10px",
                  backgroundColor: "#f5f5f5",
                  borderRadius: "4px",
                }}
              >
                {patientOpening}
              </p>
            )}
          </div>

          <button
            onClick={resetSimulation}
            style={{
              padding: "10px 20px",
              marginTop: "10px",
              cursor: "pointer",
              backgroundColor: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
            }}
          >
            Start New Simulation
          </button>
        </div>
      )}
    </div>
  );
}

export default App;