import os
import json
import random
import re
from pathlib import Path
from typing import List, Optional
import uuid

from dotenv import load_dotenv
from groq import Groq
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import databases




active_cases = {}

dotenv_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=dotenv_path)

app = FastAPI(title="MedSim Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INVESTIGATION_ALIASES = {
    "cxr": "chestxray",
    "chest xray": "chestxray",
    "chest x-ray": "chestxray",
    "chest radiograph": "chestxray",

    "cbc": "fbc",
    "full blood count": "fbc",
    "fbc": "fbc",

    "ecg": "ecg",
    "ekg": "ecg",

    "bnp": "bnp",
    "brain natriuretic peptide": "bnp",

    "ntprobnp": "ntprobnp",
    "nt-probnp": "ntprobnp",

    "echo": "echocardiogram",
    "echo cardiogram": "echocardiogram",
    "echocardiogram": "echocardiogram",
}
# --------------------------------------------------
# CONFIG
# --------------------------------------------------

DATABASE_URL = os.environ.get("DATABASE_URL")
db = databases.Database(DATABASE_URL)

@app.on_event("startup")
async def startup():
    await db.connect()

@app.on_event("shutdown")
async def shutdown():
    await db.disconnect()

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

    return {"name": name, "age": age, "sex": sex, "occupation": occupation}


def generate_physical_exam(case: dict) -> dict:
    exam = case.get("physical_exam", {})
    generated = {}
    for section, findings in exam.items():
        if isinstance(findings, list):
            count = random.randint(1, min(2, len(findings)))
            generated[section] = random.sample(findings, count)
    return generated


def generate_vitals(case: dict) -> dict:
    ranges = case.get("vitals_ranges", {})
    vitals = {}
    if "systolic_bp" in ranges:
        sys, dia = ranges["systolic_bp"], ranges.get("diastolic_bp", [50, 100])
        vitals["bp"] = f"{random.randint(sys[0], sys[1])}/{random.randint(dia[0], dia[1])}"
    if "heart_rate" in ranges:
        vitals["hr"] = random.randint(ranges["heart_rate"][0], ranges["heart_rate"][1])
    if "resp_rate" in ranges:
        vitals["rr"] = random.randint(ranges["resp_rate"][0], ranges["resp_rate"][1])
    if "spo2" in ranges:
        vitals["spo2"] = random.randint(ranges["spo2"][0], ranges["spo2"][1])
    if "temperature" in ranges:
        vitals["temp"] = round(random.uniform(ranges["temperature"][0], ranges["temperature"][1]), 1)
    return vitals



def generate_case_data(case: dict) -> dict:
    case["patient_persona"] = generate_patient_persona(case)
    case["physical_exam"] = generate_physical_exam(case)
    variants = case.get("presentation_variants", [])
    if variants:
        case["presenting_complaint"] = random.choice(variants).get("presenting_complaint", case.get("presenting_complaint"))
    case["vitals"] = generate_vitals(case)
    pain_range = case.get("patient_generator", {}).get("pain_score_range", [1, 10])
    case["patient_response_rules"] = {"pain_score": random.randint(pain_range[0], pain_range[1])}
    history = case.get("history_data", {})
    if "pmh_pool" in history:
        risk_count = case.get("patient_generator", {}).get("risk_factor_count_range", [1, 3])
        count = random.randint(risk_count[0], risk_count[1])
        history["pmh"] = random.sample(history["pmh_pool"], min(count, len(history["pmh_pool"])))
    if "medications_pool" in history:
        meds = history["medications_pool"]
        history["medications"] = random.sample(meds, random.randint(1, min(3, len(meds))))
    history["social"] = history.get("social_history", {})
    return case


def load_random_case(specialty: str):
    specialty_folder = BASE_CASES_PATH / specialty.lower()
    if not specialty_folder.exists():
        raise HTTPException(status_code=404, detail=f"Specialty '{specialty}' not found")
    case_files = list(specialty_folder.glob("*.json"))
    if not case_files:
        raise HTTPException(status_code=404, detail=f"No cases found for specialty '{specialty}'")
    with open(random.choice(case_files), "r", encoding="utf-8") as f:
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
            print(f"\nBROKEN FILE: {case_file}\n{e}\n")
            raise
    raise HTTPException(status_code=404, detail=f"Case with id '{case_id}' not found")


# --------------------------------------------------
# REQUEST / RESPONSE MODELS
# --------------------------------------------------

