#!/usr/bin/env python3
"""Test script to validate STEMI case integration with backend."""

import json
import random
import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

def test_stemi_json():
    """Test that STEMI case JSON is valid."""
    stemi_path = Path(__file__).parent / "cases" / "cardiology" / "stemi_01.json"
    with open(stemi_path, "r") as f:
        case = json.load(f)
    
    # Check required fields
    assert "case_id" in case, "Missing case_id"
    assert "patient_generator" in case, "Missing patient_generator"
    assert "names" in case["patient_generator"], "Missing names in patient_generator"
    assert len(case["patient_generator"]["names"]) > 0, "No names in pool"
    assert "presentations_variants" in case or "presentation_variants" in case, "Missing presentation variants"
    assert "vitals_ranges" in case, "Missing vitals_ranges"
    assert "investigations" in case, "Missing investigations"
    assert "history_data" in case, "Missing history_data"
    assert "hidden_diagnosis" in case, "Missing hidden_diagnosis"
    
    print("✓ STEMI case JSON is valid")
    print(f"  - Names pool: {len(case['patient_generator']['names'])} names")
    print(f"  - Hidden diagnosis: {case['hidden_diagnosis']}")


def test_randomization():
    """Test that randomization works."""
    from main import generate_patient_persona, generate_vitals, generate_investigations
    
    stemi_path = Path(__file__).parent / "cases" / "cardiology" / "stemi_01.json"
    with open(stemi_path, "r") as f:
        case = json.load(f)
    
    # Generate 5 personas to test randomization
    personas = []
    for _ in range(5):
        persona = generate_patient_persona(case)
        personas.append(persona)
        assert "name" in persona, "Missing name in persona"
        assert "age" in persona, "Missing age in persona"
        assert "sex" in persona, "Missing sex in persona"
        assert "occupation" in persona, "Missing occupation in persona"
    
    # Check that at least some are different (names should vary)
    names = [p["name"] for p in personas]
    unique_names = set(names)
    
    print(f"✓ Generated {len(personas)} personas")
    print(f"  - Unique names: {len(unique_names)}/{len(personas)}")
    print(f"  - Sample names: {', '.join(list(unique_names)[:3])}")
    
    # Test vitals
    vitals = generate_vitals(case)
    assert "bp" in vitals, "Missing BP in vitals"
    assert "hr" in vitals, "Missing HR in vitals"
    print(f"✓ Generated vitals: {vitals}")
    
    # Test investigations
    investigations = generate_investigations(case)
    assert len(investigations) > 0, "No investigations generated"
    print(f"✓ Generated investigations: {investigations}")


if __name__ == "__main__":
    try:
        test_stemi_json()
        test_randomization()
        print("\n✅ All tests passed!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
