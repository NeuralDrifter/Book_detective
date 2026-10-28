/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Book, Sparkles, AlertCircle, Loader2, BookOpen, 
  History, Trash2, Bookmark, BookmarkCheck, X, 
  ExternalLink, Share2, Check,
  HelpCircle, CheckCircle2, ShieldCheck, ShieldAlert,
  CloudUpload, FolderOpen, FileText, LogOut, Cpu, ChevronDown,
  MoreVertical, FileDown, Pin
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { BookCandidate, DetectiveClue, InvestigationQuestion, VerificationStatus } from './types';
import { investigateBook, verifyCandidate, AVAILABLE_MODELS, DetectiveModelId } from './services/geminiService';
import {
  initAuth,
  googleSignIn,
  logout,
  listDriveCaseFiles,
  saveCandidateToDrive,
  saveFullInvestigationToDrive,
  readDriveFileContent,
  deleteDriveFile,
  loadUserArchiveFromDrive,
  syncUserArchiveToDrive,
  DriveCaseFile,
  UserColdCase,
  HistoryEntry,
} from './services/driveService';
import {
  loadLocalHistory,
  saveLocalHistory,
  clearLocalHistory,
  loadLocalColdCases,
  saveLocalColdCases,
  loadLocalBookmarks,
  saveLocalBookmarks,
  clearLocalBookmarks,
  mergeUserArchives,
  makeShortLabel,
  exportCandidateToPdf,
  exportInvestigationToPdf,
} from './services/archiveStorageAndPdfService';

interface PendingConfirmAction {
  title: string;
  message: string;
  confirmLabel: string;
  isDestructive?: boolean;
  onConfirm: () => Promise<void>;
}

interface ContextMenuState {
  x: number;
  y: number;
  type: 'coldCase' | 'history';
  id: string;
  label: string;
  query: string;
  clues?: DetectiveClue[];
  candidates?: BookCandidate[];
}