class ChatRequest(BaseModel):
    session_id: str
    question: str


class DiagnoseRequest(BaseModel):
    session_id: str
    diagnosis: str
    time_taken: str
    differential_1: Optional[str] = None
    differential_2: Optional[str] = None
    management_plan: Optional[str] = None


class DebriefRequest(BaseModel):
    session_id: str
    time_taken: str
    primary_diagnosis: str
    differential_1: Optional[str] = None
    differential_2: Optional[str] = None
    management_plan: Optional[str] = None
    ordered_investigations: List[str] = []
    transcript: List[dict] = []
    # Passed from /diagnose so debrief doesn't re-score independently
    diagnosis_score: int = 0
    management_score: int = 0
    management_matched: List[str] = []
    management_missed: List[str] = []


# --------------------------------------------------
# HELPERS
# --------------------------------------------------

def normalize_text(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


def answer_for_field(value) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if item)
    if isinstance(value, dict):
        return ", ".join(f"{key}: {val}" for key, val in value.items() if val)
    return str(value)

def normalize_investigation(name: str) -> str:
    key = (
        name.lower()
        .replace("-", "")
        .replace("_", "")
        .replace("(", "")
        .replace(")", "")
        .replace("/", "")
        .strip()
    )
    return INVESTIGATION_ALIASES.get(key, key)

