import os
import json
import random
import re
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from groq import Groq
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load environment variables from the backend package directory
dotenv_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=dotenv_path)

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
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")

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


def load_case_by_id(case_id: str):
    for case_file in BASE_CASES_PATH.rglob("*.json"):
        with open(case_file, "r", encoding="utf-8") as f:
            case = json.load(f)
            if case.get("case_id") == case_id:
                return case

    raise HTTPException(
        status_code=404,
        detail=f"Case with id '{case_id}' not found"
    )

class ChatRequest(BaseModel):
    question: str


def normalize_text(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


def answer_for_field(value) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if item)
    if isinstance(value, dict):
        return ", ".join(f"{key}: {val}" for key, val in value.items() if val)
    return str(value)


def find_direct_case_answer(question: str, case: dict) -> Optional[str]:
    q = normalize_text(question)
    persona = case.get("patient_persona", {})
    history = case.get("history_data", {})
    vitals = case.get("vitals", {})
    investigations = case.get("investigations", {})

    candidates = [
        ("who|who are you|what is your name|your name|name", f"I'm {persona.get('name', 'the patient')}. I'm a {persona.get('age', 'young')} year-old {persona.get('occupation', 'student')}.") ,
        ("how old|what is your age|age", f"I'm {persona.get('age', 'unsure')} years old."),
        ("sex|gender", f"I'm {persona.get('sex', 'not sure')}"),
        ("occupation|job|work|what do you do", f"I'm a {persona.get('occupation', 'student')}.") ,
        ("presenting complaint|chief complaint|what brings|why am i here|here today", f"I've had {case.get('presenting_complaint', '').lower()}"),
        ("feel|feeling|how are you|how do you feel", history.get("hpi")),
        ("asthma|history of asthma|childhood asthma|allergies|seasonal allergies|pmh|past medical history", answer_for_field(history.get("pmh", []))),
        ("medication|inhaler|salbutamol|drug", answer_for_field(history.get("medications", []))),
        ("smoke|smoking", history.get("social", {}).get("smoking")),
        ("alcohol", history.get("social", {}).get("alcohol")),
        ("exercise", history.get("social", {}).get("exercise")),
        ("blood pressure|bp", vitals.get("bp")),
        ("heart rate|hr|pulse", vitals.get("hr")),
        ("respiratory rate|rr", vitals.get("rr")),
        ("oxygen|spo2|saturation", vitals.get("spo2")),
        ("temperature|temp|fever", vitals.get("temp")),
        ("peak flow", investigations.get("Peak Flow")),
        ("chest x-ray|x-ray|xray", investigations.get("Chest X-Ray")),
        ("cbc", investigations.get("CBC")),
        ("pain|pain score", f"I have a pain score of {case.get('patient_response_rules', {}).get('pain_score', 0)} out of 10."),
    ]

    for keywords, answer in candidates:
        if not answer:
            continue
        pattern = re.compile(r"\b(?:" + keywords + r")\b")
        if pattern.search(q):
            return str(answer)

    case_text = normalize_text(json.dumps(case))
    case_tokens = set(token for token in case_text.split() if len(token) > 4)
    question_tokens = set(token for token in q.split() if len(token) > 4)
    overlap = case_tokens.intersection(question_tokens)

    if overlap and len(overlap) >= 2:
        for value in [case.get("presenting_complaint"), history.get("hpi"), answer_for_field(history.get("pmh", [])), answer_for_field(history.get("medications", [])), answer_for_field(history.get("social", {})), answer_for_field(vitals), answer_for_field(investigations)]:
            if value and any(token in normalize_text(str(value)) for token in overlap):
                return str(value)

    return None


def suggest_checks(case: dict) -> List[str]:
    investigations = case.get("investigations", {})
    if investigations:
        return list(investigations.keys())

    return [
        "Physical exam",
        "Basic vital signs",
        "Relevant lab tests"
    ]


def build_patient_chat_prompt(case: dict, question: str) -> str:
    persona = case.get("patient_persona", {})
    history = case.get("history_data", {})
    vitals = case.get("vitals", {})
    investigations = case.get("investigations", {})

    return f"""
You are a patient in a medical simulation. Respond naturally as the patient would.
Keep responses brief and realistic - typically 1-2 sentences per response.
Stay in character as the patient.
Do not diagnose or explain medical details.
React emotionally appropriately to the doctor's questions.
When answering, make your response creative and personal while staying realistic.
Use varied, warm language and avoid sounding repetitive.
Study the case carefully and use only the details from the JSON file.
Do not reveal the diagnosis.
Do not invent new symptoms, medications, or test results.
You are not a doctor and you do not know your exact vitals or investigation results.
If the doctor asks about vitals or tests, say you are not sure about the numbers and that you trust the medical team.
If you do not have enough information in the case to answer something, say so gently and stay in character.
Keep your answers simple and personal, as if you are really talking to your doctor.

Patient details:
Name: {persona.get('name')}
Age: {persona.get('age')}
Sex: {persona.get('sex')}
Occupation: {persona.get('occupation')}
Presenting complaint: {case.get('presenting_complaint')}
History: {history.get('hpi')}
Past medical history: {answer_for_field(history.get('pmh', []))}
Medications: {answer_for_field(history.get('medications', []))}
Social history: {answer_for_field(history.get('social', {}))}

Doctor: "{question}"
Patient:"""

def build_patient_prompt(case: dict) -> str:
    persona = case.get("patient_persona", {})
    history = case.get("history_data", {})

    return f"""
You are a patient in a medical simulation. Respond naturally as the patient would.
Keep responses brief and realistic - typically 1-2 sentences per response.
Stay in character as the patient.
Do not diagnose or explain medical details.
React emotionally appropriately to the doctor's questions.
When answering, make your response creative and personal while staying realistic.
Use varied, warm language and avoid sounding repetitive.
Answer the doctor's first opening question in a natural way, using one to two sentences.
Speak in the first person and describe your symptoms honestly.
Do not invent new details.
If asked about vitals or investigation results, say you are not sure about those values.

Patient:
Name: {persona.get('name')}
Age: {persona.get('age')}
Sex: {persona.get('sex')}
Occupation: {persona.get('occupation')}

Presenting Complaint:
{case.get('presenting_complaint')}

History:
{history.get('hpi', '')}

Physical Exam:
{case.get('physical_exam', '')}

Laboratory Findings:
{case.get('laboratory_findings', '')}

Doctor: "What brings you in today?"
Patient:"""

# --------------------------------------------------
# GROQ / LLAMA
# --------------------------------------------------

def call_llm(prompt: str) -> str:
    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            temperature=1.0,
            max_tokens=250,
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
        "model": GROQ_MODEL
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
        "vitals": case.get("vitals", {}),
        "investigations": case.get("investigations", {}),
        "red_flags": case.get("scoring_rubric", {}).get("red_flags", []),
    }

@app.get("/llm/{case_id}")
def generate_patient_sentence(case_id: str):
    case = load_case_by_id(case_id)

    prompt = build_patient_chat_prompt(case, "What brings you in today?")

    response_text = call_llm(prompt)

    return {
        "case_id": case.get("case_id"),
        "patient_start_sentence": response_text,
    }

@app.post("/chat/{case_id}")
def chat_patient(case_id: str, body: ChatRequest):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty")

    case = load_case_by_id(case_id)
    prompt = build_patient_chat_prompt(case, question)
    response_text = call_llm(prompt)

    return {
        "answer": response_text,
        "suggestions": suggest_checks(case),
    }