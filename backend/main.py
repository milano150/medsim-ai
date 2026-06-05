from fastapi import FastAPI
import json

app = FastAPI()

@app.get("/")
def home():
    return {"message": "MedSim Running"}

@app.get("/case")
def get_case():

    with open("../cases/stemi.json") as f:
        case = json.load(f)

    return case