import { NextResponse } from 'next/server';
import { GoogleGenAI } from "@google/genai";
import { z } from 'zod';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  vertexai: false,
});

const factCheckSchema = z.union([
  z.object({
    claim: z.string(),
    Verdict: z.enum(["Support", "Partially Support", "Unclear", "Contradict", "Refute"]),
    Reason: z.string().min(1).max(600),
    Reference: z.array(z.string()).min(0).max(3),
    Trust_Score: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100)
    ]).nullable().optional()
  }).refine(
    (data) => {
      if (data.Verdict === 'Support') return data.Trust_Score === 100;
      if (data.Verdict === 'Partially Support') return data.Trust_Score === 50;
      if (['Unclear', 'Contradict', 'Refute'].includes(data.Verdict)) return data.Trust_Score === 0 || data.Trust_Score === null;
      return true;
    },
    {
      message: 'Verdict and Trust_Score combination is invalid',
      path: ['Trust_Score']
    }
  ),
  z.array(
    z.object({
      claim: z.string(),
      Verdict: z.enum(["Support", "Partially Support", "Unclear", "Contradict", "Refute"]),
      Reason: z.string().min(1).max(600),
      Reference: z.array(z.string()).min(0).max(3),
      Trust_Score: z.union([
        z.literal(0),
        z.literal(50),
        z.literal(100)
      ]).nullable().optional()
    }).refine(
      (data) => {
        if (data.Verdict === 'Support') return data.Trust_Score === 100;
        if (data.Verdict === 'Partially Support') return data.Trust_Score === 50;
        if (['Unclear', 'Contradict', 'Refute'].includes(data.Verdict)) return data.Trust_Score === 0 || data.Trust_Score === null;
        return true;
      },
      {
        message: 'Verdict and Trust_Score combination is invalid',
        path: ['Trust_Score']
      }
    )
  )
]);

interface EmbeddingValue { values: number[]; }
interface EmbeddingResponse { embeddings: EmbeddingValue[]; }

function enqueueRateLimited<T>(fn: () => Promise<T>): Promise<T> {
  // Server-side rate limiting disabled: execute immediately
  return fn();
}

let isOutOfQuota = false;
let quotaResetTime: number | null = null;

