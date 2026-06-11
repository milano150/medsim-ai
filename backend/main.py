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
# CASE LOADING & GENERATION  (unchanged)
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


def generate_investigations(case: dict) -> dict:
    inv = case.get("investigations", {})
    investigations = {}
    if "ecg_variants" in inv:
        investigations["ECG"] = random.choice(inv["ecg_variants"])
    if "troponin_range" in inv:
        troponin = round(random.uniform(inv["troponin_range"][0], inv["troponin_range"][1]), 2)
        investigations["Troponin"] = f"{troponin} ng/mL"
    if "chest_xray" in inv:
        investigations["Chest X-Ray"] = random.choice(inv["chest_xray"])
    if "lab_findings" in inv:
        findings = inv["lab_findings"]
        count = random.randint(1, len(findings))
        investigations["Lab Findings"] = ", ".join(random.sample(findings, count))
    return investigations


def generate_case_data(case: dict) -> dict:
    case["patient_persona"] = generate_patient_persona(case)
    case["physical_exam"] = generate_physical_exam(case)
    variants = case.get("presentation_variants", [])
    if variants:
        case["presenting_complaint"] = random.choice(variants).get("presenting_complaint", case.get("presenting_complaint"))
    case["vitals"] = generate_vitals(case)
    case["investigations"] = generate_investigations(case)
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


# FR-03: Extended diagnosis submission with differentials + management
class DiagnoseRequest(BaseModel):
    session_id: str
    diagnosis: str          # primary diagnosis (kept for backward compat)
    time_taken: str
    # FR-03 new fields (optional so existing callers don't break)
    differential_1: Optional[str] = None
    differential_2: Optional[str] = None
    management_plan: Optional[str] = None


# FR-04: Debrief request
class DebriefRequest(BaseModel):
    session_id: str
    time_taken: str
    # mirrors what was submitted during diagnose
    primary_diagnosis: str
    differential_1: Optional[str] = None
    differential_2: Optional[str] = None
    management_plan: Optional[str] = None
    # investigations that were ordered (keys from patient.investigations)
    ordered_investigations: List[str] = []
    # full chat transcript for session review
    transcript: List[dict] = []   # [{role, text}]


# --------------------------------------------------
# HELPERS  (unchanged)
# --------------------------------------------------

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
    # Find first { ... } block in case the model added preamble
    match = re.search(r"\{.*\}", clean, re.DOTALL)
    if match:
        clean = match.group(0)
    return json.loads(clean)


# --------------------------------------------------
# ROUTES  (unchanged originals)
# --------------------------------------------------

@app.get("/")
def home():
    return {"message": "MedSim Backend Running", "model": GROQ_MODEL}


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
            "occupation": case["patient_persona"]["occupation"],
        },
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
# FR-03: EXTENDED DIAGNOSIS SCORING
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

    # Build a richer prompt when differential / management data is supplied
    has_extended = any([body.differential_1, body.differential_2, body.management_plan])

    if has_extended:
        prompt = f"""You are a supportive medical education scoring assistant for MEDICAL STUDENTS (not consultants). Be fair and generous — students are learning.

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

PRIMARY DIAGNOSIS scoring (0-100) — be generous:
  90-100: exact match or correct with correct subtype
  75-89:  correct disease category, missing subtype/specificity (e.g. "meningitis" vs "bacterial meningitis" = 75)
  55-74:  closely related condition in the right organ system
  30-54:  some correct clinical reasoning but wrong diagnosis
  0-29:   completely unrelated

DIFFERENTIAL scoring — mark "accepted" if the differential is clinically reasonable for the presentation, even if not on the list. Only mark "incorrect" if it is unrelated. Be generous.

MANAGEMENT scoring (0-100) — partial credit is important:
  - The student is a student, not a consultant. Do not expect a complete treatment protocol.
  - Award 25 points per correct action mentioned (e.g. IV access alone = 25, not 0).
  - Give full credit if the general intent matches (e.g. "IV antibiotics" matches "administer IV ceftriaxone").
  - Only penalise for missing CRITICAL life-saving actions, not procedural details.
  - A single relevant action mentioned should score at LEAST 20/100.

Patient name: {persona.get('name', 'the patient')}

Respond ONLY with a valid JSON object, no markdown, no backticks:
{{
  "score": <0-100 primary diagnosis score>,
  "feedback": "<2-3 sentence constructive feedback, acknowledge what was correct before noting gaps>",
  "patientReaction": "<1-2 sentence in-character reaction from {persona.get('name', 'the patient')}, thankful if score > 65, worried if <= 65>",
  "differential_1_result": "<accepted|partial|incorrect>",
  "differential_2_result": "<accepted|partial|incorrect>",
  "differential_1_feedback": "<one sentence>",
  "differential_2_feedback": "<one sentence>",
  "management_score": <0-100>,
  "management_feedback": "<2-3 sentences, acknowledge what was right>",
  "management_matched": [<list of matched action strings>],
  "management_missed": [<list of only the most critical missed actions, max 3>]
}}"""
    else:
        # Backward-compatible prompt (original behaviour)
        prompt = f"""You are a medical education scoring assistant. A medical student submitted a diagnosis for a simulated patient case.

Hidden correct diagnosis: "{hidden_diagnosis}"
Correct diagnosis keywords: {json.dumps(keywords)}
Student's diagnosis: "{body.diagnosis}"
Time taken: {body.time_taken}

Evaluate the student's diagnosis and respond ONLY with a valid JSON object (no markdown, no backticks, no extra text) in this exact format:
{{"score": <number 0-100>, "feedback": "<2-3 sentence constructive feedback explaining the score, what was right and what was missed>", "patientReaction": "<a short in-character message the patient named {persona.get('name', 'the patient')} would say, thankful if score > 75, disappointed if score <= 75>"}}

Scoring criteria:
- 90-100: Exact or near-exact match with correct diagnosis
- 70-89: Correct general diagnosis but missing specifics
- 50-69: Partially correct, related condition identified
- 25-49: Some relevant medical thinking but wrong diagnosis
- 0-24: Completely incorrect or unrelated diagnosis"""

    raw = call_llm(prompt, max_tokens=600)

    try:
        parsed = safe_parse_json(raw)
        result = {
            "score": parsed.get("score", 0),
            "feedback": parsed.get("feedback", ""),
            "patientReaction": parsed.get("patientReaction", ""),
        }
        # Include extended fields if present
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
# FR-04: POST-SESSION DEBRIEF
# --------------------------------------------------

