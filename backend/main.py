import os
import json
import random
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_CASES_PATH = Path(__file__).resolve().parent.parent / "cases"

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY must be set")

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")
client = genai.Client(api_key=GEMINI_API_KEY)

def load_random_case(specialty: str):
    specialty_folder = BASE_CASES_PATH / specialty.lower()
    if not specialty_folder.exists():
        raise HTTPException(status_code=404, detail="Specialty not found")

    case_files = list(specialty_folder.glob("*.json"))
    if not case_files:
        raise HTTPException(status_code=404, detail="No cases found")

    selected_file = random.choice(case_files)
    with open(selected_file, "r", encoding="utf-8") as f:
        return json.load(f)

def build_gemini_prompt(case: dict) -> str:
    return f"""
You are a medical simulation assistant creating a realistic patient opening statement.

Use the case details below to write exactly one sentence spoken by the patient as they first begin describing their complaint.
Do not add analysis, instructions, or extra text.
Only output the patient's first sentence.

Patient:
- Name: {case['patient_persona']['name']}
- Age: {case['patient_persona']['age']}
- Sex: {case['patient_persona']['sex']}
- Occupation: {case['patient_persona']['occupation']}

Presenting complaint:
{case['presenting_complaint']}

History:
{case.get('history', '')}

Physical exam:
{case.get('physical_exam', '')}

Laboratory findings:
{case.get('laboratory_findings', '')}
"""


def call_gemini(prompt: str) -> str:
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0.2,
            ),
        )
        return response.text
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini API error: {str(exc)}",
        ) from exc


@app.get("/")
def home():
    return {
        "message": "MedSim Backend Running"
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


@app.get("/gemini/{specialty}")
def gemini_case(specialty: str):
    case = load_random_case(specialty)
    prompt = build_gemini_prompt(case)
    response_text = call_gemini(prompt)

    return {
        "case_id": case.get("case_id"),
        "specialty": specialty,
        "patient_start_sentence": response_text.strip(),
    }