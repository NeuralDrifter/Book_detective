/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Search, Book, Sparkles, AlertCircle, Loader2, BookOpen, 
  ChefHat, History, Trash2, Bookmark, BookmarkCheck, X, 
  ExternalLink, Share2, Filter, Star, Check, RotateCcw 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BookMatch, findBooks } from './services/geminiService';

export default function App() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BookMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<BookMatch[]>([]);
  const [triedTitles, setTriedTitles] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'bookmarks'>('search');
  const [selectedBook, setSelectedBook] = useState<BookMatch | null>(null);
  const [filterConfidence, setFilterConfidence] = useState<'all' | 'high'>('all');
  const [copied, setCopied] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);

  useEffect(() => {
    const savedHistory = localStorage.getItem('book_detective_history');
    if (savedHistory) setHistory(JSON.parse(savedHistory));

    const savedBookmarks = localStorage.getItem('book_detective_bookmarks');
    if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
  }, []);

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
    "Cross-referencing childhood catalogs across dimensions...",
    "Decoding vague plot clues and excluding previous misses..."
  ];

  const handleSearch = async (searchQuery: string = query, isRetry: boolean = false) => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    setError(null);
    if (!isRetry) {
      setTriedTitles([]);
      setResults([]);
    }
    setActiveTab('search');

    try {
      const currentExcluded = isRetry ? triedTitles : [];
      const matches = await findBooks(searchQuery, currentExcluded);
      
      // Filter out any duplicates already tried just in case
      const newMatches = matches.filter(m => !currentExcluded.includes(m.title));
      setResults(newMatches);

      // Accumulate tried titles
      const newlyTried = [...currentExcluded, ...newMatches.map(m => m.title)];
      setTriedTitles(newlyTried);
      
      const newHistory = [searchQuery, ...history.filter(h => h !== searchQuery)].slice(0, 6);
      setHistory(newHistory);
      localStorage.setItem('book_detective_history', JSON.stringify(newHistory));
    } catch (err) {
      setError('The library archives are temporarily locked. Please try your search again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleBookmark = (book: BookMatch, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const exists = bookmarks.some(b => b.title === book.title && b.author === book.author);
    let updated: BookMatch[];
    if (exists) {
      updated = bookmarks.filter(b => !(b.title === book.title && b.author === book.author));
    } else {
      updated = [book, ...bookmarks];
    }
    setBookmarks(updated);
    localStorage.setItem('book_detective_bookmarks', JSON.stringify(updated));
  };

  const isBookmarked = (book: BookMatch) => {
    return bookmarks.some(b => b.title === book.title && b.author === book.author);
  };

  const featuredMysteries = [
    {
      label: "Myth Adventures (Skeeve & Aahz)",
      query: "A young boy who becomes a wizard. He travels with demons to different places. He was a thief before. Demons is an acronym, creatures from other dimensions."
    },
    {
      label: "Pop Rocks Brownies",
      query: "Early 2000s chapter book geared towards late elementary school/middle school girls with a recipe for pop rocks brownies."
    },
    {
      label: "Secret Treehouse Business",
      query: "90s chapter book about two girls starting a club or business in a treehouse or backyard."
    }
  ];

  const filteredResults = results.filter(book => {
    if (filterConfidence === 'high') return book.confidence >= 0.8;
    return true;
  });

  const copyBookDetails = (book: BookMatch) => {
    const text = `Case File: ${book.title} by ${book.author} (${book.year || 'Unknown Year'})\nSummary: ${book.summary}\nWhy it matches: ${book.whyItMatches}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen px-4 py-8 md:py-16 selection:bg-[#D4AF37] selection:text-[#121110]">
      {/* Top Navigation / Status bar */}
      <div className="max-w-4xl mx-auto flex justify-between items-center mb-12 px-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#C5A880] rounded-2xl flex items-center justify-center text-[#121110] shadow-md">
            <BookOpen size={20} />
          </div>
          <div>
            <span className="font-sans font-bold tracking-widest uppercase text-[10px] text-[#C5A880] block opacity-90">
              Dept. B-12 Archive
            </span>
            <span className="text-sm font-serif italic text-[#d4cebd]">Noir Book Detective</span>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-[#1c1a18]/80 backdrop-blur border border-[#3a3530] rounded-full p-1 shadow-md">
          <button 
            onClick={() => setActiveTab('search')}
            className={`px-4 py-1.5 rounded-full text-xs font-sans font-medium transition-all ${activeTab === 'search' ? 'bg-[#C5A880] text-[#121110] shadow-sm font-semibold' : 'text-[#b5ae9e] hover:text-white'}`}
          >
            Active Search ({results.length})
          </button>
          <button 
            onClick={() => setActiveTab('bookmarks')}
            className={`px-4 py-1.5 rounded-full text-xs font-sans font-medium flex items-center gap-1.5 transition-all ${activeTab === 'bookmarks' ? 'bg-[#C5A880] text-[#121110] shadow-sm font-semibold' : 'text-[#b5ae9e] hover:text-white'}`}
          >
            <Bookmark size={12} />
            Saved Cases ({bookmarks.length})
          </button>
        </div>
      </div>

      {/* Header */}
      <header className="max-w-3xl mx-auto text-center mb-14 px-4">
        <motion.div 
          className="inline-block mb-3 px-4 py-1 rounded-full bg-[#C5A880]/15 border border-[#C5A880]/30 text-[#D4AF37] text-xs font-sans tracking-wider uppercase font-semibold shadow-inner"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Confidential Inquiry Service • Archive Desk
        </motion.div>
        
        <motion.h1 
          className="text-5xl md:text-7xl font-light tracking-tight mb-4 text-[#f3eee2]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          Book <span className="serif-italic text-[#D4AF37]">Scribe</span>
        </motion.h1>
        
        <motion.p 
          className="text-lg md:text-xl text-[#b5ae9e] max-w-xl mx-auto font-light leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Recover lost stories from your childhood by the glow of the desk lamp. Provide plot fragments, dimensions, or vague memories—we'll reconstruct the case file.
        </motion.p>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto">
        {activeTab === 'search' ? (
          <>
            {/* Search Box Card */}
            <motion.div 
              className="card-rounded p-6 md:p-8 mb-10 shadow-2xl relative overflow-hidden"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className="absolute top-0 right-0 w-36 h-36 bg-[#D4AF37]/5 rounded-bl-full pointer-events-none" />
              
              <div className="relative group mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8c8270] group-focus-within:text-[#D4AF37] transition-colors" size={22} />
                <textarea 
                  rows={3}
                  placeholder="Describe your memory: e.g., 'A young boy who becomes a wizard, travels with demons to different dimensions, was a thief before...'"
                  className="w-full pl-12 pr-4 py-4 rounded-2xl bg-[#121110]/80 border border-[#3a3530] text-[#f3eee2] placeholder-[#736a59] focus:bg-[#121110] focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 transition-all text-base md:text-lg font-sans outline-none resize-none shadow-inner"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSearch(query, false);
                    }
                  }}
                />
                <div className="absolute right-3 bottom-3 flex items-center gap-2">
                  <button 
                    onClick={() => handleSearch(query, false)}
                    disabled={loading || !query.trim()}
                    className="btn-primary flex items-center gap-2 py-3 px-6 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                    <span>{loading ? 'Searching Archives...' : 'Investigate Case'}</span>
                  </button>
                </div>
              </div>

              {/* Preset Mysteries */}
              <div className="border-t border-[#3a3530]/60 pt-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-sans font-bold uppercase tracking-wider text-[#8c8270]">Cold Cases:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {featuredMysteries.map((mystery, idx) => (
                    <button 
                      key={idx}
                      onClick={() => {
                        setQuery(mystery.query);
                        handleSearch(mystery.query, false);
                      }}
                      className="text-xs font-sans bg-[#121110] hover:bg-[#C5A880] hover:text-[#121110] border border-[#3a3530] rounded-full px-3.5 py-1.5 transition-all text-[#d4cebd] font-medium shadow-sm"
                    >
                      ✨ {mystery.label}
                    </button>
                  ))}
                </div>
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
                <h3 className="text-2xl font-light mb-2 serif-italic text-[#f3eee2]">Analyzing Case File...</h3>
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

            {/* Results Header & Filters */}
            {results.length > 0 && !loading && (
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 px-2">
                <div>
                  <h2 className="text-2xl font-light serif-italic text-[#f3eee2]">Case Files Discovered</h2>
                  <p className="text-xs font-sans text-[#8c8270]">Found {results.length} potential literary matches {triedTitles.length > 0 ? `(Excluded ${triedTitles.length} previous)` : ''}</p>
                </div>
                
                <div className="flex items-center gap-2 bg-[#1c1a18] border border-[#3a3530] rounded-xl p-1 shadow-sm">
                  <span className="text-[10px] font-sans font-bold uppercase text-[#8c8270] px-2">Filter:</span>
                  <button 
                    onClick={() => setFilterConfidence('all')}
                    className={`px-3 py-1 rounded-lg text-xs font-sans transition-all ${filterConfidence === 'all' ? 'bg-[#3a3530] font-semibold text-[#f3eee2]' : 'text-[#8c8270] hover:text-white'}`}
                  >
                    All ({results.length})
                  </button>
                  <button 
                    onClick={() => setFilterConfidence('high')}
                    className={`px-3 py-1 rounded-lg text-xs font-sans transition-all ${filterConfidence === 'high' ? 'bg-[#C5A880]/20 text-[#D4AF37] font-semibold' : 'text-[#8c8270] hover:text-white'}`}
                  >
                    High Confidence ({results.filter(b => b.confidence >= 0.8).length})
                  </button>
                </div>
              </div>
            )}

            {/* Results Grid */}
            <div className="grid gap-6 md:grid-cols-2">
              <AnimatePresence mode="popLayout">
                {filteredResults.map((book, idx) => {
                  const saved = isBookmarked(book);
                  return (
                    <motion.div
                      key={book.title + idx}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: idx * 0.08 }}
                      onClick={() => setSelectedBook(book)}
                      className="card-rounded p-6 group hover:shadow-2xl transition-all cursor-pointer border border-[#3a3530]/80 relative flex flex-col justify-between hover:border-[#D4AF37]/50"
                    >
                      <div>
                        <div className="flex justify-between items-start mb-4">
                          <div className="w-12 h-12 bg-[#121110] rounded-2xl flex items-center justify-center text-[#C5A880] group-hover:bg-[#C5A880] group-hover:text-[#121110] transition-colors shadow-inner border border-[#3a3530]">
                            <Book size={22} />
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {book.confidence >= 0.8 && (
                              <span className="bg-[#C5A880]/15 text-[#D4AF37] border border-[#C5A880]/30 text-[10px] uppercase font-sans font-bold px-2.5 py-1 rounded-full">
                                {Math.round(book.confidence * 100)}% Match
                              </span>
                            )}
                            <button 
                              onClick={(e) => toggleBookmark(book, e)}
                              className={`p-2 rounded-xl transition-colors ${saved ? 'bg-[#C5A880] text-[#121110]' : 'bg-[#121110] text-[#b5ae9e] hover:bg-[#3a3530] border border-[#3a3530]'}`}
                              title={saved ? "Remove bookmark" : "Save to bookmarks"}
                            >
                              {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                            </button>
                          </div>
                        </div>
                        
                        <h3 className="text-2xl font-medium mb-1 text-[#f3eee2] group-hover:text-[#D4AF37] transition-colors">{book.title}</h3>
                        <p className="text-[#b5ae9e] font-sans text-sm mb-4 font-medium">{book.author} {book.year ? `(${book.year})` : ''}</p>
                        
                        <div className="bg-[#121110]/70 rounded-2xl p-4 mb-4 border border-[#3a3530]/50 shadow-inner">
                          <p className="text-sm leading-relaxed text-[#d4cebd] italic opacity-95 line-clamp-3">
                            "{book.summary}"
                          </p>
                        </div>

                        <div className="space-y-3 mb-4">
                          <div className="flex items-start gap-2.5">
                            <Sparkles size={16} className="text-[#D4AF37] mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[10px] uppercase font-sans font-bold text-[#8c8270] tracking-wider">Why it matches</p>
                              <p className="text-xs md:text-sm text-[#b5ae9e] line-clamp-2">{book.whyItMatches}</p>
                            </div>
                          </div>
                          
                          {book.recipeMentioned && (
                            <div className="flex items-start gap-2.5 p-3 bg-[#D4AF37]/5 rounded-xl border border-[#D4AF37]/20">
                              <ChefHat size={16} className="text-[#D4AF37] mt-0.5 shrink-0" />
                              <div>
                                <p className="text-[10px] uppercase font-sans font-bold text-[#D4AF37] tracking-wider">Recipe / Lore Clue</p>
                                <p className="text-xs md:text-sm text-[#b5ae9e] line-clamp-2">{book.recipeMentioned}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-4 border-t border-[#3a3530] flex justify-between items-center text-xs text-[#8c8270] font-sans">
                        <span>Click card for full case report</span>
                        <span className="group-hover:translate-x-1 transition-transform text-[#D4AF37] font-medium flex items-center gap-1">
                          View details →
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Try Again / Exclude Previous Results Button */}
            {results.length > 0 && !loading && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-10 text-center"
              >
                <button
                  onClick={() => handleSearch(query, true)}
                  disabled={loading}
                  className="px-6 py-3.5 rounded-2xl bg-[#1c1a18] hover:bg-[#3a3530] border border-[#3a3530] text-[#D4AF37] font-sans text-xs uppercase font-bold tracking-widest transition-all shadow-xl inline-flex items-center gap-2 hover:scale-105 active:scale-95"
                >
                  <RotateCcw size={16} /> Not quite right? Try alternative matches (excluding {triedTitles.length} previous)
                </button>
              </motion.div>
            )}

            {/* Empty State / History */}
            {!loading && results.length === 0 && !error && (
              <div className="text-center py-12">
                {history.length > 0 ? (
                  <div className="max-w-xl mx-auto">
                    <div className="flex items-center justify-center gap-2 mb-6">
                      <History size={18} className="text-[#8c8270]" />
                      <span className="text-xs uppercase font-sans font-bold tracking-widest text-[#8c8270]">Recent Investigations</span>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2 mb-8">
                      {history.map((h, i) => (
                        <button 
                          key={i} 
                          onClick={() => {
                            setQuery(h);
                            handleSearch(h, false);
                          }}
                          className="bg-[#1c1a18] border border-[#3a3530] px-4 py-2.5 rounded-2xl text-sm text-[#d4cebd] hover:border-[#D4AF37] hover:text-[#D4AF37] transition-all shadow-md"
                        >
                          {h.length > 45 ? h.substring(0, 45) + '...' : h}
                        </button>
                      ))}
                      <button 
                        onClick={() => {
                          setHistory([]);
                          localStorage.removeItem('book_detective_history');
                        }}
                        className="px-3 py-2 text-red-400 hover:text-red-300 text-xs font-sans flex items-center gap-1 transition-colors"
                      >
                        <Trash2 size={14} /> Clear History
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="card-rounded p-12 max-w-lg mx-auto text-center border border-[#3a3530]">
                    <div className="w-16 h-16 bg-[#121110] rounded-full flex items-center justify-center mx-auto mb-4 text-[#8c8270] border border-[#3a3530]">
                      <BookOpen size={28} />
                    </div>
                    <h3 className="text-xl font-medium mb-2 text-[#f3eee2]">No active investigation</h3>
                    <p className="text-sm text-[#b5ae9e] font-sans">Enter a query above or click one of the cold case presets to start searching your childhood library.</p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* Bookmarks / Saved Cases Tab */
          <div>
            <div className="flex justify-between items-center mb-6 px-2">
              <div>
                <h2 className="text-2xl font-light serif-italic text-[#f3eee2]">Saved Case Files</h2>
                <p className="text-xs font-sans text-[#8c8270]">{bookmarks.length} bookmarked investigations</p>
              </div>
              {bookmarks.length > 0 && (
                <button 
                  onClick={() => {
                    setBookmarks([]);
                    localStorage.removeItem('book_detective_bookmarks');
                  }}
                  className="text-xs font-sans text-red-400 hover:text-red-300 flex items-center gap-1 bg-red-950/60 px-3 py-1.5 rounded-xl border border-red-800/60 transition-colors"
                >
                  <Trash2 size={14} /> Clear All Saved
                </button>
              )}
            </div>

            {bookmarks.length === 0 ? (
              <div className="card-rounded p-16 text-center border border-[#3a3530]">
                <div className="w-16 h-16 bg-[#121110] rounded-full flex items-center justify-center mx-auto mb-4 text-[#8c8270] border border-[#3a3530]">
                  <Bookmark size={28} />
                </div>
                <h3 className="text-xl font-medium mb-2 text-[#f3eee2]">No saved cases yet</h3>
                <p className="text-sm text-[#b5ae9e] font-sans max-w-sm mx-auto mb-6">Click the bookmark icon on any search result card to save it to your permanent detective archive.</p>
                <button 
                  onClick={() => setActiveTab('search')}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  Return to Active Search
                </button>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {bookmarks.map((book, idx) => (
                  <div
                    key={book.title + idx}
                    onClick={() => setSelectedBook(book)}
                    className="card-rounded p-6 group hover:shadow-2xl transition-all cursor-pointer border border-[#3a3530] relative flex flex-col justify-between hover:border-[#D4AF37]/50"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <div className="w-12 h-12 bg-[#D4AF37]/15 text-[#D4AF37] rounded-2xl flex items-center justify-center border border-[#D4AF37]/30">
                          <Book size={22} />
                        </div>
                        <button 
                          onClick={(e) => toggleBookmark(book, e)}
                          className="p-2 rounded-xl bg-[#C5A880] text-[#121110] hover:opacity-90 transition-opacity shadow-md"
                        >
                          <BookmarkCheck size={16} />
                        </button>
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
        )}
      </main>

      {/* Detailed Book Modal */}
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

              <div className="flex items-center gap-3 mb-4">
                <span className="bg-[#C5A880]/15 text-[#D4AF37] text-xs font-sans uppercase font-bold tracking-wider px-3 py-1 rounded-full border border-[#C5A880]/30">
                  Verified Case File
                </span>
                {selectedBook.year && (
                  <span className="text-xs font-sans text-[#8c8270] font-medium">Published: {selectedBook.year}</span>
                )}
              </div>

              <h2 className="text-3xl md:text-4xl font-light mb-1 text-[#f3eee2]">{selectedBook.title}</h2>
              <p className="text-lg text-[#b5ae9e] font-sans font-medium mb-6">By {selectedBook.author}</p>

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

                {selectedBook.recipeMentioned && (
                  <div>
                    <h4 className="text-xs uppercase font-sans font-bold text-[#D4AF37] tracking-wider mb-2 flex items-center gap-1.5">
                      <ChefHat size={16} /> Recipe / Lore Clue
                    </h4>
                    <p className="text-[#b5ae9e] font-sans leading-relaxed text-sm bg-[#121110] p-4 rounded-2xl border border-[#D4AF37]/20">
                      {selectedBook.recipeMentioned}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-[#3a3530] flex flex-wrap justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => toggleBookmark(selectedBook)}
                    className={`px-4 py-2.5 rounded-xl font-sans text-xs font-medium flex items-center gap-2 transition-all ${isBookmarked(selectedBook) ? 'bg-[#C5A880] text-[#121110] font-semibold' : 'bg-[#121110] text-[#b5ae9e] hover:bg-[#3a3530] border border-[#3a3530]'}`}
                  >
                    {isBookmarked(selectedBook) ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                    {isBookmarked(selectedBook) ? 'Saved in Bookmarks' : 'Save to Bookmarks'}
                  </button>

                  <button 
                    onClick={() => copyBookDetails(selectedBook)}
                    className="px-4 py-2.5 rounded-xl font-sans text-xs font-medium flex items-center gap-2 bg-[#121110] text-[#b5ae9e] hover:bg-[#3a3530] hover:text-white border border-[#3a3530] transition-all"
                  >
                    {copied ? <Check size={16} className="text-green-400" /> : <Share2 size={16} />}
                    {copied ? 'Copied Citation!' : 'Copy Citation'}
                  </button>
                </div>

                <button 
                  onClick={() => setSelectedBook(null)}
                  className="btn-primary"
                >
                  Close Report
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="mt-32 text-center opacity-55 hover:opacity-100 transition-opacity">
        <p className="font-sans text-xs uppercase tracking-widest text-[#8c8270]">
          Dept. B-12 Archive • Powered by Gemini 2.5 Flash
        </p>
      </footer>
    </div>
  );
}
