export type VerificationStatus =
  | "pending"
  | "catalog_match"
  | "other_evidence"
  | "not_found"
  | "unavailable";

export type CaseStatus =
  | "investigating"
  | "promising_lead"
  | "reader_confirmed"
  | "unresolved";

export type ClueCertainty = "explicit" | "uncertain" | "inferred";
export type ClueSource = "original" | "follow_up";

export interface DetectiveClue {
  id: string;
  description: string;
  certainty: ClueCertainty;
  source: ClueSource;
}

export interface BookCandidate {
  id: string;
  title: string;
  author?: string;
  year?: string;
  summary: string;
  whyItMatches: string;
  supportingEvidence: string[];
  conflictingEvidence: string[];
  uncertainties: string[];
  memoryMatchScore: number;
  verificationStatus: VerificationStatus;
  verificationSource?: string;
  verificationUrl?: string;
}

export interface InvestigationQuestion {
  question: string;
  options: string[];
}

export interface InvestigationCase {
  id: string;
  originalDescription: string;
  clues: DetectiveClue[];
  candidates: BookCandidate[];
  rejectedCandidateIds: string[];
  excludedTitles: string[];
  questionHistory: string[];
  answerHistory: string[];
  nextQuestion?: InvestigationQuestion;
  status: CaseStatus;
  round: number;
  updatedAt: string;
}
