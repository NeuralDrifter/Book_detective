export interface BookMatch {
  title: string;
  author: string;
  year?: string;
  summary: string;
  whyItMatches: string;
  confidence: number; // 0 to 1
  recipeMentioned?: string;
}

export async function findBooks(query: string, excludedTitles?: string[]): Promise<BookMatch[]> {
  try {
    const res = await fetch('/api/books', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, excludedTitles }),
    });

    if (!res.ok) {
      throw new Error('Failed to fetch from server');
    }

    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Error finding books:", error);
    return [];
  }
}