export default function App() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<BookCandidate[]>([]);
  const [clues, setClues] = useState<DetectiveClue[]>([]);
  const [nextQuestion, setNextQuestion] = useState<InvestigationQuestion | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [coldCases, setColdCases] = useState<UserColdCase[]>([]);
  const [bookmarks, setBookmarks] = useState<BookCandidate[]>([]);
  const [rejectedIds, setRejectedIds] = useState<string[]>([]);
  const [answerHistory, setAnswerHistory] = useState<string[]>([]);
  const [round, setRound] = useState(1);
  const [activeTab, setActiveTab] = useState<'search' | 'bookmarks'>('search');
  const [selectedBook, setSelectedBook] = useState<BookCandidate | null>(null);
  const [filterConfidence, setFilterConfidence] = useState<'all' | 'high'>('all');
  const [copied, setCopied] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [caseResolved, setCaseResolved] = useState(false);
  const [resolvedBookTitle, setResolvedBookTitle] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<DetectiveModelId>('default');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);

  // Custom Context Menu state for Right-Click & Three-Dots (⋮)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  // Google Drive Auth & Files state
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveCaseFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveStatusMsg, setDriveStatusMsg] = useState<string | null>(null);
  const [viewingDriveFile, setViewingDriveFile] = useState<{ name: string; content: string; webViewLink?: string } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const persistUserArchive = (
    nextColdCases: UserColdCase[],
    nextHistory: HistoryEntry[],
    nextBookmarks: BookCandidate[],
    syncToDrive: boolean = true
  ) => {
    saveLocalColdCases(nextColdCases);
    saveLocalHistory(nextHistory);
    saveLocalBookmarks(nextBookmarks);

    if (syncToDrive && driveToken) {
      syncUserArchiveToDrive({
        coldCases: nextColdCases,
        history: nextHistory,
        bookmarks: nextBookmarks,
        updatedAt: new Date().toISOString(),
      }).catch((err) => console.warn('Background Drive archive sync skipped:', err));
    }
  };

  useEffect(() => {
    const initialHistory = loadLocalHistory();
    const initialColdCases = loadLocalColdCases();
    const initialBookmarks = loadLocalBookmarks();

    setHistory(initialHistory);
    setColdCases(initialColdCases);
    setBookmarks(initialBookmarks);

    const savedModel = localStorage.getItem('book_detective_model') as DetectiveModelId | null;
    if (savedModel && AVAILABLE_MODELS.some((m) => m.id === savedModel)) {
      setSelectedModel(savedModel);
    }

    const unsubscribe = initAuth(
      (user, token) => {
        setDriveUser(user);
        setDriveToken(token);
      },
      () => {
        setDriveUser(null);
        setDriveToken(null);
        setDriveFiles([]);
      }
    );

    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);

    return () => {
      unsubscribe();
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  useEffect(() => {
    if (driveToken) {
      refreshDriveFilesAndSyncArchive();
    }
  }, [driveToken]);

  const refreshDriveFilesAndSyncArchive = async () => {
    setDriveLoading(true);
    try {
      const [files, remoteArchive] = await Promise.all([
        listDriveCaseFiles(),
        loadUserArchiveFromDrive(),
      ]);
      setDriveFiles(files);

      const localSnap = {
        coldCases: loadLocalColdCases(),
        history: loadLocalHistory(),
        bookmarks: loadLocalBookmarks(),
      };
      const merged = mergeUserArchives(localSnap, remoteArchive);
      setColdCases(merged.coldCases);
      setHistory(merged.history);
      setBookmarks(merged.bookmarks);
      saveLocalColdCases(merged.coldCases);
      saveLocalHistory(merged.history);
      saveLocalBookmarks(merged.bookmarks);

      await syncUserArchiveToDrive(merged);
    } catch (err) {
      console.error('Could not load Drive files:', err);
    } finally {
      setDriveLoading(false);
    }
  };

  const refreshDriveFiles = async () => {
    setDriveLoading(true);
    try {
      const files = await listDriveCaseFiles();
      setDriveFiles(files);
    } catch (err) {
      console.error('Could not load Drive files:', err);
    } finally {
      setDriveLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setDriveUser(result.user);
        setDriveToken(result.accessToken);
        showTransientDriveStatus('Connected to Google Drive • Synced Cold Cases & History');
      }
    } catch (err) {
      setError('Could not sign in with Google Drive. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setDriveUser(null);
    setDriveToken(null);
    setDriveFiles([]);
    showTransientDriveStatus('Disconnected from Google Drive (Using Local Storage & Cookies)');
  };

  const showTransientDriveStatus = (msg: string) => {
    setDriveStatusMsg(msg);
    setTimeout(() => setDriveStatusMsg(null), 4000);
  };

  const handleSaveCandidateToDrive = async (candidate: BookCandidate) => {
    if (!driveToken) {
      await handleGoogleLogin();
      return;
    }

    const safeTitle = candidate.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const expectedName = `Book_Detective_Case_${safeTitle}.md`;
    const existing = driveFiles.find((f) => f.name === expectedName);

    if (existing) {
      setPendingConfirm({
        title: 'Overwrite Existing Google Drive File?',
        message: `A case report named "${expectedName}" already exists in your Google Drive. Do you want to update and overwrite its contents?`,
        confirmLabel: 'Update File in Drive',
        isDestructive: false,
        onConfirm: async () => {
          const saved = await saveCandidateToDrive(candidate, query, existing.id);
          showTransientDriveStatus(`Updated "${saved.name}" in Google Drive`);
          await refreshDriveFiles();
        },
      });
      return;
    }

    setDriveLoading(true);
    try {
      const saved = await saveCandidateToDrive(candidate, query);
      showTransientDriveStatus(`Saved "${saved.name}" to Google Drive`);
      await refreshDriveFiles();
    } catch (err) {
      setError('Failed to save case report to Google Drive.');
    } finally {
      setDriveLoading(false);
    }
  };

  const handleSaveFullInvestigationToDrive = async () => {
    if (!driveToken) {
      await handleGoogleLogin();
      return;
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const expectedName = `Book_Detective_Full_Investigation_${timestamp}.md`;
    const existing = driveFiles.find((f) => f.name === expectedName);

    if (existing) {
      setPendingConfirm({
        title: 'Update Today\'s Investigation Dossier?',
        message: `An investigation dossier named "${expectedName}" already exists in your Google Drive. Would you like to overwrite it with your current results?`,
        confirmLabel: 'Overwrite Dossier',
        isDestructive: false,
        onConfirm: async () => {
          const saved = await saveFullInvestigationToDrive(query, clues, candidates, existing.id);
          showTransientDriveStatus(`Updated "${saved.name}" in Google Drive`);
          await refreshDriveFiles();
        },
      });
      return;
    }

    setDriveLoading(true);
    try {
      const saved = await saveFullInvestigationToDrive(query, clues, candidates);
      showTransientDriveStatus(`Saved full dossier "${saved.name}" to Google Drive`);
      await refreshDriveFiles();
    } catch (err) {
      setError('Failed to save full investigation to Google Drive.');
    } finally {
      setDriveLoading(false);
    }
  };

  const handleViewDriveFile = async (file: DriveCaseFile) => {
    setDriveLoading(true);
    try {
      const content = await readDriveFileContent(file.id);
      setViewingDriveFile({ name: file.name, content, webViewLink: file.webViewLink });
    } catch (err) {
      setError(`Could not read "${file.name}" from Google Drive.`);
    } finally {
      setDriveLoading(false);
    }
  };

  const requestDeleteDriveFile = (file: DriveCaseFile) => {
    setPendingConfirm({
      title: 'Delete File from Google Drive?',
      message: `Are you sure you want to permanently delete "${file.name}" from your Google Drive? This action cannot be undone.`,
      confirmLabel: 'Delete from Drive',
      isDestructive: true,
      onConfirm: async () => {
        await deleteDriveFile(file.id);
        showTransientDriveStatus(`Deleted "${file.name}" from Google Drive`);
        await refreshDriveFiles();
      },
    });
  };

  // Loading message rotator
  useEffect(() => {
    let interval: any;
    if (loading) {
      setLoadingStep(0);
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev + 1) % 3);
      }, 1800);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const loadingMessages = [
    "Dusting off vintage library archives by lamplight...",
    "Analyzing fragments, clues, and uncertain memories...",
    "Cross-referencing candidate hypotheses in background..."
  ];

  const handleModelChange = (modelId: DetectiveModelId) => {
    setSelectedModel(modelId);
    localStorage.setItem('book_detective_model', modelId);
  };

  const handleInvestigation = async (
    searchQuery: string = query,
    isFollowUp: boolean = false,
    answerText?: string,
    overrideModel?: DetectiveModelId
  ) => {
    if (!searchQuery.trim()) return;
    const activeModel = overrideModel || selectedModel;
    
    setLoading(true);
    setError(null);
    if (!isFollowUp) {
      setRejectedIds([]);
      setAnswerHistory([]);
      setRound(1);
      setCandidates([]);
      setClues([]);
      setCaseResolved(false);
      setResolvedBookTitle(null);
    }

    const updatedAnswers = answerText ? [...answerHistory, answerText] : answerHistory;
    if (answerText) {
      setAnswerHistory(updatedAnswers);
    }

    setActiveTab('search');

    try {
      const result = await investigateBook(
        searchQuery,
        clues,
        rejectedIds,
        candidates.map(c => c.title),
        updatedAnswers,
        round,
        activeModel
      );

      setCandidates(result.candidates);
      setClues(result.clues);
      setNextQuestion(result.nextQuestion);

      if (!isFollowUp) {
        const normalizedQuery = searchQuery.trim();
        const nowIso = new Date().toISOString();

        const newHistoryEntry: HistoryEntry = {
          id: `hist-${Date.now()}`,
          query: normalizedQuery,
          createdAt: nowIso,
          clues: result.clues,
          candidates: result.candidates,
        };
        const updatedHistory = [
          newHistoryEntry,
          ...history.filter((h) => h.query.trim().toLowerCase() !== normalizedQuery.toLowerCase()),
        ].slice(0, 12);
        setHistory(updatedHistory);

        // Also keep in the user's open Cold Cases until solved or deleted
        const existingCold = coldCases.find(
          (c) => c.query.trim().toLowerCase() === normalizedQuery.toLowerCase()
        );
        const updatedColdCases: UserColdCase[] = [
          {
            id: existingCold?.id || `cc-${Date.now()}`,
            label: existingCold?.label || makeShortLabel(normalizedQuery),
            query: normalizedQuery,
            createdAt: nowIso,
            clues: result.clues,
            candidates: result.candidates,
          },
          ...coldCases.filter((c) => c.query.trim().toLowerCase() !== normalizedQuery.toLowerCase()),
        ].slice(0, 12);
        setColdCases(updatedColdCases);

        persistUserArchive(updatedColdCases, updatedHistory, bookmarks, true);
      } else {
        setRound(prev => prev + 1);
      }

      // Automatically trigger background verification for each candidate independently
      verifyCandidatesInBackground(result.candidates);

    } catch (err) {
      setError('The library archives are temporarily locked. Please try your investigation again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCandidatesInBackground = async (currentCandidates: BookCandidate[]) => {
    for (const candidate of currentCandidates) {
      try {
        const verification = await verifyCandidate(candidate.title, candidate.author);
        setCandidates(prev => 
          prev.map(c => c.id === candidate.id ? { 
            ...c, 
            verificationStatus: verification.verificationStatus,
            verificationSource: verification.verificationSource,
            verificationUrl: verification.verificationUrl,
          } : c)
        );
      } catch (e) {
        setCandidates(prev => 
          prev.map(c => c.id === candidate.id ? { ...c, verificationStatus: 'unavailable' } : c)
        );
      }
    }
  };

  const rejectCandidate = (candidateId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRejectedIds(prev => [...prev, candidateId]);
    setCandidates(prev => prev.filter(c => c.id !== candidateId));
  };

  const toggleBookmark = (candidate: BookCandidate, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const exists = bookmarks.some(b => b.title === candidate.title && b.author === candidate.author);
    let updated: BookCandidate[];
    if (exists) {
      updated = bookmarks.filter(b => !(b.title === candidate.title && b.author === candidate.author));
    } else {
      updated = [candidate, ...bookmarks];
    }
    setBookmarks(updated);
    persistUserArchive(coldCases, history, updated, true);
  };

  const isBookmarked = (candidate: BookCandidate) => {
    return bookmarks.some(b => b.title === candidate.title && b.author === candidate.author);
  };

  const handlePinColdCase = (
    targetQuery: string,
    targetClues?: DetectiveClue[],
    targetCandidates?: BookCandidate[]
  ) => {
    const cleaned = targetQuery.trim();
    if (!cleaned) return;
    const exists = coldCases.some((c) => c.query.trim().toLowerCase() === cleaned.toLowerCase());
    const newCase: UserColdCase = {
      id: `cc-${Date.now()}`,
      label: makeShortLabel(cleaned),
      query: cleaned,
      createdAt: new Date().toISOString(),
      clues: targetClues,
      candidates: targetCandidates,
    };
    const updated = [
      newCase,
      ...coldCases.filter((c) => c.query.trim().toLowerCase() !== cleaned.toLowerCase()),
    ].slice(0, 12);
    setColdCases(updated);
    persistUserArchive(updated, history, bookmarks, true);
    showTransientDriveStatus(
      exists ? 'Updated Cold Case in your archive' : 'Pinned to your Cold Cases'
    );
  };

  const handleDeleteColdCase = (id: string) => {
    const updated = coldCases.filter((c) => c.id !== id);
    setColdCases(updated);
    persistUserArchive(updated, history, bookmarks, true);
    setContextMenu(null);
    showTransientDriveStatus('Removed Cold Case');
  };

  const handleDeleteHistoryItem = (id: string) => {
    const updated = history.filter((h) => h.id !== id);
    setHistory(updated);
    persistUserArchive(coldCases, updated, bookmarks, true);
    setContextMenu(null);
    showTransientDriveStatus('Removed investigation from history');
  };

  const handleDeleteAllHistory = () => {
    setHistory([]);
    clearLocalHistory();
    if (driveToken) {
      syncUserArchiveToDrive({
        coldCases,
        history: [],
        bookmarks,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
    setContextMenu(null);
    showTransientDriveStatus('Cleared all investigation history');
  };

  const handleResolveCase = (bookTitle: string) => {
    setCaseResolved(true);
    setResolvedBookTitle(bookTitle);
    const cleaned = query.trim().toLowerCase();
    if (cleaned) {
      const updatedCold = coldCases.filter((c) => c.query.trim().toLowerCase() !== cleaned);
      if (updatedCold.length !== coldCases.length) {
        setColdCases(updatedCold);
        persistUserArchive(updatedCold, history, bookmarks, true);
      }
    }
  };

  const openItemContextMenu = (
    e: React.MouseEvent,
    type: 'coldCase' | 'history',
    item: {
      id: string;
      label: string;
      query: string;
      clues?: DetectiveClue[];
      candidates?: BookCandidate[];
    }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 225;
    const menuHeight = 205;
    const clampedX = Math.min(e.clientX, window.innerWidth - menuWidth - 12);
    const clampedY = Math.min(e.clientY, window.innerHeight - menuHeight - 12);
    setContextMenu({
      x: Math.max(12, clampedX),
      y: Math.max(12, clampedY),
      type,
      id: item.id,
      label: item.label,
      query: item.query,
      clues: item.clues,
      candidates: item.candidates,
    });
  };

  const filteredCandidates = candidates.filter(book => {
    if (filterConfidence === 'high') return book.memoryMatchScore >= 0.8;
    return true;
  });

  const copyBookDetails = (book: BookCandidate) => {
    const text = `Case File: ${book.title} by ${book.author} (${book.year || 'Unknown Year'})\nSummary: ${book.summary}\nWhy it matches: ${book.whyItMatches}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderVerificationBadge = (status: VerificationStatus) => {
    switch (status) {
      case 'catalog_match':
        return (
          <span className="bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 text-[10px] uppercase font-sans font-bold px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm">
            <ShieldCheck size={12} /> Catalog Match Found
          </span>
        );
      case 'not_found':
        return (
          <span className="bg-amber-950/70 text-amber-300 border border-amber-700/60 text-[10px] uppercase font-sans font-bold px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm">
            <ShieldAlert size={12} /> Not Found in Checked Catalogs
          </span>
        );
      case 'unavailable':
        return (
          <span className="bg-[#2a2622] text-[#b5ae9e] border border-[#3a3530] text-[10px] uppercase font-sans font-bold px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm">
            Verification Unavailable
          </span>
        );
      default:
        return (
          <span className="bg-[#1c1a18] text-[#8c8270] border border-[#3a3530] text-[10px] uppercase font-sans font-bold px-2.5 py-1 rounded-full flex items-center gap-1 animate-pulse">
            Checking Sources...
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen px-4 py-8 md:py-16 selection:bg-[#D4AF37] selection:text-[#121110]">
      {/* Top Navigation / Status bar */}
      <div className="max-w-4xl mx-auto flex justify-between items-center mb-12 px-2 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#C5A880] rounded-2xl flex items-center justify-center text-[#121110] shadow-md">
            <BookOpen size={20} />
          </div>
          <div>
            <span className="font-sans font-bold tracking-widest uppercase text-[10px] text-[#C5A880] block opacity-90">
              Dept. B-12 Archive
            </span>
            <span className="text-sm font-serif italic text-[#d4cebd]">Hybrid Investigation Engine</span>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Google Drive Auth Button */}
          {driveUser && driveToken ? (
            <div className="flex items-center gap-2 bg-[#1c1a18]/90 border border-[#3a3530] rounded-full pl-3 pr-2 py-1 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-sans text-[#d4cebd] max-w-[140px] truncate">
                {driveUser.displayName || driveUser.email || 'Google Drive'}
              </span>
              <button
                onClick={handleGoogleLogout}
                title="Sign out of Google Drive"
                className="p-1.5 rounded-full text-[#8c8270] hover:text-white hover:bg-[#3a3530] transition-colors"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              className="flex items-center gap-2.5 bg-white hover:bg-gray-100 text-[#1f1f1f] font-sans text-xs font-medium px-3.5 py-2 rounded-full shadow-md transition-all disabled:opacity-50"
            >
              <div className="w-4 h-4 shrink-0">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-full h-full block">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span>{isLoggingIn ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>
          )}

          <div className="flex items-center gap-2 bg-[#1c1a18]/80 backdrop-blur border border-[#3a3530] rounded-full p-1 shadow-md">
            <button 
              onClick={() => setActiveTab('search')}
              className={`px-4 py-1.5 rounded-full text-xs font-sans font-medium transition-all ${activeTab === 'search' ? 'bg-[#C5A880] text-[#121110] shadow-sm font-semibold' : 'text-[#b5ae9e] hover:text-white'}`}
            >
              Active Case ({candidates.length})
            </button>
            <button 
              onClick={() => setActiveTab('bookmarks')}
              className={`px-4 py-1.5 rounded-full text-xs font-sans font-medium flex items-center gap-1.5 transition-all ${activeTab === 'bookmarks' ? 'bg-[#C5A880] text-[#121110] shadow-sm font-semibold' : 'text-[#b5ae9e] hover:text-white'}`}
            >
              <Bookmark size={12} />
              Saved & Drive ({bookmarks.length + driveFiles.length})
            </button>
          </div>
        </div>
      </div>

      {/* Transient Google Drive Toast Notification */}
      <AnimatePresence>
        {driveStatusMsg && (
          <motion.div
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="max-w-md mx-auto mb-6 bg-emerald-950/90 border border-emerald-700/70 text-emerald-200 px-4 py-2.5 rounded-2xl text-xs font-sans flex items-center justify-center gap-2 shadow-xl"
          >
            <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
            <span>{driveStatusMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="max-w-3xl mx-auto text-center mb-14 px-4">
        <motion.div 
          className="inline-block mb-3 px-4 py-1 rounded-full bg-[#C5A880]/15 border border-[#C5A880]/30 text-[#D4AF37] text-xs font-sans tracking-wider uppercase font-semibold shadow-inner"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Evidence-Driven Hybrid Detective Engine
        </motion.div>
        
        <motion.h1 
          className="text-5xl md:text-7xl font-light tracking-tight mb-4 text-[#f3eee2]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          Book <span className="serif-italic text-[#D4AF37]">Detective</span>
        </motion.h1>
        
        <motion.p 
          className="text-lg md:text-xl text-[#b5ae9e] max-w-xl mx-auto font-light leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Identify lost stories from fragmented memories, unusual recipes, characters, or locations. Gemini investigates while catalogs verify independently.
        </motion.p>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto">
        {activeTab === 'search' ? (
          <>
            {/* Search Box Card */}
            <motion.div 
              className="card-rounded p-6 md:p-8 mb-10 shadow-2xl relative"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className="absolute inset-0 rounded-[28px] overflow-hidden pointer-events-none">
                <div className="absolute top-0 right-0 w-36 h-36 bg-[#D4AF37]/5 rounded-bl-full" />
              </div>
              
              <div className="space-y-4 mb-6 relative z-10">
                <div className="relative group">
                  <Search className="absolute left-4 top-4 text-[#8c8270] group-focus-within:text-[#D4AF37] transition-colors" size={22} />
                  <textarea 
                    rows={4}
                    placeholder="Describe your memory: e.g., 'A young boy who becomes a wizard, travels with demons to different dimensions, was a thief before...'"
                    className="w-full pl-12 pr-4 pt-4 pb-4 rounded-2xl bg-[#121110]/80 border border-[#3a3530] text-[#f3eee2] placeholder-[#736a59] focus:bg-[#121110] focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 transition-all text-base md:text-lg font-sans outline-none resize-none shadow-inner"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleInvestigation(query, false);
                      }
                    }}
                  />
                </div>

                {/* Model Dropdown + Start Investigation Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs font-sans uppercase tracking-wider font-bold text-[#C5A880] shrink-0">
                      <Cpu size={14} className="text-[#D4AF37]" />
                      <span>Model:</span>
                    </div>

                    {/* Custom AI Studio Model Dropdown */}
                    <div className="relative" ref={modelDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setModelDropdownOpen((prev) => !prev)}
                        className="min-w-[250px] flex items-center justify-between gap-3 bg-[#171717] hover:bg-[#222222] border border-[#3a3530] focus:border-[#D4AF37] text-[#f3eee2] text-sm font-sans font-medium px-3.5 py-2.5 rounded-xl shadow-md transition-all"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span>
                            {AVAILABLE_MODELS.find((m) => m.id === selectedModel)?.name || 'Default (Gemini 3.8 Flash)'}
                          </span>
                          {AVAILABLE_MODELS.find((m) => m.id === selectedModel)?.isPaid && (
                            <span className="inline-flex items-center gap-1.5 bg-[#2a2b2e] border border-[#3c3d42] text-[#d1d5db] text-[11px] font-normal px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#60a5fa]" />
                              Paid
                            </span>
                          )}
                        </span>
                        <ChevronDown
                          size={16}
                          className={`text-[#b5ae9e] transition-transform duration-150 shrink-0 ${
                            modelDropdownOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      <AnimatePresence>
                        {modelDropdownOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.98 }}
                            transition={{ duration: 0.12 }}
                            className="absolute left-0 mt-1.5 w-[270px] bg-[#181818] border border-[#333333] rounded-xl shadow-2xl py-1.5 z-50 overflow-hidden"
                          >
                            {AVAILABLE_MODELS.map((m) => {
                              const isSelected = selectedModel === m.id;
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    handleModelChange(m.id);
                                    setModelDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-4 py-2.5 text-sm font-sans flex items-center justify-between transition-colors ${
                                    isSelected
                                      ? 'bg-[#2b2b2b] text-white font-medium'
                                      : 'text-[#e5e5e5] hover:bg-[#262626]'
                                  }`}
                                >
                                  <span className="flex items-center gap-2.5">
                                    <span>{m.name}</span>
                                    {m.isPaid && (
                                      <span className="inline-flex items-center gap-1.5 bg-[#2d2e32] border border-[#3e4046] text-[#d1d5db] text-xs font-normal px-2 py-0.5 rounded-full">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#60a5fa]" />
                                        Paid
                                      </span>
                                    )}
                                  </span>
                                  {isSelected && <Check size={14} className="text-[#D4AF37] shrink-0" />}
                                </button>
                              );
                            })}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {candidates.length > 0 && !loading && (
                      <button
                        type="button"
                        onClick={() => handleInvestigation(query, false, undefined, selectedModel)}
                        className="text-xs font-sans text-[#D4AF37] hover:underline font-medium flex items-center gap-1"
                      >
                        <Sparkles size={12} />
                        Re-run with this model
                      </button>
                    )}
                  </div>

                  <button 
                    onClick={() => handleInvestigation(query, false)}
                    disabled={loading || !query.trim()}
                    className="btn-primary flex items-center justify-center gap-2 py-3 px-8 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                    <span>{loading ? 'Investigating Clues...' : 'Start Investigation'}</span>
                  </button>
                </div>
              </div>

              {/* User-Specific Cold Cases */}
              <div className="border-t border-[#3a3530]/60 pt-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-sans font-bold uppercase tracking-wider text-[#8c8270]">
                      Your Cold Cases ({coldCases.length}):
                    </span>
                    <span className="text-[11px] font-sans text-[#736a59]">
                      Right-click or click ⋮ for options
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {query.trim() && (
                      <button
                        type="button"
                        onClick={() => handlePinColdCase(query, clues, candidates)}
                        className="text-xs font-sans text-[#D4AF37] hover:bg-[#C5A880]/15 border border-[#C5A880]/30 rounded-full px-3 py-1 flex items-center gap-1 transition-all"
                        title="Save current clues to your Cold Cases"
                      >
                        <Pin size={12} />
                        <span>Pin Current Clues</span>
                      </button>
                    )}
                    <span className="text-[10px] font-sans text-[#8c8270] bg-[#121110]/80 border border-[#3a3530] px-2.5 py-1 rounded-full">
                      {driveUser && driveToken ? 'Synced to Google Drive' : 'Saved Locally (Storage & Cookies)'}
                    </span>
                  </div>
                </div>

                {coldCases.length === 0 ? (
                  <p className="text-xs font-sans text-[#736a59] italic">
                    No open cold cases for your account yet. Unsolved investigations you run or pin will appear here.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {coldCases.map((cc) => (
                      <div
                        key={cc.id}
                        onContextMenu={(e) =>
                          openItemContextMenu(e, 'coldCase', {
                            id: cc.id,
                            label: cc.label,
                            query: cc.query,
                            clues: cc.clues,
                            candidates: cc.candidates,
                          })
                        }
                        className="group inline-flex items-center bg-[#121110] hover:border-[#D4AF37]/70 border border-[#3a3530] rounded-full pl-3.5 pr-1.5 py-1 transition-all text-[#d4cebd] shadow-sm select-none"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setQuery(cc.query);
                            handleInvestigation(cc.query, false);
                          }}
                          className="text-xs font-sans font-medium hover:text-[#D4AF37] transition-colors text-left truncate max-w-[230px]"
                          title={`${cc.query}\n(Right-click or click ⋮ for options)`}
                        >
                          {cc.label}
                        </button>
                        <button
                          type="button"
                          onClick={(e) =>
                            openItemContextMenu(e, 'coldCase', {
                              id: cc.id,
                              label: cc.label,
                              query: cc.query,
                              clues: cc.clues,
                              candidates: cc.candidates,
                            })
                          }
                          className="ml-1.5 p-1 rounded-full text-[#8c8270] hover:text-[#f3eee2] hover:bg-[#2a2622] transition-colors"
                          title="Cold case options"
                        >
                          <MoreVertical size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Error Banner */}
            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-red-950/80 border border-red-800/80 text-red-200 p-4 rounded-2xl mb-8 flex items-center gap-3 font-sans shadow-lg backdrop-blur"
                >
                  <AlertCircle size={20} className="shrink-0 text-red-400" />
                  <span className="text-sm">{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Loading Animation */}
            {loading && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card-rounded p-12 text-center mb-12 shadow-2xl border border-[#3a3530]"
              >
                <div className="w-16 h-16 bg-[#D4AF37]/15 text-[#D4AF37] rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                  <Loader2 size={32} className="animate-spin" />
                </div>
                <h3 className="text-2xl font-light mb-2 serif-italic text-[#f3eee2]">Analyzing Case Evidence...</h3>
                <AnimatePresence mode="wait">
                  <motion.p 
                    key={loadingStep}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="text-sm font-sans text-[#b5ae9e]"
                  >
                    {loadingMessages[loadingStep]}
                  </motion.p>
                </AnimatePresence>
              </motion.div>
            )}

            {/* Case Resolved Banner */}
            {caseResolved && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-emerald-950/90 border border-emerald-700/80 p-6 rounded-[24px] mb-8 text-center shadow-2xl"
              >
                <div className="w-12 h-12 bg-emerald-500 text-emerald-950 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={24} />
                </div>
                <h3 className="text-2xl font-medium text-emerald-200 mb-1">Case Solved!</h3>
                <p className="text-sm text-emerald-300/90 font-sans mb-4">
                  Reader confirmed: <strong className="text-white">{resolvedBookTitle}</strong>
                </p>
                <button
                  onClick={() => {
                    setCaseResolved(false);
                    setCandidates([]);
                    setQuery('');
                  }}
                  className="px-5 py-2 rounded-xl bg-emerald-800 text-white font-sans text-xs font-semibold hover:bg-emerald-700 transition-colors"
                >
                  Start New Investigation
                </button>
              </motion.div>
            )}

            {/* Extracted Clues Analysis Board */}
            {clues.length > 0 && !loading && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="card-rounded p-6 mb-8 border border-[#3a3530]"
              >
                <h3 className="text-xs uppercase font-sans font-bold text-[#D4AF37] tracking-widest mb-3 flex items-center gap-2">
                  <Sparkles size={14} /> Stage A: Extracted Memory Evidence ({clues.length} clues analyzed)
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {clues.map((clue) => (
                    <div key={clue.id} className="bg-[#121110] p-3 rounded-xl border border-[#3a3530]/60 flex items-start justify-between gap-3">
                      <p className="text-xs text-[#d4cebd] font-sans leading-relaxed">{clue.description}</p>
                      <span className={`text-[9px] uppercase font-sans font-bold px-2 py-0.5 rounded shrink-0 ${
                        clue.certainty === 'explicit' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                        clue.certainty === 'uncertain' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                        'bg-blue-950 text-blue-300 border border-blue-800'
                      }`}>
                        {clue.certainty}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Intelligent Follow-Up Question Panel */}
            {nextQuestion && !loading && !caseResolved && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="card-rounded p-6 mb-8 border border-[#D4AF37]/30 bg-gradient-to-br from-[#1c1a18] to-[#24211e]"
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] flex items-center justify-center shrink-0 mt-0.5">
                    <HelpCircle size={18} />
                  </div>
                  <div>
                    <h3 className="text-xs uppercase font-sans font-bold text-[#D4AF37] tracking-wider mb-1">Stage E: Detective Follow-Up Question</h3>
                    <p className="text-base text-[#f3eee2] font-serif italic">"{nextQuestion.question}"</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5 pl-11">
                  {nextQuestion.options.map((option, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleInvestigation(query, true, `Answer to "${nextQuestion.question}": ${option}`)}
                      className="px-4 py-2 rounded-xl bg-[#121110] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] text-xs font-sans text-[#d4cebd] transition-all font-medium shadow-sm"
                    >
                      {option}
                    </button>
                  ))}
                  <button
                    onClick={() => setNextQuestion(undefined)}
                    className="px-3 py-2 rounded-xl text-xs font-sans text-[#8c8270] hover:text-[#f3eee2] transition-colors"
                  >
                    Skip / Unsure
                  </button>
                </div>
              </motion.div>
            )}

            {/* Results Header & Filters */}
            {candidates.length > 0 && !loading && !caseResolved && (
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 px-2">
                <div>
                  <h2 className="text-2xl font-light serif-italic text-[#f3eee2]">Candidate Hypotheses</h2>
                  <p className="text-xs font-sans text-[#8c8270]">Generated {candidates.length} hypotheses (Catalog verification running independently)</p>
                </div>
                
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => exportInvestigationToPdf(query, clues, candidates)}
                    className="px-3.5 py-2 rounded-xl bg-[#1c1a18] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] text-xs font-sans font-medium text-[#d4cebd] flex items-center gap-1.5 transition-all shadow-sm"
                    title="Download Full Investigation Dossier as PDF"
                  >
                    <FileDown size={14} className="text-[#D4AF37]" />
                    <span>Save as PDF</span>
                  </button>

                  <button
                    onClick={handleSaveFullInvestigationToDrive}
                    disabled={driveLoading}
                    className="px-3.5 py-2 rounded-xl bg-[#1c1a18] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] text-xs font-sans font-medium text-[#D4AF37] flex items-center gap-1.5 transition-all shadow-sm"
                  >
                    <CloudUpload size={14} />
                    <span>Save Full Dossier to Drive</span>
                  </button>

                  <div className="flex items-center gap-2 bg-[#1c1a18] border border-[#3a3530] rounded-xl p-1 shadow-sm">
                    <span className="text-[10px] font-sans font-bold uppercase text-[#8c8270] px-2">Filter:</span>
                    <button 
                      onClick={() => setFilterConfidence('all')}
                      className={`px-3 py-1 rounded-lg text-xs font-sans transition-all ${filterConfidence === 'all' ? 'bg-[#3a3530] font-semibold text-[#f3eee2]' : 'text-[#8c8270] hover:text-white'}`}
                    >
                      All ({candidates.length})
                    </button>
                    <button 
                      onClick={() => setFilterConfidence('high')}
                      className={`px-3 py-1 rounded-lg text-xs font-sans transition-all ${filterConfidence === 'high' ? 'bg-[#C5A880]/20 text-[#D4AF37] font-semibold' : 'text-[#8c8270] hover:text-white'}`}
                    >
                      High Match ({candidates.filter(b => b.memoryMatchScore >= 0.8).length})
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Candidates Grid */}
            <div className="grid gap-6 md:grid-cols-2">
              <AnimatePresence mode="popLayout">
                {filteredCandidates.map((book, idx) => {
                  const saved = isBookmarked(book);
                  return (
                    <motion.div
                      key={book.id || book.title + idx}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: idx * 0.08 }}
                      onClick={() => setSelectedBook(book)}
                      className="card-rounded p-6 group hover:shadow-2xl transition-all cursor-pointer border border-[#3a3530]/80 relative flex flex-col justify-between hover:border-[#D4AF37]/50"
                    >
                      <div>
                        {/* Top badges */}
                        <div className="flex justify-between items-start mb-4 gap-2 flex-wrap">
                          <div className="w-12 h-12 bg-[#121110] rounded-2xl flex items-center justify-center text-[#C5A880] group-hover:bg-[#C5A880] group-hover:text-[#121110] transition-colors shadow-inner border border-[#3a3530] shrink-0">
                            <Book size={22} />
                          </div>
                          
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            {renderVerificationBadge(book.verificationStatus)}
                            <span className="bg-[#C5A880]/15 text-[#D4AF37] border border-[#C5A880]/30 text-[10px] uppercase font-sans font-bold px-2.5 py-1 rounded-full">
                              Match: {Math.round(book.memoryMatchScore * 100)}%
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                exportCandidateToPdf(book, query);
                              }}
                              className="p-2 rounded-xl bg-[#121110] text-[#d4cebd] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] transition-colors"
                              title="Save Case Report as PDF"
                            >
                              <FileDown size={15} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSaveCandidateToDrive(book);
                              }}
                              className="p-2 rounded-xl bg-[#121110] text-[#D4AF37] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] transition-colors"
                              title="Save Case Report to Google Drive"
                            >
                              <CloudUpload size={15} />
                            </button>
                            <button 
                              onClick={(e) => toggleBookmark(book, e)}
                              className={`p-2 rounded-xl transition-colors ${saved ? 'bg-[#C5A880] text-[#121110]' : 'bg-[#121110] text-[#b5ae9e] hover:bg-[#3a3530] border border-[#3a3530]'}`}
                              title={saved ? "Remove bookmark" : "Save to bookmarks"}
                            >
                              {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                            </button>
                          </div>
                        </div>
                        
                        <h3 className="text-2xl font-medium mb-1 text-[#f3eee2] group-hover:text-[#D4AF37] transition-colors">{book.title}</h3>
                        <p className="text-[#b5ae9e] font-sans text-sm mb-4 font-medium">{book.author || 'Author Unknown'} {book.year ? `(${book.year})` : ''}</p>
                        
                        <div className="bg-[#121110]/70 rounded-2xl p-4 mb-4 border border-[#3a3530]/50 shadow-inner">
                          <p className="text-sm leading-relaxed text-[#d4cebd] italic opacity-95 line-clamp-3">
                            "{book.summary}"
                          </p>
                        </div>

                        {/* Evidence breakdown */}
                        <div className="space-y-3 mb-4">
                          <div>
                            <p className="text-[10px] uppercase font-sans font-bold text-[#D4AF37] tracking-wider mb-1">Why it matches</p>
                            <p className="text-xs md:text-sm text-[#b5ae9e] line-clamp-2">{book.whyItMatches}</p>
                          </div>

                          {book.supportingEvidence.length > 0 && (
                            <div className="text-xs text-emerald-300/90 bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-900/60">
                              <span className="font-bold uppercase text-[9px] block text-emerald-400 mb-0.5">Supporting Evidence:</span>
                              {book.supportingEvidence[0]}
                            </div>
                          )}

                          {book.conflictingEvidence.length > 0 && (
                            <div className="text-xs text-amber-300/90 bg-amber-950/40 p-2.5 rounded-xl border border-amber-900/60">
                              <span className="font-bold uppercase text-[9px] block text-amber-400 mb-0.5">Conflicting Evidence / Uncertainties:</span>
                              {book.conflictingEvidence[0]}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-4 border-t border-[#3a3530] flex justify-between items-center text-xs font-sans">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResolveCase(book.title);
                            }}
                            className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
                          >
                            <Check size={14} /> Found It
                          </button>
                          <button
                            onClick={(e) => rejectCandidate(book.id, e)}
                            className="text-red-400 hover:text-red-300 font-semibold flex items-center gap-1"
                          >
                            <X size={14} /> Not a Match
                          </button>
                        </div>
                        <span className="text-[#8c8270] group-hover:text-[#D4AF37] transition-colors">
                          Inspect →
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Empty State when no active results */}
            {!loading && candidates.length === 0 && !error && history.length === 0 && (
              <div className="py-12">
                <div className="card-rounded p-12 max-w-lg mx-auto text-center border border-[#3a3530]">
                  <div className="w-16 h-16 bg-[#121110] rounded-full flex items-center justify-center mx-auto mb-4 text-[#8c8270] border border-[#3a3530]">
                    <BookOpen size={28} />
                  </div>
                  <h3 className="text-xl font-medium mb-2 text-[#f3eee2]">No active investigation</h3>
                  <p className="text-sm text-[#b5ae9e] font-sans">
                    Enter your memory fragments above to start investigating. Unsolved cases and history will automatically save to your archive.
                  </p>
                </div>
              </div>
            )}

            {/* Recent Investigations (History) with Right-Click, Three-Dots (⋮), Save as PDF, and Delete All History */}
            {!loading && history.length > 0 && (
              <div className="mt-12 pt-8 border-t border-[#3a3530]/60">
                <div className="max-w-3xl mx-auto">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-2">
                    <div className="flex items-center gap-2">
                      <History size={17} className="text-[#D4AF37]" />
                      <span className="text-xs uppercase font-sans font-bold tracking-widest text-[#d4cebd]">
                        Recent Investigations ({history.length})
                      </span>
                      <span className="text-[11px] font-sans text-[#736a59]">
                        • Right-click or click ⋮ on any item
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleDeleteAllHistory}
                      className="px-3 py-1.5 rounded-xl bg-red-950/50 hover:bg-red-900/60 border border-red-800/50 text-red-300 hover:text-red-200 text-xs font-sans font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <Trash2 size={13} /> Delete All History
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2.5">
                    {history.map((h) => (
                      <div
                        key={h.id}
                        onContextMenu={(e) =>
                          openItemContextMenu(e, 'history', {
                            id: h.id,
                            label: makeShortLabel(h.query),
                            query: h.query,
                            clues: h.clues,
                            candidates: h.candidates,
                          })
                        }
                        className="group inline-flex items-center bg-[#1c1a18] hover:border-[#D4AF37]/70 border border-[#3a3530] pl-4 pr-2 py-2 rounded-2xl text-sm text-[#d4cebd] transition-all shadow-md select-none"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setQuery(h.query);
                            handleInvestigation(h.query, false);
                          }}
                          className="text-left hover:text-[#D4AF37] transition-colors font-sans text-xs sm:text-sm"
                          title={`${h.query}\n(Right-click or click ⋮ for options)`}
                        >
                          {h.query.length > 52 ? h.query.substring(0, 52) + '…' : h.query}
                        </button>
                        <button
                          type="button"
                          onClick={(e) =>
                            openItemContextMenu(e, 'history', {
                              id: h.id,
                              label: makeShortLabel(h.query),
                              query: h.query,
                              clues: h.clues,
                              candidates: h.candidates,
                            })
                          }
                          className="ml-2 p-1 rounded-lg text-[#8c8270] hover:text-[#f3eee2] hover:bg-[#2a2622] transition-colors"
                          title="Investigation options"
                        >
                          <MoreVertical size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Bookmarks & Google Drive Saved Cases Tab */
          <div className="space-y-12">
            {/* Google Drive Archive Section */}
            <div className="card-rounded p-6 md:p-8 border border-[#3a3530]">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h2 className="text-2xl font-light serif-italic text-[#f3eee2] flex items-center gap-2">
                    <FolderOpen size={22} className="text-[#D4AF37]" />
                    Google Drive Case Archive
                  </h2>
                  <p className="text-xs font-sans text-[#8c8270]">
                    Save and manage your investigation reports, cold cases, and history directly in your Google Drive
                  </p>
                </div>

                {driveUser && driveToken && (
                  <button
                    onClick={refreshDriveFilesAndSyncArchive}
                    disabled={driveLoading}
                    className="px-4 py-2 rounded-xl bg-[#121110] hover:bg-[#3a3530] border border-[#3a3530] text-xs font-sans text-[#d4cebd] transition-colors"
                  >
                    {driveLoading ? 'Syncing Drive...' : 'Refresh & Sync Drive'}
                  </button>
                )}
              </div>

              {!driveUser || !driveToken ? (
                <div className="bg-[#121110]/80 rounded-2xl p-8 text-center border border-[#3a3530]">
                  <CloudUpload size={32} className="text-[#D4AF37] mx-auto mb-3 opacity-80" />
                  <h3 className="text-lg font-medium text-[#f3eee2] mb-2">Connect Google Drive to Save & Sync</h3>
                  <p className="text-xs font-sans text-[#b5ae9e] max-w-md mx-auto mb-6 leading-relaxed">
                    Sign in with Google to automatically sync your Cold Cases & History and export case reports directly to your Google Drive. When disconnected, your data is saved locally via storage and browser cookies.
                  </p>
                  <button
                    onClick={handleGoogleLogin}
                    disabled={isLoggingIn}
                    className="inline-flex items-center gap-2.5 bg-white hover:bg-gray-100 text-[#1f1f1f] font-sans text-xs font-medium px-5 py-2.5 rounded-full shadow-md transition-all"
                  >
                    <div className="w-4 h-4 shrink-0">
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-full h-full block">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                        <path fill="none" d="M0 0h48v48H0z"></path>
                      </svg>
                    </div>
                    <span>{isLoggingIn ? 'Signing in...' : 'Sign in with Google'}</span>
                  </button>
                </div>
              ) : driveFiles.length === 0 ? (
                <div className="bg-[#121110]/60 rounded-2xl p-8 text-center border border-[#3a3530]">
                  <FileText size={28} className="text-[#8c8270] mx-auto mb-2" />
                  <p className="text-sm text-[#d4cebd] mb-1">No exported dossier reports in your Google Drive yet</p>
                  <p className="text-xs font-sans text-[#8c8270]">
                    Your Cold Cases & History are automatically synced. Click the cloud upload icon on any candidate card or "Save Full Dossier to Drive" to export markdown case files.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {driveFiles.map((file) => (
                    <div
                      key={file.id}
                      className="bg-[#121110] p-4 rounded-2xl border border-[#3a3530] flex flex-col justify-between gap-3 hover:border-[#D4AF37]/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <FileText size={18} className="text-[#D4AF37] shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-sm font-sans font-medium text-[#f3eee2] truncate" title={file.name}>
                              {file.name}
                            </p>
                            {file.modifiedTime && (
                              <p className="text-[11px] font-sans text-[#8c8270]">
                                Updated {new Date(file.modifiedTime).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => requestDeleteDriveFile(file)}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/60 transition-colors shrink-0"
                          title="Delete from Google Drive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-[#3a3530]/60 text-xs font-sans">
                        <button
                          onClick={() => handleViewDriveFile(file)}
                          className="text-[#D4AF37] hover:underline font-medium"
                        >
                          Read Dossier
                        </button>
                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#b5ae9e] hover:text-white flex items-center gap-1"
                          >
                            Open in Drive <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Browser Bookmarks Section */}
            <div>
              <div className="flex justify-between items-center mb-6 px-2">
                <div>
                  <h2 className="text-2xl font-light serif-italic text-[#f3eee2]">Bookmarked Cases</h2>
                  <p className="text-xs font-sans text-[#8c8270]">{bookmarks.length} bookmarked investigations</p>
                </div>
                {bookmarks.length > 0 && (
                  <button 
                    onClick={() => {
                      setBookmarks([]);
                      clearLocalBookmarks();
                      if (driveToken) {
                        syncUserArchiveToDrive({
                          coldCases,
                          history,
                          bookmarks: [],
                          updatedAt: new Date().toISOString(),
                        }).catch(() => {});
                      }
                    }}
                    className="text-xs font-sans text-red-400 hover:text-red-300 flex items-center gap-1 bg-red-950/60 px-3 py-1.5 rounded-xl border border-red-800/60 transition-colors"
                  >
                    <Trash2 size={14} /> Clear All Bookmarks
                  </button>
                )}
              </div>

              {bookmarks.length === 0 ? (
                <div className="card-rounded p-12 text-center border border-[#3a3530]">
                  <div className="w-16 h-16 bg-[#121110] rounded-full flex items-center justify-center mx-auto mb-4 text-[#8c8270] border border-[#3a3530]">
                    <Bookmark size={28} />
                  </div>
                  <h3 className="text-xl font-medium mb-2 text-[#f3eee2]">No bookmarks yet</h3>
                  <p className="text-sm text-[#b5ae9e] font-sans max-w-sm mx-auto mb-6">Click the bookmark icon on any candidate card to save it to your archive.</p>
                  <button 
                    onClick={() => setActiveTab('search')}
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    Return to Active Investigation
                  </button>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {bookmarks.map((book, idx) => (
                    <div
                      key={book.id || book.title + idx}
                      onClick={() => setSelectedBook(book)}
                      className="card-rounded p-6 group hover:shadow-2xl transition-all cursor-pointer border border-[#3a3530] relative flex flex-col justify-between hover:border-[#D4AF37]/50"
                    >
                      <div>
                        <div className="flex justify-between items-start mb-4">
                          <div className="w-12 h-12 bg-[#D4AF37]/15 text-[#D4AF37] rounded-2xl flex items-center justify-center border border-[#D4AF37]/30">
                            <Book size={22} />
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                exportCandidateToPdf(book, query);
                              }}
                              className="p-2 rounded-xl bg-[#121110] text-[#d4cebd] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] transition-colors"
                              title="Save Case Report as PDF"
                            >
                              <FileDown size={16} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSaveCandidateToDrive(book);
                              }}
                              className="p-2 rounded-xl bg-[#121110] text-[#D4AF37] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] transition-colors"
                              title="Save to Google Drive"
                            >
                              <CloudUpload size={16} />
                            </button>
                            <button 
                              onClick={(e) => toggleBookmark(book, e)}
                              className="p-2 rounded-xl bg-[#C5A880] text-[#121110] hover:opacity-90 transition-opacity shadow-md"
                            >
                              <BookmarkCheck size={16} />
                            </button>
                          </div>
                        </div>
                        
                        <h3 className="text-2xl font-medium mb-1 text-[#f3eee2]">{book.title}</h3>
                        <p className="text-[#b5ae9e] font-sans text-sm mb-4 font-medium">{book.author} {book.year ? `(${book.year})` : ''}</p>
                        
                        <div className="bg-[#121110]/70 rounded-2xl p-4 mb-4 border border-[#3a3530] shadow-inner">
                          <p className="text-sm leading-relaxed text-[#d4cebd] italic opacity-95 line-clamp-3">
                            "{book.summary}"
                          </p>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-[#3a3530] flex justify-between items-center text-xs text-[#8c8270] font-sans">
                        <span>Saved in Archive</span>
                        <span className="text-[#D4AF37] font-medium group-hover:underline">View report →</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Mandatory User Confirmation Modal for Mutating/Destructive Google Drive Operations */}
      <AnimatePresence>
        {pendingConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-[#1c1a18] text-[#f3eee2] rounded-[28px] max-w-md w-full p-6 md:p-8 border border-[#3a3530] shadow-2xl"
            >
              <h3 className="text-2xl font-light mb-2 text-[#f3eee2]">{pendingConfirm.title}</h3>
              <p className="text-sm font-sans text-[#b5ae9e] leading-relaxed mb-6">
                {pendingConfirm.message}
              </p>
              <div className="flex justify-end items-center gap-3">
                <button
                  onClick={() => setPendingConfirm(null)}
                  disabled={confirmBusy}
                  className="px-4 py-2.5 rounded-xl bg-[#121110] text-[#b5ae9e] hover:text-white border border-[#3a3530] text-xs font-sans font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setConfirmBusy(true);
                    try {
                      await pendingConfirm.onConfirm();
                      setPendingConfirm(null);
                    } catch (err) {
                      setError('Google Drive operation failed. Please try again.');
                    } finally {
                      setConfirmBusy(false);
                    }
                  }}
                  disabled={confirmBusy}
                  className={`px-5 py-2.5 rounded-xl text-xs font-sans font-semibold transition-all ${
                    pendingConfirm.isDestructive
                      ? 'bg-red-700 hover:bg-red-600 text-white'
                      : 'bg-[#C5A880] hover:bg-[#D4AF37] text-[#121110]'
                  }`}
                >
                  {confirmBusy ? 'Working...' : pendingConfirm.confirmLabel}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Google Drive File Content Reader Modal */}
      <AnimatePresence>
        {viewingDriveFile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#1c1a18] text-[#f3eee2] rounded-[32px] max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-[#3a3530] p-6 md:p-8 relative"
            >
              <button
                onClick={() => setViewingDriveFile(null)}
                className="absolute right-6 top-6 w-10 h-10 bg-[#121110] rounded-full flex items-center justify-center text-[#b5ae9e] hover:bg-[#3a3530] hover:text-white border border-[#3a3530]"
              >
                <X size={20} />
              </button>
              <div className="flex items-center gap-2 text-xs font-sans text-[#D4AF37] uppercase tracking-wider font-bold mb-2">
                <FileText size={14} /> Google Drive Dossier
              </div>
              <h3 className="text-2xl font-light mb-4 pr-10 break-all">{viewingDriveFile.name}</h3>
              <pre className="bg-[#121110] p-5 rounded-2xl border border-[#3a3530] text-xs font-sans text-[#d4cebd] whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {viewingDriveFile.content}
              </pre>
              <div className="mt-6 flex justify-between items-center">
                {viewingDriveFile.webViewLink ? (
                  <a
                    href={viewingDriveFile.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-sans text-[#D4AF37] hover:underline flex items-center gap-1.5"
                  >
                    Open in Google Drive <ExternalLink size={14} />
                  </a>
                ) : <div />}
                <button onClick={() => setViewingDriveFile(null)} className="btn-primary">
                  Close Dossier
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detailed Candidate Modal */}
      <AnimatePresence>
        {selectedBook && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#1c1a18] text-[#f3eee2] rounded-[32px] max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-[#3a3530] p-6 md:p-8 relative"
            >
              <button 
                onClick={() => setSelectedBook(null)}
                className="absolute right-6 top-6 w-10 h-10 bg-[#121110] rounded-full flex items-center justify-center text-[#b5ae9e] hover:bg-[#3a3530] hover:text-white transition-colors border border-[#3a3530]"
              >
                <X size={20} />
              </button>

              <div className="flex items-center gap-3 mb-4 flex-wrap">
                {renderVerificationBadge(selectedBook.verificationStatus)}
                {selectedBook.year && (
                  <span className="text-xs font-sans text-[#8c8270] font-medium">Published: {selectedBook.year}</span>
                )}
                {selectedBook.verificationUrl && (
                  <a 
                    href={selectedBook.verificationUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs text-[#D4AF37] hover:underline flex items-center gap-1 font-sans"
                  >
                    View Catalog <ExternalLink size={12} />
                  </a>
                )}
              </div>

              <h2 className="text-3xl md:text-4xl font-light mb-1 text-[#f3eee2]">{selectedBook.title}</h2>
              <p className="text-lg text-[#b5ae9e] font-sans font-medium mb-6">By {selectedBook.author || 'Author Unknown'}</p>

              <div className="space-y-6">
                <div>
                  <h4 className="text-xs uppercase font-sans font-bold text-[#8c8270] tracking-wider mb-2">Book Summary</h4>
                  <div className="bg-[#121110] rounded-2xl p-5 border border-[#3a3530] shadow-inner">
                    <p className="text-[#d4cebd] italic leading-relaxed">
                      "{selectedBook.summary}"
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs uppercase font-sans font-bold text-[#8c8270] tracking-wider mb-2">Why It Matches Your Clues</h4>
                  <p className="text-[#b5ae9e] font-sans leading-relaxed text-sm bg-[#121110] p-4 rounded-2xl border border-[#3a3530]">
                    {selectedBook.whyItMatches}
                  </p>
                </div>

                {selectedBook.supportingEvidence.length > 0 && (
                  <div>
                    <h4 className="text-xs uppercase font-sans font-bold text-emerald-400 tracking-wider mb-2">Supporting Evidence</h4>
                    <ul className="space-y-1.5 bg-emerald-950/30 p-4 rounded-2xl border border-emerald-900/60 text-xs text-emerald-200">
                      {selectedBook.supportingEvidence.map((ev, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                          <span>{ev}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedBook.conflictingEvidence.length > 0 && (
                  <div>
                    <h4 className="text-xs uppercase font-sans font-bold text-amber-400 tracking-wider mb-2">Conflicting Evidence & Uncertainties</h4>
                    <ul className="space-y-1.5 bg-amber-950/30 p-4 rounded-2xl border border-amber-900/60 text-xs text-amber-200">
                      {selectedBook.conflictingEvidence.map((ev, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                          <span>{ev}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-[#3a3530] flex flex-wrap justify-between items-center gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => exportCandidateToPdf(selectedBook, query)}
                    className="px-4 py-2.5 rounded-xl font-sans text-xs font-medium flex items-center gap-2 bg-[#121110] text-[#d4cebd] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] transition-all"
                  >
                    <FileDown size={16} className="text-[#D4AF37]" />
                    <span>Save as PDF</span>
                  </button>

                  <button
                    onClick={() => handleSaveCandidateToDrive(selectedBook)}
                    disabled={driveLoading}
                    className="px-4 py-2.5 rounded-xl font-sans text-xs font-medium flex items-center gap-2 bg-[#121110] text-[#D4AF37] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] transition-all"
                  >
                    <CloudUpload size={16} />
                    <span>Save to Google Drive</span>
                  </button>

                  <button 
                    onClick={() => toggleBookmark(selectedBook)}
                    className={`px-4 py-2.5 rounded-xl font-sans text-xs font-medium flex items-center gap-2 transition-all ${isBookmarked(selectedBook) ? 'bg-[#C5A880] text-[#121110] font-semibold' : 'bg-[#121110] text-[#b5ae9e] hover:bg-[#3a3530] border border-[#3a3530]'}`}
                  >
                    {isBookmarked(selectedBook) ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                    {isBookmarked(selectedBook) ? 'Saved Locally' : 'Bookmark'}
                  </button>

                  <button 
                    onClick={() => copyBookDetails(selectedBook)}
                    className="px-4 py-2.5 rounded-xl font-sans text-xs font-medium flex items-center gap-2 bg-[#121110] text-[#b5ae9e] hover:bg-[#3a3530] hover:text-white border border-[#3a3530] transition-all"
                  >
                    {copied ? <Check size={16} className="text-green-400" /> : <Share2 size={16} />}
                    {copied ? 'Copied Citation!' : 'Copy Citation'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      handleResolveCase(selectedBook.title);
                      setSelectedBook(null);
                    }}
                    className="px-4 py-2.5 rounded-xl bg-emerald-800 text-white font-sans text-xs font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
                  >
                    <Check size={14} /> Found It
                  </button>
                  <button 
                    onClick={() => setSelectedBook(null)}
                    className="btn-primary"
                  >
                    Close Report
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Floating Context Menu for Cold Cases & Recent Investigations (Right-Click or ⋮) */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            ref={contextMenuRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onContextMenu={(e) => e.preventDefault()}
            className="fixed z-50 w-56 bg-[#181715] border border-[#3a3530] rounded-2xl shadow-2xl py-1.5 overflow-hidden font-sans"
          >
            <div className="px-3.5 py-2 border-b border-[#2c2824]">
              <p className="text-[10px] uppercase tracking-wider font-bold text-[#8c8270]">
                {contextMenu.type === 'coldCase' ? 'Cold Case Actions' : 'History Item Actions'}
              </p>
              <p className="text-xs text-[#f3eee2] truncate font-medium mt-0.5">
                {contextMenu.label}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                const q = contextMenu.query;
                setContextMenu(null);
                setQuery(q);
                handleInvestigation(q, false);
              }}
              className="w-full px-3.5 py-2.5 text-left text-xs text-[#d4cebd] hover:bg-[#262320] hover:text-white flex items-center gap-2.5 transition-colors"
            >
              <Search size={14} className="text-[#D4AF37]" />
              <span>Investigate Case</span>
            </button>

            <button
              type="button"
              onClick={() => {
                exportInvestigationToPdf(
                  contextMenu.query,
                  contextMenu.clues || [],
                  contextMenu.candidates || [],
                  contextMenu.type === 'coldCase' ? 'COLD CASE DOSSIER' : 'INVESTIGATION HISTORY REPORT'
                );
                setContextMenu(null);
              }}
              className="w-full px-3.5 py-2.5 text-left text-xs text-[#d4cebd] hover:bg-[#262320] hover:text-white flex items-center gap-2.5 transition-colors"
            >
              <FileDown size={14} className="text-[#D4AF37]" />
              <span>Save as PDF</span>
            </button>

            {contextMenu.type === 'history' && (
              <button
                type="button"
                onClick={() => {
                  handlePinColdCase(contextMenu.query, contextMenu.clues, contextMenu.candidates);
                  setContextMenu(null);
                }}
                className="w-full px-3.5 py-2.5 text-left text-xs text-[#d4cebd] hover:bg-[#262320] hover:text-white flex items-center gap-2.5 transition-colors"
              >
                <Pin size={14} className="text-[#D4AF37]" />
                <span>Pin to Cold Cases</span>
              </button>
            )}

            <div className="my-1 border-t border-[#2c2824]" />

            <button
              type="button"
              onClick={() => {
                if (contextMenu.type === 'coldCase') {
                  handleDeleteColdCase(contextMenu.id);
                } else {
                  handleDeleteHistoryItem(contextMenu.id);
                }
              }}
              className="w-full px-3.5 py-2.5 text-left text-xs text-red-400 hover:bg-red-950/50 hover:text-red-300 flex items-center gap-2.5 transition-colors font-medium"
            >
              <Trash2 size={14} />
              <span>
                {contextMenu.type === 'coldCase' ? 'Delete Cold Case' : 'Delete from History'}
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="mt-32 text-center opacity-55 hover:opacity-100 transition-opacity">
        <p className="font-sans text-xs uppercase tracking-widest text-[#8c8270]">
          Dept. B-12 Archive • Hybrid Investigation Engine
        </p>
      </footer>
    </div>
  );
}