async function generateEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) return [];
  
  // Check if we're out of quota
  if (isOutOfQuota && quotaResetTime && Date.now() < quotaResetTime) {
    console.warn('Embedding API quota exhausted. Please check your billing status.');
    return [];
  } else if (isOutOfQuota) {
    // Reset the quota flag if the reset time has passed
    isOutOfQuota = false;
    quotaResetTime = null;
  }
  
  try {
    const resp = await enqueueRateLimited<EmbeddingResponse>(
      () => ai.models.embedContent({ 
        model: "text-embedding-004", 
        contents: text 
      }) as Promise<EmbeddingResponse>,
    );
    
    const vals = resp.embeddings?.[0]?.values;
    if (!Array.isArray(vals)) {
      console.error('Invalid embedding response:', { response: resp });
      return [];
    }
    return vals;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating embedding:', errorMessage);
    
    // Check for quota exceeded error
    if (errorMessage.includes('quota') || errorMessage.includes('Quota')) {
      isOutOfQuota = true;
      // Set reset time to 1 hour from now (adjust based on your quota reset period)
      quotaResetTime = Date.now() + 3600000; // 1 hour in milliseconds
      console.warn('Embedding API quota exhausted. Will retry after:', new Date(quotaResetTime).toISOString());
    }
    
    return [];
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

// Simple sentence splitter that handles common cases
function splitIntoSentences(text: string): string[] {
  if (!text) return [];
  // Split on sentence terminators followed by whitespace or end of string
  return text
    .replace(/([.!?])\s+/g, '$1|')
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// Get top N most relevant sentences to a claim
async function getTopSentences(claim: string, text: string, maxSentences: number = 3): Promise<string[]> {
  if (!text?.trim()) return [];
  
  const sentences = splitIntoSentences(text);
  // Skip embeddings if content is already short (huge performance win!)
  if (sentences.length <= maxSentences * 2) {
    //console.log(`⚡ Skipping embeddings - content already short (${sentences.length} sentences)`);
    return sentences.slice(0, maxSentences);
  }
  
  try {
    // Get embeddings for claim and all sentences in a single batch
    const textsToEmbed = [claim, ...sentences];
    const embeddings = await Promise.all(
      textsToEmbed.map(text => generateEmbedding(text))
    );
    
    const claimEmbedding = embeddings[0];
    if (!claimEmbedding?.length) return sentences.slice(0, maxSentences);
    
    // Calculate similarities and get top N sentences
    const sentenceScores = sentences.map((sentence, i) => ({
      text: sentence,
      score: cosineSimilarity(claimEmbedding, embeddings[i + 1] || [])
    }));
    
    return sentenceScores
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSentences)
      .sort((a, b) => 
        sentences.indexOf(a.text) - sentences.indexOf(b.text)
      )
      .map(item => item.text);
  } catch (error) {
    console.error('Error in getTopSentences:', error);
    return sentences.slice(0, maxSentences);
  }
}

interface FactCheckRequest {
  claims: Array<{
    claim: string;
    content: string | string[];
  }>;
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 9);
  
  console.log(`[${requestId}] Starting fact-check request`);
  
  try {
    const requestBody = await request.json();
    
    const { claims: claimContents } = requestBody as FactCheckRequest;

    if (!claimContents?.length) {
      return NextResponse.json({ error: 'No claims provided' }, { status: 400 });
    }

    // Process claims with sentence-level augmentation
    const processedClaims = [];
    const MAX_SOURCES_PER_CLAIM = 3;
    const MAX_SENTENCES_PER_SOURCE = 3;

    for (const { claim, content } of claimContents) {
      if (!content) {
        processedClaims.push({ claim, chunks: [] });
        continue;
      }

      // Process each source (either from array or split by SOURCE delimiter)
      const sources: string[] = Array.isArray(content) 
        ? content 
        : String(content).split('\n---SOURCE---\n');

      // Get top sentences from each source in parallel
      const sourcePromises = sources
        .slice(0, MAX_SOURCES_PER_CLAIM)
        .map(source => 
          getTopSentences(claim, source, MAX_SENTENCES_PER_SOURCE)
            .then(sentences => ({
              source: source.split('\n')[0] || 'Source', // Use first line as source identifier
              sentences: sentences.filter(Boolean)
            }))
        );

      // Wait for all sources to be processed
      const sourceResults = await Promise.allSettled(sourcePromises);
      
      // Combine results, filtering out any failed sources
      const validSources = sourceResults
        .filter((result): result is PromiseFulfilledResult<{source: string, sentences: string[]}> => 
          result.status === 'fulfilled' && 
          result.value.sentences.length > 0
        )
        .map(result => result.value);

      // Format the chunks with source information
      const chunks = validSources.map(({ source, sentences }) => 
        `[${source}] ${sentences.join(' ')}`
      );

      processedClaims.push({ 
        claim, 
        chunks: chunks.slice(0, MAX_SOURCES_PER_CLAIM) 
      });
    }

    // Filter out any claims without valid chunks
    const perClaimChunks = processedClaims.filter(item => item.chunks.length > 0);

    const prompt = `You are an expert fact-checking assistant. For each claim, analyze the provided evidence snippets from up to 3 sources. Each snippet is prefixed with [Source N] to indicate its origin.

For each claim, provide:
1. A verdict based on the evidence
2. A concise reason (1-3 sentences) explaining how the evidence leads to the verdict
2. The most relevant quotes supporting your verdict
3. A trust score based on the strength of evidence

Strictly output a JSON array where each element has these keys:
- claim: The original claim text
- Verdict: One of ["Support","Partially Support","Unclear","Contradict","Refute"]
- Reason: Short textual justification for the verdict referencing the evidence
- Reference: Array of 1-3 exact quotes from the evidence (include source numbers like [Source 1] OR [Source 2] etc.)
- Trust_Score: Number based on evidence strength
  - 100: Support (claim is fully supported by evidence)
  - 50: Partially Support (claim is partially supported by evidence)
  - 0: Contradict/Refute (evidence contradicts or refutes the claim)
  - null: Unclear (insufficient evidence to make a determination)

IMPORTANT: The Trust_Score MUST be set to exactly:
- 100 for 'Support' verdict
- 50 for 'Partially Support' verdict
- 0 for 'Contradict' or 'Refute' verdicts
- null for 'Unclear' verdict (this will be excluded from average calculation)

Format example:
[
  {
    "claim": "Example claim",
    "Verdict": "Support",
    "Reason": "Explain which sources support the verdict.",
    "Reference": ["[Source 1] OR [Source 2] etc Supporting evidence quote."],
    "Trust_Score": 100
  }
]`;
  
    // Helper function to normalize and validate results
    


    // Process claims in batches to avoid token limits
    const BATCH_SIZE = 1; // Adjust based on average claim complexity
    const batchResults = [];

    for (let i = 0; i < perClaimChunks.length; i += BATCH_SIZE) {
      const batch = perClaimChunks.slice(i, i + BATCH_SIZE);
      const batchPrompt = `${prompt}\n\nANALYZE THESE CLAIMS:\n${JSON.stringify(batch, null, 2)}`;

      try {
        console.log(`[${requestId}] Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(perClaimChunks.length / BATCH_SIZE)}`);
        
        // Queue the request
        const result = await enqueueRateLimited(async () => {
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: batchPrompt,
            config: {
              responseMimeType: "application/json",
            },
          });
          const parsed = JSON.parse(response.text || 'null');
          const validated = factCheckSchema.parse(parsed);
          return { object: validated } as { object: unknown };
        });

        try {
          const normalizedResults = Array.isArray(result.object) 
            ? result.object 
            : [result.object];
          console.log(`[${requestId}] Batch ${i / BATCH_SIZE + 1} completed with ${normalizedResults.length} results`);
          batchResults.push(...normalizedResults);
        } catch (parseError) {
          console.error(`[${requestId}] Error processing batch response:`, parseError);
          throw new Error('Failed to process model response');
        }
      } catch (error) {
        console.error(`Error processing batch ${i / BATCH_SIZE + 1}:`, error);
        // Add error placeholders for failed claims
        batch.forEach(({ claim }) => {
          batchResults.push({
            claim: claim || 'Unknown claim',
            Verdict: "Unclear",
            Reason: "Error processing claim",
            Reference: ["Error processing claim"],
            Trust_Score: null
          });
        });
      }
    }

    // Calculate average trust score (excluding Unclear verdicts and null scores)
    const validScores = batchResults.filter(r => 
      r.Trust_Score !== null && 
      r.Trust_Score !== undefined && 
      r.Verdict !== 'Unclear' &&
      typeof r.Trust_Score === 'number' && 
      !isNaN(r.Trust_Score)
    );
    const averageTrustScore = validScores.length > 0 
      ? Math.round(validScores.reduce((sum, r) => {
        const score = r.Trust_Score;
        return typeof score === 'number' ? sum + score : sum;
      }, 0) / validScores.length)
      : null;

    const duration = Date.now() - startTime;
    console.log(`[${requestId}] Completed fact-check in ${duration}ms`);
    
    return NextResponse.json({ 
      results: batchResults,
      averageTrustScore,
      requestId,
      durationMs: duration
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error(`[${requestId}] Error in /api/factCheck after ${duration}ms:`, errorMessage);
    
    if (error instanceof Error) {
      console.error(`[${requestId}] Error details:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    }
    
    return NextResponse.json({ 
      error: 'Failed to process fact-check request',
      details: errorMessage,
      requestId,
      durationMs: duration
    }, { 
      status: errorMessage.includes('time') ? 504 : 500 
    });
  }
}