def find_direct_case_answer(question: str, case: dict) -> Optional[str]:
    q = normalize_text(question)
    persona = case.get("patient_persona", {})
    history = case.get("history_data", {})
    vitals = case.get("vitals", {})
    investigations = case.get("investigations", {})

    candidates = [
        ("who|who are you|what is your name|your name|name", f"I'm {persona.get('name', 'the patient')}. I'm a {persona.get('age', 'young')} year-old {persona.get('occupation', 'student')}."),
        ("how old|what is your age|age", f"I'm {persona.get('age', 'unsure')} years old."),
        ("sex|gender", f"I'm {persona.get('sex', 'not sure')}"),
        ("occupation|job|work|what do you do", f"I'm a {persona.get('occupation', 'student')}."),
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
        for value in [case.get("presenting_complaint"), history.get("hpi"),
                      answer_for_field(history.get("pmh", [])), answer_for_field(history.get("medications", [])),
                      answer_for_field(history.get("social", {})), answer_for_field(vitals), answer_for_field(investigations)]:
            if value and any(token in normalize_text(str(value)) for token in overlap):
                return str(value)

    return None


def suggest_checks(case: dict) -> List[str]:
    investigations = case.get("investigations", {})
    if investigations:
        return list(investigations.keys())
    return ["Physical exam", "Basic vital signs", "Relevant lab tests"]


def build_patient_chat_prompt(case: dict, question: str) -> str:
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


# --------------------------------------------------
# GROQ / LLAMA
# --------------------------------------------------

def call_llm(prompt: str, max_tokens: int = 250) -> str:
    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=1.0,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Groq API error: {str(exc)}") from exc


def safe_parse_json(raw: str) -> dict:
    """Strip markdown fences and parse JSON, with fallback."""
    clean = raw.replace("```json", "").replace("```", "").strip()
    match = re.search(r"\{.*\}", clean, re.DOTALL)
    if match:
        clean = match.group(0)
    return json.loads(clean)


# --------------------------------------------------
# ROUTES
# --------------------------------------------------

@app.get("/")
def home():
    return {"message": "MedSim Backend Running", "model": GROQ_MODEL}


@app.post("/start/{case_id}")
async def start_case(case_id: str):
    case = load_case_by_id(case_id)
    session_id = str(uuid.uuid4())
    active_cases[session_id] = case

    await db.execute(
        """
        INSERT INTO sessions (session_id, case_id, specialty, patient_name, patient_age, patient_sex, hidden_diagnosis)
        VALUES (:session_id, :case_id, :specialty, :patient_name, :patient_age, :patient_sex, :hidden_diagnosis)
        """,
        {
            "session_id":       session_id,
            "case_id":          case_id,
            "specialty":        case["metadata"]["specialty"],
            "patient_name":     case["patient_persona"]["name"],
            "patient_age":      case["patient_persona"]["age"],
            "patient_sex":      case["patient_persona"]["sex"],
            "hidden_diagnosis": case.get("hidden_diagnosis", ""),
        }
    )

    return {
        "session_id": session_id,
        "patient": {
            "name": case["patient_persona"]["name"],
            "age": case["patient_persona"]["age"],
            "sex": case["patient_persona"]["sex"],
            "occupation": case["patient_persona"]["occupation"],
        },
        "hidden_diagnosis": case.get("hidden_diagnosis", ""),
        "acceptable_differentials": case.get("scoring_rubric", {}).get("acceptable_differentials", []),
        "management_actions": case.get("scoring_rubric", {}).get("management_actions", []),
        "abnormal_investigations": case.get("abnormal_investigations", {}),
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
        "abnormal_investigations": case.get("abnormal_investigations", {}),
    }


@app.get("/llm/{case_id}")
def generate_patient_sentence(case_id: str):
    case = load_case_by_id(case_id)
    prompt = build_patient_chat_prompt(case, "What brings you in today?")
    return {"case_id": case.get("case_id"), "patient_start_sentence": call_llm(prompt)}


@app.post("/chat")
def chat_patient(body: ChatRequest):
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question must not be empty")
    case = active_cases.get(body.session_id)
    if not case:
        raise HTTPException(status_code=404, detail="Session not found")
    prompt = build_patient_chat_prompt(case, body.question.strip())
    response_text = call_llm(prompt)
    return {"answer": response_text, "suggestions": suggest_checks(case)}


# --------------------------------------------------
# DIAGNOSIS SCORING
# --------------------------------------------------

@app.post("/diagnose/{case_id}")
def score_diagnosis(case_id: str, body: DiagnoseRequest):
    if not body.diagnosis.strip():
        raise HTTPException(status_code=400, detail="Diagnosis must not be empty")

    case = active_cases.get(body.session_id)
    if not case:
        raise HTTPException(status_code=404, detail="Session not found")

    hidden_diagnosis = case.get("hidden_diagnosis", "")
    keywords = case.get("scoring_rubric", {}).get("correct_diagnosis_keywords", [])
    differentials = case.get("scoring_rubric", {}).get("acceptable_differentials", [])
    management_actions = case.get("scoring_rubric", {}).get("management_actions", [])
    persona = case.get("patient_persona", {})

    has_extended = any([body.differential_1, body.differential_2, body.management_plan])

    if has_extended:
        prompt = f"""You are a fair and encouraging medical education scorer for MEDICAL STUDENTS who are still learning. Your job is to reward correct thinking, not penalise imperfect recall.

Always address the student directly in second person: "You identified...", "You correctly...", "Your diagnosis...", "You missed..." — never say "The student...".

Hidden correct diagnosis: "{hidden_diagnosis}"
Correct diagnosis keywords: {json.dumps(keywords)}
Acceptable differentials: {json.dumps(differentials)}
Expected management actions: {json.dumps(management_actions)}

Student's submission:
- Primary diagnosis: "{body.diagnosis}"
- Differential #1: "{body.differential_1 or 'not provided'}"
- Differential #2: "{body.differential_2 or 'not provided'}"
- Management plan: "{body.management_plan or 'not provided'}"
- Time taken: {body.time_taken}

PRIMARY DIAGNOSIS scoring (0-100):
  90-100: Exact match or correct with correct subtype/severity qualifier
  80-89:  Correct disease, missing minor subtype detail (e.g. "MI" vs "STEMI" = 82)
  65-79:  Correct organ system and mechanism, wrong specific label
  45-64:  Related condition, partially correct clinical reasoning
  20-44:  Some relevant thinking but wrong diagnosis
  0-19:   Completely unrelated

DIFFERENTIAL scoring:
Mark "accepted" if the differential is a clinically reasonable alternative for this presentation, even if not on the list. Only mark "incorrect" if it is completely unrelated to the presentation. Be generous — students are exploring.

MANAGEMENT scoring (0-100) — this is the most important section to be generous in:
  - Students are not consultants. Do not expect a complete protocol.
  - Score based on the INTENT and DIRECTION of their plan, not exact wording.
  - Award points per correct action category mentioned:
      * Immediate stabilisation (O2, IV access, monitoring) = 25 pts
      * Correct drug class or specific drug = 25 pts
      * Correct investigations or referral = 25 pts
      * Any other relevant action = 25 pts
  - "Aspirin and refer to cardiology" for an MI = at least 60/100, not 20.
  - "IV access, oxygen, aspirin" = at least 70/100.
  - Only score below 30 if the plan is completely wrong or dangerous.
  - A partial plan with correct intent should score 50-70.

Patient name: {persona.get('name', 'the patient')}

Respond ONLY with a valid JSON object, no markdown, no backticks:
{{
  "score": <0-100 primary diagnosis score>,
  "feedback": "<2-3 sentences in second person. Start by acknowledging what you got right, then note any gaps. Be encouraging.>",
  "patientReaction": "<1-2 sentences in character as {persona.get('name', 'the patient')}. Thankful/relieved if score >= 65, worried/uncertain if < 65.>",
  "differential_1_result": "<accepted|partial|incorrect>",
  "differential_2_result": "<accepted|partial|incorrect>",
  "differential_1_feedback": "<one sentence in second person>",
  "differential_2_feedback": "<one sentence in second person>",
  "management_score": <0-100>,
  "management_feedback": "<2-3 sentences in second person. Acknowledge what you got right first.>",
  "management_matched": [<list of matched action strings from the student's plan>],
  "management_missed": [<list of the most critical missed actions, max 3>]
}}"""

    else:
        prompt = f"""You are a fair and encouraging medical education scorer for MEDICAL STUDENTS who are still learning.

Always address the student directly in second person: "You identified...", "Your diagnosis...", "You missed..." — never say "The student...".

Hidden correct diagnosis: "{hidden_diagnosis}"
Correct diagnosis keywords: {json.dumps(keywords)}
Student's diagnosis: "{body.diagnosis}"
Time taken: {body.time_taken}

Score generously — reward correct thinking:
  90-100: Exact or near-exact match
  80-89:  Correct disease, missing minor subtype
  65-79:  Correct organ system and mechanism
  45-64:  Related condition, partially correct
  20-44:  Some relevant thinking but wrong
  0-19:   Completely unrelated

Respond ONLY with a valid JSON object (no markdown, no backticks):
{{"score": <0-100>, "feedback": "<2-3 sentences in second person, acknowledge what was right before noting gaps>", "patientReaction": "<short in-character message from {persona.get('name', 'the patient')}. Thankful if score >= 65, uncertain if < 65>"}}"""

    raw = call_llm(prompt, max_tokens=600)

    try:
        parsed = safe_parse_json(raw)
        result = {
            "score": parsed.get("score", 0),
            "feedback": parsed.get("feedback", ""),
            "patientReaction": parsed.get("patientReaction", ""),
        }
        if has_extended:
            result.update({
                "differential_1_result": parsed.get("differential_1_result", "incorrect"),
                "differential_2_result": parsed.get("differential_2_result", "incorrect"),
                "differential_1_feedback": parsed.get("differential_1_feedback", ""),
                "differential_2_feedback": parsed.get("differential_2_feedback", ""),
                "management_score": parsed.get("management_score", 0),
                "management_feedback": parsed.get("management_feedback", ""),
                "management_matched": parsed.get("management_matched", []),
                "management_missed": parsed.get("management_missed", []),
            })
        return result
    except Exception:
        raise HTTPException(status_code=502, detail=f"Failed to parse scoring response: {raw}")


# --------------------------------------------------
# POST-SESSION DEBRIEF
# --------------------------------------------------

@app.post("/debrief/{case_id}")
async def generate_debrief(case_id: str, body: DebriefRequest):
    case = active_cases.get(body.session_id)
    if not case:
        raise HTTPException(status_code=404, detail="Session not found")

    rubric = case.get("scoring_rubric", {})
    hidden_diagnosis = case.get("hidden_diagnosis", "")
    important_investigations = rubric.get("important_investigations", list(case.get("investigations", {}).keys()))
    key_history_questions = rubric.get("essential_questions", [])
    management_actions = rubric.get("management_actions", [])
    differentials = rubric.get("acceptable_differentials", [])

    # Investigation score — pure logic, no LLM
    ordered = body.ordered_investigations

    normalized_ordered = {
        normalize_investigation(x): x
        for x in ordered
    }

    important_ordered = []
    important_missed = []

    for inv in important_investigations:
        if normalize_investigation(inv) in normalized_ordered:
            important_ordered.append(inv)
        else:
            important_missed.append(inv)
    investigation_score = (
        round(len(important_ordered) / len(important_investigations) * 100)
        if important_investigations else 100
    )

    transcript_text = "\n".join(
        f"{'Doctor' if m.get('role') == 'user' else 'Patient'}: {m.get('text', '')}"
        for m in body.transcript
    )

    # Pass through scores already computed by /diagnose so we never re-score them
    diagnosis_score = body.diagnosis_score
    management_score = body.management_score
    management_matched = body.management_matched
    management_missed = body.management_missed

    debrief_prompt = f"""You are a senior medical education assessor giving a post-session debrief to a medical student.

Always address the student in second person: "You asked...", "You identified...", "You missed...", "Your management plan..." — never say "The student...".

CASE DETAILS:
- Correct diagnosis: {hidden_diagnosis}
- Key history questions the student should have asked: {json.dumps(key_history_questions)}
- Expected management actions: {json.dumps(management_actions)}
- Acceptable differentials: {json.dumps(differentials)}

STUDENT SUBMISSION:
- Primary diagnosis: "{body.primary_diagnosis}"
- Differential #1: "{body.differential_1 or 'not provided'}"
- Differential #2: "{body.differential_2 or 'not provided'}"
- Management plan: "{body.management_plan or 'not provided'}"
- Time taken: {body.time_taken}

SCORES ALREADY COMPUTED (use these exact values — do not re-score):
- Diagnosis score: {diagnosis_score}/100
- Investigation score: {investigation_score}/100
- Management score: {management_score}/100

TRANSCRIPT:
{transcript_text}

Your task: score history-taking and reasoning, then produce the session review.

HISTORY score (0-100): How thoroughly did the student explore the history vs the key_history_questions list?
  - Award 20 pts per key category explored (onset, character, associated symptoms, PMH, medications, social)
  - Be generous — brief but relevant questions still count
  - Score 70+ if they covered the main areas even without perfect depth

REASONING score (0-100): How logical was the diagnostic process shown in the transcript?
  - This score should be WITHIN 15 points of the diagnosis score ({diagnosis_score})
  - If they reached the right diagnosis, reasoning was clearly good — score accordingly
  - Only go lower than the diagnosis score if the transcript shows they guessed without reasoning

For session review, analyse the transcript carefully and identify specific questions and findings.

Respond ONLY with a valid JSON object, no markdown, no backticks:
{{
  "history_score": <0-100>,
  "reasoning_score": <0-100, must be within 15 pts of {diagnosis_score}>,
  "history_feedback": "<2 sentences in second person>",
  "reasoning_feedback": "<2 sentences in second person>",
  "management_feedback": "<2-3 sentences in second person acknowledging what you got right>",
  "good_questions": [<up to 5 actual questions from the transcript that were clinically strong>],
  "missed_questions": [<up to 5 key questions from key_history_questions that were not asked>],
  "key_findings_discovered": [<up to 5 important clinical findings the student uncovered>],
  "key_findings_missed": [<up to 5 important findings that were not explored>]
}}"""

    raw = call_llm(debrief_prompt, max_tokens=1200)

    try:
        parsed = safe_parse_json(raw)
    except Exception:
        raise HTTPException(status_code=502, detail=f"Failed to parse debrief response: {raw}")

    history_score = parsed.get("history_score", 0)
    reasoning_score = parsed.get("reasoning_score", 0)

    overall_score = round(
        (history_score + investigation_score + reasoning_score + management_score) / 4
    )

    await db.execute(
        """
        INSERT INTO debrief_results (
            session_id, primary_diagnosis, differential_1, differential_2,
            management_plan, diagnosis_score, management_score, history_score,
            investigation_score, reasoning_score, overall_score,
            management_matched, management_missed, ordered_investigations,
            transcript, full_debrief
        ) VALUES (
            :session_id, :primary_diagnosis, :differential_1, :differential_2,
            :management_plan, :diagnosis_score, :management_score, :history_score,
            :investigation_score, :reasoning_score, :overall_score,
            :management_matched, :management_missed, :ordered_investigations,
            :transcript, :full_debrief
        )
        """,
        {
            "session_id":             body.session_id,
            "primary_diagnosis":      body.primary_diagnosis,
            "differential_1":         body.differential_1,
            "differential_2":         body.differential_2,
            "management_plan":        body.management_plan,
            "diagnosis_score":        body.diagnosis_score,
            "management_score":       body.management_score,
            "history_score":          parsed.get("history_score", 0),
            "investigation_score":    investigation_score,
            "reasoning_score":        parsed.get("reasoning_score", 0),
            "overall_score":          overall_score,
            "management_matched":     json.dumps(body.management_matched),
            "management_missed":      json.dumps(body.management_missed),
            "ordered_investigations": json.dumps(body.ordered_investigations),
            "transcript":             json.dumps(body.transcript),
            "full_debrief":           json.dumps({
                "history_score":            parsed.get("history_score", 0),
                "investigation_score":      investigation_score,
                "reasoning_score":          parsed.get("reasoning_score", 0),
                "management_score":         body.management_score,
                "overall_score":            overall_score,
                "diagnosis_score":          body.diagnosis_score,
                "history_feedback":         parsed.get("history_feedback", ""),
                "reasoning_feedback":       parsed.get("reasoning_feedback", ""),
                "management_feedback":      parsed.get("management_feedback", ""),
                "primary_diagnosis":        body.primary_diagnosis,
                "correct_diagnosis":        hidden_diagnosis,
                "differential_1":          body.differential_1,
                "differential_2":          body.differential_2,
                "management_plan":         body.management_plan,
                "management_matched":      body.management_matched,
                "management_missed":       body.management_missed,
                "ordered_investigations":  body.ordered_investigations,
                "important_ordered":       important_ordered,
                "important_missed":        important_missed,
                "good_questions":          parsed.get("good_questions", []),
                "missed_questions":        parsed.get("missed_questions", []),
                "key_findings_discovered": parsed.get("key_findings_discovered", []),
                "key_findings_missed":     parsed.get("key_findings_missed", []),
                "acceptable_differentials":differentials,
                "expected_management":     management_actions,
                "transcript":              body.transcript,
                "time_taken":              body.time_taken,
            }),
        }
    )

    await db.execute("""
        UPDATE sessions SET completed_at = NOW(), time_taken = :time_taken
        WHERE session_id = :session_id
    """, {"time_taken": body.time_taken, "session_id": body.session_id})

    return {
        # Competency scores — diagnosis and management come from /diagnose, never re-computed
        "history_score": history_score,
        "investigation_score": investigation_score,
        "reasoning_score": reasoning_score,
        "management_score": management_score,
        "overall_score": overall_score,

        # Feedback
        "history_feedback": parsed.get("history_feedback", ""),
        "reasoning_feedback": parsed.get("reasoning_feedback", ""),
        "management_feedback": parsed.get("management_feedback", ""),

        # Investigation review
        "ordered_investigations": ordered,
        "important_ordered": important_ordered,
        "important_missed": important_missed,

        # Session review
        "good_questions": parsed.get("good_questions", []),
        "missed_questions": parsed.get("missed_questions", []),
        "key_findings_discovered": parsed.get("key_findings_discovered", []),
        "key_findings_missed": parsed.get("key_findings_missed", []),

        # Pass-through for display
        "primary_diagnosis": body.primary_diagnosis,
        "correct_diagnosis": hidden_diagnosis,
        "differential_1": body.differential_1,
        "differential_2": body.differential_2,
        "management_plan": body.management_plan,
        "acceptable_differentials": differentials,
        "expected_management": management_actions,

        # Pass-through management details from /diagnose
        "management_matched": management_matched,
        "management_missed_actions": management_missed,
    }

@app.get("/history")
async def get_history(limit: int = 20, offset: int = 0):
    rows = await db.fetch_all("""
        SELECT s.session_id, s.case_id, s.specialty, s.patient_name,
               s.patient_age, s.patient_sex, s.hidden_diagnosis,
               s.started_at, s.time_taken,
               d.overall_score, d.diagnosis_score, d.primary_diagnosis
        FROM sessions s
        LEFT JOIN debrief_results d ON s.session_id = d.session_id
        WHERE s.completed_at IS NOT NULL
        ORDER BY s.started_at DESC
        LIMIT :limit OFFSET :offset
    """, {"limit": limit, "offset": offset})
    return [dict(row) for row in rows]


@app.get("/history/{session_id}")
async def get_session_detail(session_id: str):
    session = await db.fetch_one(
        "SELECT * FROM sessions WHERE session_id = :sid",
        {"sid": session_id}
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    debrief = await db.fetch_one(
        "SELECT * FROM debrief_results WHERE session_id = :sid",
        {"sid": session_id}
    )
    if not debrief:
        return {"session": dict(session), "debrief": None}

    debrief_dict = dict(debrief)
    # Parse JSONB fields that come back as strings
    for field in ["full_debrief", "transcript", "management_matched",
                  "management_missed", "ordered_investigations"]:
        if isinstance(debrief_dict.get(field), str):
            debrief_dict[field] = json.loads(debrief_dict[field])

    return {"session": dict(session), "debrief": debrief_dict}