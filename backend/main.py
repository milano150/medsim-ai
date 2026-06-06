import os
import json
import random
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from anthropic import Anthropic, HUMAN_PROMPT, AI_PROMPT

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_CASES_PATH = Path("../cases")

CLAUDE_API_KEY = os.environ.get("CLAUDE_API_KEY")
if not CLAUDE_API_KEY:
    raise RuntimeError("CLAUDE_API_KEY must be set")

anthropic_client = Anthropic(api_key=CLAUDE_API_KEY)

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

def build_claude_prompt(case: dict) -> str:
    return f"""
You are a medical simulation assistant. Analyze the case and suggest the next best steps.

Patient:
- Name: {case["patient_persona"]["name"]}
- Age: {case["patient_persona"]["age"]}
- Sex: {case["patient_persona"]["sex"]}
- Occupation: {case["patient_persona"]["occupation"]}

Complaint:
{case["presenting_complaint"]}

History:
{case.get("history", "")}

Physical exam:
{case.get("physical_exam", "")}

Labs / tests:
{case.get("laboratory_findings", "")}

Instructions:
1. Summarize the case.
2. Give a differential diagnosis.
3. Recommend the next best tests or management.
"""

@app.get("/")
def home():
    return {
        "message": "MedSim Backend Running"
    }


@app.get("/specialty/{specialty}")
def get_random_case(specialty: str):
    case = load_random_case(specialty)
    prompt = build_claude_prompt(case)

    response = anthropic_client.completions.create(
        model="claude-3.5",
        prompt=f"{HUMAN_PROMPT}{prompt}{AI_PROMPT}",
        max_tokens_to_sample=800,
    )

    return {
        "case_id": case.get("case_id"),
        "specialty": specialty,
        "claude_output": response["completion"],
    }