import { useState } from "react";

function App() {
  const [selectedSpecialty, setSelectedSpecialty] = useState("");

  const specialties = [
    "Cardiology",
    "Pulmonology",
    "Neurology",
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "50px",
      }}
    >
      <h1>MedSim AI</h1>

      <h2>Choose a Specialty</h2>

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
            }}
          >
            {specialty}
          </button>
        ))}
      </div>

      {selectedSpecialty && (
        <div style={{ marginTop: "30px" }}>
          <h3>Selected: {selectedSpecialty}</h3>

          <button
            style={{
              padding: "10px 20px",
              marginTop: "10px",
            }}
          >
            Start Simulation
          </button>
        </div>
      )}
    </div>
  );
}

export default App;