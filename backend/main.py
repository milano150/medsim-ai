import os
import json
import random
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables
load_dotenv()

app = FastAPI(title="MedSim Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------
# CONFIG
# --------------------------------------------------

BASE_CASES_PATH = Path(__file__).resolve().parent.parent / "cases"

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY must be set in .env")

client = Groq(api_key=GROQ_API_KEY)

# --------------------------------------------------
# CASE LOADING
# --------------------------------------------------

def load_random_case(specialty: str):
    specialty_folder = BASE_CASES_PATH / specialty.lower()

    if not specialty_folder.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Specialty '{specialty}' not found"
        )

    case_files = list(specialty_folder.glob("*.json"))

    if not case_files:
        raise HTTPException(
            status_code=404,
            detail=f"No cases found for specialty '{specialty}'"
        )

    selected_file = random.choice(case_files)

    with open(selected_file, "r", encoding="utf-8") as f:
        return json.load(f)

# --------------------------------------------------
# PROMPT CREATION
# --------------------------------------------------

def build_patient_prompt(case: dict) -> str:
    return f"""
You are roleplaying as a patient in a medical simulation.

Generate exactly ONE sentence.

The sentence should be the first thing the patient says when the doctor asks:

"What brings you in today?"

Do not explain.
Do not diagnose.
Do not add extra text.
Only output the patient's sentence.

Patient:
Name: {case['patient_persona']['name']}
Age: {case['patient_persona']['age']}
Sex: {case['patient_persona']['sex']}
Occupation: {case['patient_persona']['occupation']}

Presenting Complaint:
{case['presenting_complaint']}

History:
{case.get('history', '')}

Physical Exam:
{case.get('physical_exam', '')}

Laboratory Findings:
{case.get('laboratory_findings', '')}
"""

# --------------------------------------------------
# GROQ / LLAMA
# --------------------------------------------------

def call_llm(prompt: str) -> str:
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            temperature=0.2,
            max_tokens=100,
        )

        return response.choices[0].message.content.strip()

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Groq API error: {str(exc)}"
        ) from exc

# --------------------------------------------------
# ROUTES
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "MedSim Backend Running",
        "model": "llama-3.3-70b-versatile"
    }

@app.get("/specialty/{specialty}")
def get_random_case(specialty: str):
    case = load_random_case(specialty)

    return {
        "case_id": case.get("case_id"),
        "specialty": case["metadata"]["specialty"],
        "name": case["patient_persona"]["name"],
        "age": case["patient_persona"]["age"],
        "sex": case["patient_persona"]["sex"],
        "occupation": case["patient_persona"]["occupation"],
        "complaint": case["presenting_complaint"],
    }

@app.get("/llm/{specialty}")
def generate_patient_sentence(specialty: str):
    case = load_random_case(specialty)

    prompt = build_patient_prompt(case)

    response_text = call_llm(prompt)

    return {
        "case_id": case.get("case_id"),
        "specialty": specialty,
        "patient_start_sentence": response_text,
    }