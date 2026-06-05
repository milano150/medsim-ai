import { useState } from "react";

function App() {
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [patient, setPatient] = useState<any>(null);

  const specialties = [
    "Cardiology",
    "Pulmonology",
    "Neurology",
  ];

  const startSimulation = async () => {
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/specialty/${selectedSpecialty.toLowerCase()}`
      );

      const data = await response.json();

      console.log(data);

      setPatient(data);
    } catch (error) {
      console.error("Error:", error);
    }
  };

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

      {!patient ? (
        <>
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
                onClick={startSimulation}
                style={{
                  padding: "10px 20px",
                  marginTop: "10px",
                }}
              >
                Start Simulation
              </button>
            </div>
          )}
        </>
      ) : (
        <div>
          <h2>{patient.name}</h2>
          <p>Age: {patient.age}</p>
          <p>Sex: {patient.sex}</p>
          <p>Occupation: {patient.occupation}</p>
          <p>
            <strong>Complaint:</strong> {patient.complaint}
          </p>
        </div>
      )}
    </div>
  );
}

export default App;