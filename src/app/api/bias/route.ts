import { NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  vertexai: false,
});

interface BiasRequestBody {
  items: string[];
}

export async function POST(request: Request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured on the server.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { items } = body as BiasRequestBody;

    const texts = Array.isArray(items)
      ? items.map((s) => (typeof s === 'string' ? s.trim() : '')).filter((s) => s.length > 0)
      : [];

    if (texts.length === 0) {
      return NextResponse.json({ results: [], counts: { positive: 0, negative: 0, other: 0 }, percentages: { positive: 0, negative: 0, other: 0 } });
    }

    const prompt = `Classify each text as expressing a positive opinion, negative opinion, or neither/other.
Return a JSON array. For each input, include:
- text: original text
- label: one of ["Positive","Negative","Other"]
- rationale: short reason (max 1-2 sentences)

Texts:\n${JSON.stringify(texts, null, 2)}`;

    const gen = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              label: { type: Type.STRING, enum: ['Positive', 'Negative', 'Other'] },
              rationale: { type: Type.STRING },
            },
            required: ['text', 'label'],
            additionalProperties: false,
          },
        },
      },
    });

    let results: Array<{ text: string; label: 'Positive' | 'Negative' | 'Other'; rationale?: string }>; 
    try {
      results = JSON.parse(gen.text || '[]');
    } catch {
      results = [];
    }

    // Fallback alignment: if model returned a different size, remap best-effort
    if (!Array.isArray(results) || results.length === 0) {
      results = texts.map((t) => ({ text: t, label: 'Other' as const }));
    }

    const counts = results.reduce(
      (acc, r) => {
        if (r.label === 'Positive') acc.positive += 1;
        else if (r.label === 'Negative') acc.negative += 1;
        else acc.other += 1;
        return acc;
      },
      { positive: 0, negative: 0, other: 0 }
    );

    const total = results.length || 1;
    const percentages = {
      positive: Math.round((counts.positive / total) * 100),
      negative: Math.round((counts.negative / total) * 100),
      other: Math.round((counts.other / total) * 100),
    };

    return NextResponse.json({ results, counts, percentages });
  } catch (error) {
    console.error('Error in /api/bias:', error);
    return NextResponse.json({ error: 'Failed to classify opinions' }, { status: 500 });
  }
}
