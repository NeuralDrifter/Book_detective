import { DetectiveClue, BookCandidate, InvestigationQuestion } from '../types';

export interface InvestigationResult {
  clues: DetectiveClue[];
  candidates: BookCandidate[];
  nextQuestion?: InvestigationQuestion;
}

export interface DetectiveModelOption {
  id: string;
  apiModel: string;
  name: string;
  isPaid?: boolean;
  description: string;
}

export const AVAILABLE_MODELS: DetectiveModelOption[] = [
  {
    id: 'default',
    apiModel: 'gemini-3.8-flash',
    name: 'Default (Gemini 3.8 Flash)',
    description: 'Recommended default model for balanced literary recall and multi-clue deduction.',
  },
  {
    id: 'gemini-3.8-flash',
    apiModel: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Fast, high-precision literary recall and multi-clue deduction.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    apiModel: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    description: 'Lightweight, rapid clue extraction and candidate generation.',
  },
  {
    id: 'gemini-3.6-flash',
    apiModel: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    description: 'Balanced speed and associative plot-fragment matching.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    apiModel: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    description: 'Ultra-fast, lightweight model for quick book clue triage.',
  },
  {
    id: 'gemini-3-flash-preview',
    apiModel: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    description: 'Preview Flash model with sharp plot-fragment matching.',
  },
];

export type DetectiveModelId = string;

export async function investigateBook(
  query: string,
  clues: DetectiveClue[] = [],
  rejectedCandidateIds: string[] = [],
  excludedTitles: string[] = [],
  answerHistory: string[] = [],
  round: number = 1,
  model: string = 'gemini-3.8-flash'
): Promise<InvestigationResult> {
  try {
    const res = await fetch('/api/books/investigate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        clues,
        rejectedCandidateIds,
        excludedTitles,
        answerHistory,
        round,
        model,
      }),
    });

    if (!res.ok) {
      throw new Error('Failed to investigate from server');
    }

    const data = await res.json();
    const candidates = (data.candidates || []).map((c: any, index: number) => ({
      ...c,
      id: c.id || `candidate-${index}-${Date.now()}`,
      verificationStatus: 'pending' as const,
      supportingEvidence: c.supportingEvidence || [],
      conflictingEvidence: c.conflictingEvidence || [],
      uncertainties: c.uncertainties || [],
      memoryMatchScore: c.memoryMatchScore || 0.8,
    }));

    return {
      clues: data.clues || [],
      candidates,
      nextQuestion: data.nextQuestion,
    };
  } catch (error) {
    console.error("Error investigating books:", error);
    return { clues: [], candidates: [] };
  }
}

export async function verifyCandidate(title: string, author?: string): Promise<{
  verificationStatus: 'pending' | 'catalog_match' | 'other_evidence' | 'not_found' | 'unavailable';
  verificationSource?: string;
  verificationUrl?: string;
  matchedTitle?: string;
  matchedAuthor?: string;
}> {
  try {
    const res = await fetch('/api/books/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, author }),
    });

    if (!res.ok) {
      return { verificationStatus: 'unavailable' };
    }

    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Error verifying candidate:", error);
    return { verificationStatus: 'unavailable' };
  }
}
