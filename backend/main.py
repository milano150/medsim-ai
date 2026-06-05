from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import json
import random
from pathlib import Path

app = FastAPI()

# Allow React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_CASES_PATH = Path("../cases")

@app.get("/")
def home():
    return {
        "message": "MedSim Backend Running"
    }


@app.get("/specialty/{specialty}")
def get_random_case(specialty: str):

    specialty_folder = BASE_CASES_PATH / specialty.lower()

    if not specialty_folder.exists():
        raise HTTPException(
            status_code=404,
            detail="Specialty not found"
        )

    case_files = list(
        specialty_folder.glob("*.json")
    )

    if len(case_files) == 0:
        raise HTTPException(
            status_code=404,
            detail="No cases found"
        )

    selected_file = random.choice(case_files)

    with open(selected_file, "r") as f:
        case = json.load(f)

    return {
        "case_id": case["case_id"],
        "name": case["name"],
        "age": case["age"],
        "complaint": case["complaint"],
        "specialty": case["specialty"]
    }