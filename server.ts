import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

async function startServer() {
  const app = express();
  app.use(express.json());

  // API endpoint for finding books server-side with support for excluding previous results
  app.post('/api/books', async (req, res) => {
    try {
      const { query, excludedTitles } = req.body;
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query string is required' });
      }

      let exclusionInstruction = '';
      if (Array.isArray(excludedTitles) && excludedTitles.length > 0) {
        exclusionInstruction = `\n\nCRITICAL: Do NOT include any of the following books in your results because they were already tried and were incorrect:\n- ${excludedTitles.join('\n- ')}\n\nFind completely DIFFERENT alternative book matches.`;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are an objective literary detective. Analyze this book description and find the best matching books, novel series, fantasy, sci-fi, middle-grade, or classics from any decade: "${query}". 
        ${exclusionInstruction}
        
        Return a diverse list of potential book matches in JSON format.`,
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
