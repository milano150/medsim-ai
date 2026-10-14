# MedSim AI

MedSim AI is a full-stack medical simulation platform designed to help users practice clinical reasoning in a realistic, interactive environment. The application presents patients from multiple medical specialties, lets users interview the patient, order investigations, and submit diagnoses and management plans, then provides feedback and a structured debrief. 

This project was developed as a collaborative effort by Milan Promod, Rithvik Chandra and Kushal Malempati during our summer internship at Gallopix.


## Overview

MedSim AI combines:
- a React + TypeScript frontend for the simulation experience,
- a FastAPI backend for case generation, chat responses, diagnosis scoring, and debriefing,
- an optional PostgreSQL database for persisting session and debrief data,
- and Groq-powered LLM interactions for dynamic patient dialogue and feedback.

The platform currently supports cases in:
- Cardiology
- Pulmonology
- Neurology

## Key Features

- Interactive medical case simulation
- Patient conversation flow with guided prompts
- Dynamic vitals and investigation reveal system
- Diagnosis submission with scoring and feedback
- Structured debriefing with competency-based evaluation
- Session history and prior performance tracking

## Project Structure

- backend/ - FastAPI application, case generation logic, scoring, and API routes
- frontend/ - Vite + React frontend for the simulation UI
- cases/ - JSON case definitions for different specialties
- schema.sql - Database schema for sessions and debrief results
- docker-compose.yml - Containerized setup for backend, frontend, and database
- test_integration.py - Basic integration checks for case data and randomization

## Tech Stack

### Frontend
- React
- TypeScript
- Vite
- CSS

### Backend
- Python
- FastAPI
- Pydantic
- Groq API
- PostgreSQL

## Run a Local MVP (No Docker or Database)

### Prerequisites

- Python 3.10+
- Node.js 20.19+ or 22.12+
- A Groq API key

Create `backend/.env` with your Groq API key. Do not set `DATABASE_URL` for this no-database mode:

```env
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=qwen/qwen3.8-27b
```

If `backend/.env` already has a `DATABASE_URL` entry, remove it or comment it out to disable database storage.

Start the backend in one Terminal window:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Start the frontend in a second Terminal window:

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. The backend API is at http://localhost:8000.

Without `DATABASE_URL`, simulations and debriefs run without SQL storage. Session history is unavailable, and active sessions are kept only in memory and are lost when the backend stops.

## Docker Setup (Persistent History)

### Prerequisites

- Docker and Docker Compose
- Python 3.10+
- Node.js 18+

### 1. Clone the repository

```bash
git clone <repository-url>
cd medsim-ai
```

### 2. Configure environment variables

Create a backend/.env file with the required values, including:

```env
GROQ_API_KEY=your_groq_api_key
DATABASE_URL=postgresql://postgres:postgres@db:5432/medsim
```

### 3. Run with Docker Compose

```bash
docker compose up --build
```

This will start:
- the PostgreSQL database on port 5432
- the backend API on port 8000
- the frontend on port 5173

### 4. Access the application

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000

## Development Notes

### Backend

To run the backend locally:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend

To run the frontend locally:

```bash
cd frontend
npm install
npm run dev
```

## Database

The application uses PostgreSQL to store session metadata and debrief results. The schema is defined in schema.sql and includes tables for:
- sessions
- debrief_results

## Testing

A simple integration test script is included:

```bash
python test_integration.py
```

## License

This project is intended for educational and demonstration purposes.
