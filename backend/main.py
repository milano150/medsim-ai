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

active_cases = {}

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
# CASE LOADING & GENERATION
# --------------------------------------------------

def generate_patient_persona(case: dict) -> dict:
    generator = case.get("patient_generator", {})

    age_range = generator.get("age_range", [18, 90])
    age = random.randint(age_range[0], age_range[1])

    sex = random.choice(generator.get("sexes", ["male", "female"]))
    occupation = random.choice(generator.get("occupations", ["teacher"]))

    prompt = f"""
Generate a realistic full human name.

Sex: {sex}
Age: {age}
Occupation: {occupation}

Rules:
- Return ONLY the full name
- No explanations
- No quotation marks
- Realistic modern name
"""

    try:
        name = call_llm(prompt).strip()
    except Exception:
        name = "Unknown Patient"

    return {
        "name": name,
        "age": age,
        "sex": sex,
        "occupation": occupation
    }


def generate_physical_exam(case: dict) -> dict:
    exam = case.get("physical_exam", {})

    generated = {}

    for section, findings in exam.items():
        if isinstance(findings, list):
            count = random.randint(1, min(2, len(findings)))
            generated[section] = random.sample(findings, count)

    return generated

def generate_vitals(case: dict) -> dict:
    """Generate randomized vitals from ranges."""
    ranges = case.get("vitals_ranges", {})
    vitals = {}
    
    if "systolic_bp" in ranges:
        sys, dia = ranges["systolic_bp"], ranges.get("diastolic_bp", [50, 100])
        systolic = random.randint(sys[0], sys[1])
        diastolic = random.randint(dia[0], dia[1])
        vitals["bp"] = f"{systolic}/{diastolic}"
    
    if "heart_rate" in ranges:
        hr_range = ranges["heart_rate"]
        vitals["hr"] = random.randint(hr_range[0], hr_range[1])
    
    if "resp_rate" in ranges:
        rr_range = ranges["resp_rate"]
        vitals["rr"] = random.randint(rr_range[0], rr_range[1])
    
    if "spo2" in ranges:
        spo2_range = ranges["spo2"]
        vitals["spo2"] = random.randint(spo2_range[0], spo2_range[1])
    
    if "temperature" in ranges:
        temp_range = ranges["temperature"]
        vitals["temp"] = round(random.uniform(temp_range[0], temp_range[1]), 1)
    
    return vitals


def generate_investigations(case: dict) -> dict:
    """Generate randomized investigation results."""
    inv = case.get("investigations", {})
    investigations = {}
    
    if "ecg_variants" in inv:
        investigations["ECG"] = random.choice(inv["ecg_variants"])
    
    if "troponin_range" in inv:
        troponin_range = inv["troponin_range"]
        troponin = round(random.uniform(troponin_range[0], troponin_range[1]), 2)
        investigations["Troponin"] = f"{troponin} ng/mL"
    
    if "chest_xray" in inv:
        investigations["Chest X-Ray"] = random.choice(inv["chest_xray"])
    
    if "lab_findings" in inv:
        findings = inv["lab_findings"]
        count = random.randint(1, len(findings))
        investigations["Lab Findings"] = ", ".join(random.sample(findings, count))
    
    return investigations


def generate_case_data(case: dict) -> dict:
    """Generate all randomized case data."""
    # Generate patient persona
    persona = generate_patient_persona(case)
    case["patient_persona"] = persona

    case["physical_exam"] = generate_physical_exam(case)
    
    # Select random presenting complaint
    variants = case.get("presentation_variants", [])
    if variants:
        case["presenting_complaint"] = random.choice(variants).get("presenting_complaint", case.get("presenting_complaint"))
    
    # Generate vitals
    case["vitals"] = generate_vitals(case)
    
    # Generate investigations
    case["investigations"] = generate_investigations(case)
    
    # Generate pain score
    pain_range = case.get("patient_generator", {}).get("pain_score_range", [1, 10])
    case["patient_response_rules"] = {
        "pain_score": random.randint(pain_range[0], pain_range[1])
    }
    
    # Populate history data
    history = case.get("history_data", {})
    if "pmh_pool" in history:
        risk_count = case.get("patient_generator", {}).get("risk_factor_count_range", [1, 3])
        count = random.randint(risk_count[0], risk_count[1])
        pmh = random.sample(history["pmh_pool"], min(count, len(history["pmh_pool"])))
        history["pmh"] = pmh
    
    if "medications_pool" in history:
        meds = history["medications_pool"]
        med_count = random.randint(1, min(3, len(meds)))
        history["medications"] = random.sample(meds, med_count)
    
    history["social"] = history.get("social_history", {})
    
    return case


