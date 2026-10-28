import { jsPDF } from 'jspdf';
import { BookCandidate, DetectiveClue } from '../types';
import { HistoryEntry, UserColdCase, UserArchiveState } from './driveService';

const LS_HISTORY_KEY = 'book_detective_history_v2';
const LS_LEGACY_HISTORY_KEY = 'book_detective_history';
const LS_COLD_CASES_KEY = 'book_detective_cold_cases_v2';
const LS_BOOKMARKS_KEY = 'book_detective_bookmarks';

const COOKIE_HISTORY_KEY = 'bd_history_v2';
const COOKIE_COLD_CASES_KEY = 'bd_cold_cases_v2';
const COOKIE_BOOKMARKS_KEY = 'bd_bookmarks_v2';

function setBrowserCookie(name: string, value: string, days: number = 365) {
  try {
    const maxAge = days * 24 * 60 * 60;
    const encoded = encodeURIComponent(value);
    // Keep within 3800 bytes per cookie so browsers always accept it
    if (encoded.length <= 3800) {
      document.cookie = `${name}=${encoded}; max-age=${maxAge}; path=/; SameSite=Lax`;
    }
  } catch (e) {
    console.warn('Cookie write skipped:', e);
  }
}

function getBrowserCookie(name: string): string | null {
  try {
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${name}=`));
    if (!match) return null;
    return decodeURIComponent(match.substring(name.length + 1));
  } catch {
    return null;
  }
}

function deleteBrowserCookie(name: string) {
  try {
    document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
  } catch {
    // ignore
  }
}

export function makeShortLabel(query: string): string {
  const cleaned = query.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= 36) return cleaned;
  return cleaned.slice(0, 34).trim() + '…';
}

export function loadLocalHistory(): HistoryEntry[] {
  try {
    const rawV2 = localStorage.getItem(LS_HISTORY_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (Array.isArray(parsed)) return parsed;
    }

    // Check legacy string[] history
    const legacyRaw = localStorage.getItem(LS_LEGACY_HISTORY_KEY);
    if (legacyRaw) {
      const legacyArr = JSON.parse(legacyRaw);
      if (Array.isArray(legacyArr) && legacyArr.length > 0) {
        const migrated: HistoryEntry[] = legacyArr
          .filter((item) => typeof item === 'string' && item.trim())
          .map((q: string, idx: number) => ({
            id: `hist-${Date.now()}-${idx}`,
            query: q,
            createdAt: new Date().toISOString(),
          }));
        saveLocalHistory(migrated);
        return migrated;
      }
    }

    // Fallback to browser cookie
    const cookieRaw = getBrowserCookie(COOKIE_HISTORY_KEY);
    if (cookieRaw) {
      const compact = JSON.parse(cookieRaw);
      if (Array.isArray(compact)) {
        return compact.map((c: any, idx: number) => ({
          id: c.id || `hist-cookie-${idx}`,
          query: c.q || c.query || '',
          createdAt: c.t || new Date().toISOString(),
        }));
      }
    }
  } catch (e) {
    console.warn('Error loading local history:', e);
  }
  return [];
}

export function saveLocalHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(entries));
    localStorage.removeItem(LS_LEGACY_HISTORY_KEY);
  } catch (e) {
    console.warn('LocalStorage history write failed:', e);
  }

  // Also store a compact representation in cookies so history persists even if localStorage is cleared
  const compactForCookie = entries.slice(0, 10).map((e) => ({
    id: e.id,
    q: e.query.slice(0, 160),
    t: e.createdAt,
  }));
  setBrowserCookie(COOKIE_HISTORY_KEY, JSON.stringify(compactForCookie));
}

export function clearLocalHistory() {
  try {
    localStorage.removeItem(LS_HISTORY_KEY);
    localStorage.removeItem(LS_LEGACY_HISTORY_KEY);
  } catch {
    // ignore
  }
  deleteBrowserCookie(COOKIE_HISTORY_KEY);
}

export function loadLocalColdCases(): UserColdCase[] {
  try {
    const raw = localStorage.getItem(LS_COLD_CASES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }

    const cookieRaw = getBrowserCookie(COOKIE_COLD_CASES_KEY);
    if (cookieRaw) {
      const compact = JSON.parse(cookieRaw);
      if (Array.isArray(compact)) {
        return compact.map((c: any, idx: number) => ({
          id: c.id || `cc-cookie-${idx}`,
          label: c.l || makeShortLabel(c.q || ''),
          query: c.q || '',
          createdAt: c.t || new Date().toISOString(),
        }));
      }
    }
  } catch (e) {
    console.warn('Error loading local cold cases:', e);
  }
  return [];
}

export function saveLocalColdCases(cases: UserColdCase[]) {
  try {
    localStorage.setItem(LS_COLD_CASES_KEY, JSON.stringify(cases));
  } catch (e) {
    console.warn('LocalStorage cold cases write failed:', e);
  }

  const compactForCookie = cases.slice(0, 10).map((c) => ({
    id: c.id,
    l: c.label.slice(0, 40),
    q: c.query.slice(0, 160),
    t: c.createdAt,
  }));
  setBrowserCookie(COOKIE_COLD_CASES_KEY, JSON.stringify(compactForCookie));
}

export function loadLocalBookmarks(): BookCandidate[] {
  try {
    const raw = localStorage.getItem(LS_BOOKMARKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }

    const cookieRaw = getBrowserCookie(COOKIE_BOOKMARKS_KEY);
    if (cookieRaw) {
      const compact = JSON.parse(cookieRaw);
      if (Array.isArray(compact)) {
        return compact.map((b: any, idx: number) => ({
          id: b.id || `bm-cookie-${idx}`,
          title: b.t || 'Untitled',
          author: b.a || 'Unknown',
          year: b.y || '',
          summary: b.s || '',
          whyItMatches: b.w || '',
          supportingEvidence: [],
          conflictingEvidence: [],
          uncertainties: [],
          memoryMatchScore: b.m || 0.85,
          verificationStatus: 'catalog_match',
        }));
      }
    }
  } catch (e) {
    console.warn('Error loading local bookmarks:', e);
  }
  return [];
}

export function saveLocalBookmarks(bookmarks: BookCandidate[]) {
  try {
    localStorage.setItem(LS_BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch (e) {
    console.warn('LocalStorage bookmarks write failed:', e);
  }

  const compactForCookie = bookmarks.slice(0, 8).map((b) => ({
    id: b.id,
    t: b.title.slice(0, 60),
    a: (b.author || '').slice(0, 40),
    y: b.year || '',
    s: (b.summary || '').slice(0, 100),
    w: (b.whyItMatches || '').slice(0, 80),
    m: b.memoryMatchScore,
  }));
  setBrowserCookie(COOKIE_BOOKMARKS_KEY, JSON.stringify(compactForCookie));
}

export function clearLocalBookmarks() {
  try {
    localStorage.removeItem(LS_BOOKMARKS_KEY);
  } catch {
    // ignore
  }
  deleteBrowserCookie(COOKIE_BOOKMARKS_KEY);
}

/**
 * Merges remote Google Drive archive state with local state so no user items are lost on sign-in.
 */
export function mergeUserArchives(
  local: { coldCases: UserColdCase[]; history: HistoryEntry[]; bookmarks: BookCandidate[] },
  remote: UserArchiveState | null
): UserArchiveState {
  if (!remote) {
    return {
      coldCases: local.coldCases,
      history: local.history,
      bookmarks: local.bookmarks,
      updatedAt: new Date().toISOString(),
    };
  }

  // Merge Cold Cases by normalized query
  const coldCaseMap = new Map<string, UserColdCase>();
  for (const item of [...(remote.coldCases || []), ...local.coldCases]) {
    const key = item.query.trim().toLowerCase();
    if (!key) continue;
    const existing = coldCaseMap.get(key);
    if (!existing || (item.candidates?.length || 0) > (existing.candidates?.length || 0)) {
      coldCaseMap.set(key, item);
    }
  }

  // Merge History by normalized query
  const historyMap = new Map<string, HistoryEntry>();
  for (const item of [...local.history, ...(remote.history || [])]) {
    const key = item.query.trim().toLowerCase();
    if (!key) continue;
    const existing = historyMap.get(key);
    if (!existing || (item.candidates?.length || 0) > (existing.candidates?.length || 0)) {
      historyMap.set(key, item);
    }
  }

  // Merge Bookmarks by title + author
  const bookmarkMap = new Map<string, BookCandidate>();
  for (const b of [...local.bookmarks, ...(remote.bookmarks || [])]) {
    const key = `${b.title.trim().toLowerCase()}::${(b.author || '').trim().toLowerCase()}`;
    if (!bookmarkMap.has(key)) {
      bookmarkMap.set(key, b);
    }
  }

  return {
    coldCases: Array.from(coldCaseMap.values()).slice(0, 15),
    history: Array.from(historyMap.values()).slice(0, 15),
    bookmarks: Array.from(bookmarkMap.values()),
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// PDF EXPORT FUNCTIONS (jsPDF)
// ============================================================================

function addWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number = 6
): number {
  const lines = doc.splitTextToSize(text, maxWidth);
  for (const line of lines) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

export function exportCandidateToPdf(candidate: BookCandidate, originalQuery?: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - 30;
  let y = 20;

  // Header Banner
  doc.setFillColor(28, 26, 24);
  doc.rect(0, 0, pageWidth, 34, 'F');

  doc.setTextColor(212, 175, 55);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('DEPT. B-12 ARCHIVE • BOOK DETECTIVE CASE REPORT', 15, 13);

  doc.setTextColor(243, 238, 226);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(18);
  const titleLines = doc.splitTextToSize(candidate.title, maxWidth);
  doc.text(titleLines[0] || candidate.title, 15, 24);

  y = 44;

  // Metadata Box
  doc.setTextColor(40, 35, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Author: ${candidate.author || 'Unknown'}`, 15, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    `Published: ${candidate.year || 'Unknown'}   |   Memory Match: ${Math.round(
      candidate.memoryMatchScore * 100
    )}%   |   Catalog Status: ${candidate.verificationStatus.toUpperCase()}`,
    15,
    y
  );
  y += 6;

  doc.setTextColor(110, 100, 90);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 15, y);
  y += 8;

  doc.setDrawColor(197, 168, 128);
  doc.line(15, y, pageWidth - 15, y);
  y += 8;

  if (originalQuery && originalQuery.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(140, 105, 40);
    doc.text('ORIGINAL MEMORY CLUES', 15, y);
    y += 6;

    doc.setFont('times', 'italic');
    doc.setFontSize(10.5);
    doc.setTextColor(50, 45, 40);
    y = addWrappedText(doc, `"${originalQuery.trim()}"`, 15, y, maxWidth, 5.5);
    y += 5;
  }

  // Summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(140, 105, 40);
  doc.text('BOOK SUMMARY', 15, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(35, 32, 28);
  y = addWrappedText(doc, candidate.summary, 15, y, maxWidth, 5.5);
  y += 5;

  // Why It Matches
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(140, 105, 40);
  doc.text('WHY IT MATCHES YOUR MEMORY', 15, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(35, 32, 28);
  y = addWrappedText(doc, candidate.whyItMatches, 15, y, maxWidth, 5.5);
  y += 5;

  if (candidate.supportingEvidence?.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(25, 115, 70);
    doc.text('SUPPORTING EVIDENCE', 15, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(35, 32, 28);
    for (const ev of candidate.supportingEvidence) {
      y = addWrappedText(doc, `• ${ev}`, 17, y, maxWidth - 4, 5);
    }
    y += 4;
  }

  if (candidate.conflictingEvidence?.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(180, 100, 20);
    doc.text('CONFLICTING EVIDENCE / UNCERTAINTIES', 15, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(35, 32, 28);
    for (const ev of candidate.conflictingEvidence) {
      y = addWrappedText(doc, `• ${ev}`, 17, y, maxWidth - 4, 5);
    }
  }

  const safeTitle = candidate.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  doc.save(`Book_Detective_Case_${safeTitle}.pdf`);
}

export function exportInvestigationToPdf(
  query: string,
  clues: DetectiveClue[] = [],
  candidates: BookCandidate[] = [],
  customHeading: string = 'FULL INVESTIGATION DOSSIER'
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - 30;
  let y = 20;

  // Header Banner
  doc.setFillColor(28, 26, 24);
  doc.rect(0, 0, pageWidth, 32, 'F');

  doc.setTextColor(212, 175, 55);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`DEPT. B-12 ARCHIVE • ${customHeading}`, 15, 12);

  doc.setTextColor(243, 238, 226);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(17);
  doc.text('Book Detective Investigation Report', 15, 23);

  y = 42;

  doc.setTextColor(110, 100, 90);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Filed on: ${new Date().toLocaleString()}`, 15, y);
  y += 8;

  // Memory Query
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(140, 105, 40);
  doc.text('WITNESS MEMORY DESCRIPTION', 15, y);
  y += 6;

  doc.setFont('times', 'italic');
  doc.setFontSize(11);
  doc.setTextColor(35, 32, 28);
  y = addWrappedText(doc, `"${query.trim()}"`, 15, y, maxWidth, 5.5);
  y += 6;

  // Extracted Clues
  if (clues && clues.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(140, 105, 40);
    doc.text(`EXTRACTED CLUES (${clues.length})`, 15, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(45, 40, 35);
    for (const clue of clues) {
      y = addWrappedText(
        doc,
        `• [${clue.certainty.toUpperCase()}] ${clue.description}`,
        17,
        y,
        maxWidth - 4,
        5
      );
    }
    y += 6;
  }

  doc.setDrawColor(197, 168, 128);
  doc.line(15, y, pageWidth - 15, y);
  y += 8;

  // Candidate Hypotheses
  if (candidates && candidates.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(140, 105, 40);
    doc.text(`CANDIDATE HYPOTHESES (${candidates.length})`, 15, y);
    y += 8;

    candidates.forEach((c, idx) => {
      if (y > 245) {
        doc.addPage();
        y = 20;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(25, 22, 20);
      y = addWrappedText(
        doc,
        `${idx + 1}. ${c.title} — ${c.author || 'Unknown'} (${c.year || 'Year N/A'}) [${Math.round(
          c.memoryMatchScore * 100
        )}% Match]`,
        15,
        y,
        maxWidth,
        5.5
      );
      y += 1;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(55, 50, 45);
      y = addWrappedText(doc, `Summary: ${c.summary}`, 18, y, maxWidth - 4, 5);
      y = addWrappedText(doc, `Why It Matches: ${c.whyItMatches}`, 18, y, maxWidth - 4, 5);

      if (c.supportingEvidence?.length > 0) {
        y = addWrappedText(
          doc,
          `Supporting: ${c.supportingEvidence.join('; ')}`,
          18,
          y,
          maxWidth - 4,
          4.8
        );
      }
      y += 5;
    });
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(100, 95, 90);
    doc.text(
      'Open Cold Case / Investigation Entry — re-run in Book Detective to view full candidate analysis.',
      15,
      y
    );
  }

  const slug = makeShortLabel(query).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30) || 'Dossier';
  doc.save(`Book_Detective_${slug}.pdf`);
}
