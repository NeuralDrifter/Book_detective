import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

async function startServer() {
  const app = express();
  app.use(express.json());

  // API endpoint for catalog verification via Open Library
  app.post('/api/books/verify', async (req, res) => {
    try {
      const { title, author } = req.body;
      if (!title) {
        return res.json({ verificationStatus: 'unavailable' });
      }

      const searchQuery = encodeURIComponent(`${title} ${author || ''}`);
      const response = await fetch(`https://openlibrary.org/search.json?q=${searchQuery}&limit=3`, {
        signal: AbortSignal.timeout(6000)
      });
      
      if (!response.ok) {
        return res.json({ verificationStatus: 'unavailable' });
      }

      const data = await response.json();
      const docs = data.docs || [];

      if (docs.length === 0) {
        return res.json({ verificationStatus: 'not_found' });
      }

      const matchedDoc = docs[0];
      const matchTitle = matchedDoc.title || '';
      const matchAuthor = (matchedDoc.author_name || [])[0] || '';

      const titleLower = title.toLowerCase();
      const matchTitleLower = matchTitle.toLowerCase();
      
      if (matchTitleLower.includes(titleLower) || titleLower.includes(matchTitleLower)) {
        return res.json({
          verificationStatus: 'catalog_match',
          verificationSource: 'Open Library',
          verificationUrl: `https://openlibrary.org${matchedDoc.key || ''}`,
          matchedTitle: matchTitle,
          matchedAuthor: matchAuthor,
        });
      }

      return res.json({ verificationStatus: 'not_found' });
    } catch (error) {
      console.error('Error verifying book:', error);
      res.json({ verificationStatus: 'unavailable' });
    }
  });

  const ALLOWED_MODELS: Record<string, string> = {
    'default': 'gemini-3.8-flash',
    'gemini-3.8-flash': 'gemini-3.8-flash',
    'gemini-3.5-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-3.6-flash': 'gemini-3.6-flash',
    'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite',
    'gemini-3-flash-preview': 'gemini-3-flash-preview',
    'gemini-2.5-flash': 'gemini-2.5-flash',
  };

  // API endpoint for Hybrid Investigation
  app.post('/api/books/investigate', async (req, res) => {
    try {
      const { query, clues, rejectedCandidateIds, excludedTitles, answerHistory, round, model } = req.body;
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query string is required' });
      }

      const requestedModel = (model && ALLOWED_MODELS[model]) ? ALLOWED_MODELS[model] : 'gemini-3.8-flash';

      let contextPrompt = `Original Memory Description: "${query}"\n`;
      if (Array.isArray(clues) && clues.length > 0) {
        contextPrompt += `Extracted Clues so far:\n${clues.map((c: any) => `- [${c.certainty}] ${c.description}`).join('\n')}\n`;
      }
      if (Array.isArray(rejectedCandidateIds) && rejectedCandidateIds.length > 0) {
        contextPrompt += `Rejected Candidate IDs (Do not suggest these again): ${rejectedCandidateIds.join(', ')}\n`;
      }
      if (Array.isArray(excludedTitles) && excludedTitles.length > 0) {
        contextPrompt += `Excluded Titles (Do not suggest these): ${excludedTitles.join(', ')}\n`;
      }
      if (Array.isArray(answerHistory) && answerHistory.length > 0) {
        contextPrompt += `Previous Answers given by user:\n${answerHistory.join('\n')}\n`;
      }
      contextPrompt += `Current Investigation Round: ${round || 1}\n`;

      const contentsPrompt = `You are Book Detective, an expert literary investigator specializing in identifying real published books from incomplete, uncertain, fragmented, or distorted memories.
        
        ${contextPrompt}

        Follow the investigative principles:
        1. Treat memories as evidence, not guaranteed facts.
        2. Identify distinctive clues before generating hypotheses.
        3. Consider obscure, historical, regional, independently published, translated, and out-of-print works. Do not limit candidates to books present in major digital catalogs.
        4. Generate plausible real-book candidates (up to 5) with detailed supporting evidence, conflicting evidence, and uncertainties.
        5. Ask ONE high-information follow-up question with 2-4 answer options if additional evidence would improve the investigation. If no useful follow-up question is needed, omit it.

        Return a JSON object matching this schema:
        {
          "clues": [
            { "id": "...", "description": "...", "certainty": "explicit" | "uncertain" | "inferred", "source": "original" | "follow_up" }
          ],
          "candidates": [
            {
              "id": "...",
              "title": "...",
              "author": "...",
              "year": "...",
              "summary": "...",
              "whyItMatches": "...",
              "supportingEvidence": ["..."],
              "conflictingEvidence": ["..."],
              "uncertainties": ["..."],
              "memoryMatchScore": 0.95
            }
          ],
          "nextQuestion": {
            "question": "...",
            "options": ["...", "..."]
          }
        }`;

      const generationConfig = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            clues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  description: { type: Type.STRING },
                  certainty: { type: Type.STRING, enum: ["explicit", "uncertain", "inferred"] },
                  source: { type: Type.STRING, enum: ["original", "follow_up"] },
                },
                required: ["id", "description", "certainty", "source"],
              },
            },
            candidates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  author: { type: Type.STRING },
                  year: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  whyItMatches: { type: Type.STRING },
                  supportingEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
                  conflictingEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
                  uncertainties: { type: Type.ARRAY, items: { type: Type.STRING } },
                  memoryMatchScore: { type: Type.NUMBER },
                },
                required: ["id", "title", "summary", "whyItMatches", "supportingEvidence", "conflictingEvidence", "uncertainties", "memoryMatchScore"],
              },
            },
            nextQuestion: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["question", "options"],
            },
          },
          required: ["clues", "candidates"],
        },
      };

      let response;
      try {
        response = await ai.models.generateContent({
          model: requestedModel,
          contents: contentsPrompt,
          config: generationConfig,
        });
      } catch (primaryErr) {
        console.warn(`Model ${requestedModel} returned an error, falling back to gemini-3-flash-preview:`, primaryErr);
        try {
          response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: contentsPrompt,
            config: generationConfig,
          });
        } catch (fallbackErr) {
          response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contentsPrompt,
            config: generationConfig,
          });
        }
      }

      const responseText = response.text || '{}';
      const parsed = JSON.parse(responseText);
      res.json(parsed);
    } catch (error) {
      console.error('Error in /api/books/investigate:', error);
      res.status(500).json({ error: 'Failed to investigate book' });
    }
  });

  // Backward compatibility endpoint /api/books
  app.post('/api/books', async (req, res) => {
    try {
      const { query, excludedTitles } = req.body;
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query string is required' });
      }

      let exclusionInstruction = '';
      if (Array.isArray(excludedTitles) && excludedTitles.length > 0) {
        exclusionInstruction = `\n\nCRITICAL: Do NOT include any of the following books in your results because they were already tried:\n- ${excludedTitles.join('\n- ')}\n\nFind completely DIFFERENT alternative book matches.`;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are an objective literary detective. Analyze this book description and find the best matching books, novel series, fantasy, sci-fi, middle-grade, or classics from any decade: "${query}". 
        ${exclusionInstruction}
        
        Return a list of potential book matches with title, author, year, summary, whyItMatches, and confidence score.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                author: { type: Type.STRING },
                year: { type: Type.STRING },
                summary: { type: Type.STRING },
                whyItMatches: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                recipeMentioned: { type: Type.STRING },
              },
              required: ['title', 'author', 'summary', 'whyItMatches', 'confidence'],
            },
          },
        },
      });

      const responseText = response.text || '[]';
      const parsed = JSON.parse(responseText);
      res.json(parsed);
    } catch (error) {
      console.error('Error in /api/books:', error);
      res.status(500).json({ error: 'Failed to search books' });
    }
  });

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