def load_random_case(specialty: str):
    """Load a random case from a specialty folder and generate randomized data."""
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
        case = json.load(f)
    
    return generate_case_data(case)


def load_case_by_id(case_id: str):

    for case_file in BASE_CASES_PATH.rglob("*.json"):

        try:
            with open(case_file, "r", encoding="utf-8") as f:
                case = json.load(f)

            if case.get("case_id") == case_id:
                return generate_case_data(case)

        except Exception as e:
            print("\n===================")
            print("BROKEN FILE:")
            print(case_file)
            print(e)
            print("===================\n")
            raise

    raise HTTPException(
        status_code=404,
        detail=f"Case with id '{case_id}' not found"
    )



class ChatRequest(BaseModel):
    session_id: str
    question: str


class DiagnoseRequest(BaseModel):
    session_id: str
    diagnosis: str
    time_taken: str


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


@app.post("/start/{case_id}")
def start_case(case_id: str):

    case = load_case_by_id(case_id)

    session_id = str(random.randint(100000, 999999))

    active_cases[session_id] = case

    return {
        "session_id": session_id,
        "patient": {
            "name": case["patient_persona"]["name"],
            "age": case["patient_persona"]["age"],
            "sex": case["patient_persona"]["sex"],
            "occupation": case["patient_persona"]["occupation"]
        }
    }

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

@app.post("/chat")
def chat_patient(body: ChatRequest):

    question = body.question.strip()

    if not question:
        raise HTTPException(
            status_code=400,
            detail="Question must not be empty"
        )

    case = active_cases.get(body.session_id)

    if not case:
        raise HTTPException(
            status_code=404,
            detail="Session not found"
        )

    prompt = build_patient_chat_prompt(
        case,
        question
    )

    response_text = call_llm(prompt)

    return {
        "answer": response_text,
        "suggestions": suggest_checks(case),
    }

@app.post("/diagnose/{case_id}")
def score_diagnosis(case_id: str, body: DiagnoseRequest):
    diagnosis = body.diagnosis.strip()
    if not diagnosis:
        raise HTTPException(status_code=400, detail="Diagnosis must not be empty")

    case = active_cases.get(body.session_id)

    if not case:
        raise HTTPException(
            status_code=404,
            detail="Session not found"
        )
    hidden_diagnosis = case.get("hidden_diagnosis", "")
    keywords = case.get("scoring_rubric", {}).get("correct_diagnosis_keywords", [])
    persona = case.get("patient_persona", {})

    prompt = f"""You are a medical education scoring assistant. A medical student submitted a diagnosis for a simulated patient case.

Hidden correct diagnosis: "{hidden_diagnosis}"
Correct diagnosis keywords: {json.dumps(keywords)}
Student's diagnosis: "{diagnosis}"
Time taken: {body.time_taken}

Evaluate the student's diagnosis and respond ONLY with a valid JSON object (no markdown, no backticks, no extra text) in this exact format:
{{"score": <number 0-100>, "feedback": "<2-3 sentence constructive feedback explaining the score, what was right and what was missed>", "patientReaction": "<a short in-character message the patient named {persona.get('name', 'the patient')} would say, thankful if score > 75, disappointed if score <= 75>"}}

Scoring criteria:
- 90-100: Exact or near-exact match with correct diagnosis
- 70-89: Correct general diagnosis but missing specifics (e.g. "heart attack" vs "STEMI")
- 50-69: Partially correct, related condition identified
- 25-49: Some relevant medical thinking but wrong diagnosis
- 0-24: Completely incorrect or unrelated diagnosis"""

    raw = call_llm(prompt)

    try:
        clean = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(clean)
        return {
            "score": parsed.get("score", 0),
            "feedback": parsed.get("feedback", ""),
            "patientReaction": parsed.get("patientReaction", ""),
        }
    except Exception:
        raise HTTPException(status_code=502, detail=f"Failed to parse scoring response: {raw}")