@app.post("/debrief/{case_id}")
def generate_debrief(case_id: str, body: DebriefRequest):
    """
    Full post-session debrief. Analyses:
    - Investigation selection (ordered vs expected vs missed)
    - Competency scores (history, investigations, reasoning, management)
    - Annotated session review (good questions, missed questions, key findings)

    Reuses active_cases session state and call_llm.
    """
    case = active_cases.get(body.session_id)
    if not case:
        raise HTTPException(status_code=404, detail="Session not found")

    rubric = case.get("scoring_rubric", {})
    hidden_diagnosis = case.get("hidden_diagnosis", "")
    important_investigations = rubric.get("important_investigations", list(case.get("investigations", {}).keys()))
    key_history_questions = rubric.get("key_history_questions", [])
    management_actions = rubric.get("management_actions", [])
    differentials = rubric.get("acceptable_differentials", [])

    # --- Investigation review (pure logic, no LLM needed) ---
    ordered = body.ordered_investigations
    important_ordered = [i for i in ordered if i in important_investigations]
    important_missed = [i for i in important_investigations if i not in ordered]
    investigation_score = (
        round(len(important_ordered) / len(important_investigations) * 100)
        if important_investigations else 100
    )

    # --- Build transcript string for LLM ---
    transcript_text = "\n".join(
        f"{'Doctor' if m.get('role') == 'user' else 'Patient'}: {m.get('text', '')}"
        for m in body.transcript
    )

    # --- Single LLM call for competency scoring + session review ---
    debrief_prompt = f"""You are a senior medical education assessor debriefing a student after a simulated patient case.

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

TRANSCRIPT:
{transcript_text}

INVESTIGATION DATA:
- All ordered: {json.dumps(ordered)}
- Important ones ordered: {json.dumps(important_ordered)}
- Important ones missed: {json.dumps(important_missed)}

Your task: produce a structured debrief. Score each competency 0-100.

Competency scoring:
- history_score: How thoroughly did the student explore the history? Award based on key questions asked vs key_history_questions list.
- investigation_score: Already computed as {investigation_score} — use this exact value.
- reasoning_score: How logical was the diagnostic reasoning based on the full transcript and submission?
- management_score: How complete was the management plan vs expected_management_actions?

For session review, analyse the transcript carefully.

Respond ONLY with a valid JSON object, no markdown, no backticks:
{{
  "history_score": <0-100>,
  "investigation_score": {investigation_score},
  "reasoning_score": <0-100>,
  "management_score": <0-100>,
  "history_feedback": "<2 sentences>",
  "reasoning_feedback": "<2 sentences>",
  "management_feedback": "<2 sentences>",
  "good_questions": [<list of up to 5 actual questions from transcript that were clinically strong>],
  "missed_questions": [<list of up to 5 key questions the student did not ask, from key_history_questions>],
  "key_findings_discovered": [<list of up to 5 important clinical findings the student uncovered>],
  "key_findings_missed": [<list of up to 5 important findings not explored>]
}}"""

    raw = call_llm(debrief_prompt, max_tokens=1200)

    try:
        parsed = safe_parse_json(raw)
    except Exception:
        raise HTTPException(status_code=502, detail=f"Failed to parse debrief response: {raw}")

    overall_score = round(
        (parsed.get("history_score", 0) +
         parsed.get("investigation_score", investigation_score) +
         parsed.get("reasoning_score", 0) +
         parsed.get("management_score", 0)) / 4
    )

    return {
        # Competency scores
        "history_score": parsed.get("history_score", 0),
        "investigation_score": parsed.get("investigation_score", investigation_score),
        "reasoning_score": parsed.get("reasoning_score", 0),
        "management_score": parsed.get("management_score", 0),
        "overall_score": overall_score,

        # Feedback per competency
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

        # Pass-through submission for display
        "primary_diagnosis": body.primary_diagnosis,
        "correct_diagnosis": hidden_diagnosis,
        "differential_1": body.differential_1,
        "differential_2": body.differential_2,
        "management_plan": body.management_plan,
        "acceptable_differentials": differentials,
        "expected_management": management_actions,
    }