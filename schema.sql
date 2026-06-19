CREATE TABLE IF NOT EXISTS sessions (
  id               SERIAL PRIMARY KEY,
  session_id       VARCHAR(64) UNIQUE NOT NULL,
  case_id          VARCHAR(64) NOT NULL,
  specialty        VARCHAR(64),
  patient_name     VARCHAR(128),
  patient_age      INTEGER,
  patient_sex      VARCHAR(16),
  hidden_diagnosis TEXT,
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  time_taken       VARCHAR(16)
);

CREATE TABLE IF NOT EXISTS debrief_results (
  id                     SERIAL PRIMARY KEY,
  session_id             VARCHAR(64) REFERENCES sessions(session_id),
  primary_diagnosis      TEXT,
  differential_1         TEXT,
  differential_2         TEXT,
  management_plan        TEXT,
  diagnosis_score        INTEGER,
  management_score       INTEGER,
  history_score          INTEGER,
  investigation_score    INTEGER,
  reasoning_score        INTEGER,
  overall_score          INTEGER,
  management_matched     JSONB,
  management_missed      JSONB,
  ordered_investigations JSONB,
  transcript             JSONB,
  full_debrief           JSONB,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);