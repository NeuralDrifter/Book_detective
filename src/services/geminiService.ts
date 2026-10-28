import { DetectiveClue, BookCandidate, InvestigationQuestion } from '../types';

export interface InvestigationResult {
  clues: DetectiveClue[];
  candidates: BookCandidate[];
  nextQuestion?: InvestigationQuestion;
}

export async function investigateBook(
  query: string,
  clues: DetectiveClue[] = [],
  rejectedCandidateIds: string[] = [],
  excludedTitles: string[] = [],
  answerHistory: string[] = [],
  round: number = 1
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
      }),
    });

    if (!res.ok) {
      throw new Error('Failed to investigate from server');
    }

    const data = await res.json();
    // Ensure all candidates have default verification status pending
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
