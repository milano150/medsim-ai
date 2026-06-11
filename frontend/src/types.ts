// types.ts — shared type definitions for MedSim AI
// FR-03 adds DiagnosePayload and extended DiagnosisResult
// FR-04 adds DebriefRequest and DebriefResult

export type Message = {
  role: "user" | "patient";
  text: string;
};

// FR-03: what we send to /diagnose/{case_id}
export type DiagnosePayload = {
  session_id: string;
  diagnosis: string;
  time_taken: string;
  differential_1?: string;
  differential_2?: string;
  management_plan?: string;
};

// FR-03: extended response from /diagnose/{case_id}
export type DiagnosisResult = {
  score: number;
  feedback: string;
  patientReaction: string;
  // Extended fields (present when differentials/management were submitted)
  differential_1_result?: "accepted" | "partial" | "incorrect";
  differential_2_result?: "accepted" | "partial" | "incorrect";
  differential_1_feedback?: string;
  differential_2_feedback?: string;
  management_score?: number;
  management_feedback?: string;
  management_matched?: string[];
  management_missed?: string[];
};

// FR-03: the form state before submission
export type DiagnosisForm = {
  primaryDiagnosis: string;
  differential1: string;
  differential2: string;
  managementPlan: string;
};

// FR-04: what we send to /debrief/{case_id}
export type DebriefPayload = {
  session_id: string;
  time_taken: string;
  primary_diagnosis: string;
  differential_1?: string;
  differential_2?: string;
  management_plan?: string;
  ordered_investigations: string[];
  transcript: Message[];
};

// FR-04: full debrief response from /debrief/{case_id}
export type DebriefResult = {
  // Competency scores
  history_score: number;
  investigation_score: number;
  reasoning_score: number;
  management_score: number;
  overall_score: number;

  // Per-competency feedback
  history_feedback: string;
  reasoning_feedback: string;
  management_feedback: string;

  // Investigation review
  ordered_investigations: string[];
  important_ordered: string[];
  important_missed: string[];

  // Session review
  good_questions: string[];
  missed_questions: string[];
  key_findings_discovered: string[];
  key_findings_missed: string[];

  // Submission echo for display
  primary_diagnosis: string;
  correct_diagnosis: string;
  differential_1?: string;
  differential_2?: string;
  management_plan?: string;
  acceptable_differentials: string[];
  expected_management: string[];
};

// View states for the app
export type AppView = "landing" | "simulation" | "debrief";