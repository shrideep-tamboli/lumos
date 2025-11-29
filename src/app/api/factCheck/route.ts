import { NextResponse } from 'next/server';
import { GoogleGenAI } from "@google/genai";
import { groq } from '@ai-sdk/groq';
import { generateObject } from 'ai';
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
    Trust_Score: z.number().min(-100).max(100)
  }),
  z.array(
    z.object({
      claim: z.string(),
      Verdict: z.enum(["Support", "Partially Support", "Unclear", "Contradict", "Refute"]),
      Reason: z.string().min(1).max(600),
      Reference: z.array(z.string()).min(0).max(3),
      Trust_Score: z.number().min(-100).max(100)
    })
  )
]);

interface EmbeddingValue { values: number[]; }
interface EmbeddingResponse { embeddings: EmbeddingValue[]; }

// Rate limiting and retry configuration
const MAX_RETRIES = 3; // Maximum number of retries for a failed request
const INITIAL_RETRY_DELAY = 1000; // Initial retry delay in ms
const MAX_RETRY_DELAY = 60000; // Maximum retry delay in ms (1 minute)
const TOKENS_PER_MINUTE_LIMIT = 10000; // API limit: 10k tokens per minute
const REQUESTS_PER_MINUTE_LIMIT = 60; // API limit: 60 requests per minute

// Add these new variables at the top with other rate limiting variables
let lastRequestTimes: number[] = []; // For tracking request rate
let tokenEvents: { ts: number; tokens: number }[] = []

// Helper function to create a promise that rejects after a timeout
function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

let schedulerRunning = false;

interface QueueItem<T = unknown> {
  run: () => Promise<T>;
  estimatedTokens: number;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

// Array to hold pending queue items
const pendingQueue: QueueItem<unknown>[] = [];

async function scheduleLoop() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  while (pendingQueue.length > 0) {
    const now = Date.now();
    lastRequestTimes = lastRequestTimes.filter(t => now - t < 60000);
    tokenEvents = tokenEvents.filter(e => now - e.ts < 60000);
    const tokensUsed = tokenEvents.reduce((s, e) => s + e.tokens, 0);
    let reqSlots = Math.max(0, REQUESTS_PER_MINUTE_LIMIT - lastRequestTimes.length);
    let tokenBudget = Math.max(0, TOKENS_PER_MINUTE_LIMIT - tokensUsed);

    pendingQueue.sort((a, b) => a.estimatedTokens - b.estimatedTokens);

    let launched = 0;
    while (pendingQueue.length > 0 && reqSlots > 0) {
      const next = pendingQueue[0];
      if (next && next.estimatedTokens <= tokenBudget) {
        const item = pendingQueue.shift();
        if (item) {
          reqSlots -= 1;
          tokenBudget -= item.estimatedTokens;
          lastRequestTimes.push(now);
          tokenEvents.push({ ts: now, tokens: item.estimatedTokens });
          (async () => {
            try {
              const res = await withRetry(item.run);
              item.resolve(res);
            } catch (e) {
              item.reject(e);
            }
          })();
          launched += 1;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    if (launched === 0) {
      const nextReqWait = lastRequestTimes.length >= REQUESTS_PER_MINUTE_LIMIT ? Math.max(0, 60000 - (now - lastRequestTimes[0])) : 0;
      const nextTokWait = tokenEvents.length > 0 ? Math.max(0, 60000 - (now - tokenEvents[0].ts)) : 0;
      const waitTime = Math.max(nextReqWait, nextTokWait, 10);
      await new Promise(r => setTimeout(r, waitTime));
    } else {
      await new Promise(r => setTimeout(r, 0));
    }
  }
  schedulerRunning = false;
}

function enqueueRateLimited<T>(fn: () => Promise<T>, estimatedTokens: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const queueItem: QueueItem<T> = {
      run: fn,
      estimatedTokens,
      resolve: (value: T | PromiseLike<T>) => resolve(value),
      reject: (reason?: unknown) => reject(reason)
    };
    (pendingQueue as QueueItem<T>[]).push(queueItem);
    void scheduleLoop();
  });
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = INITIAL_RETRY_DELAY
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (retries <= 0) {
      throw error;
    }

    // Define interfaces for error types
    interface ErrorWithMessage {
      message: string;
      [key: string]: unknown;
    }

    interface ErrorWithResponse {
      response: {
        status: number;
        headers?: Record<string, unknown>;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }

    // Type guard for error with message
    const isErrorWithMessage = (e: unknown): e is ErrorWithMessage => {
      return typeof e === 'object' && e !== null && 'message' in e && 
             typeof (e as ErrorWithMessage).message === 'string';
    };

    // Type guard for error with response
    const isErrorWithResponse = (e: unknown): e is ErrorWithResponse => {
      if (typeof e !== 'object' || e === null) return false;
      const error = e as ErrorWithResponse;
      return 'response' in error && 
             typeof error.response === 'object' && 
             error.response !== null && 
             'status' in error.response;
    };

    // Check for rate limit error
    const isRateLimitError = 
      (isErrorWithMessage(error) && error.message.includes('Rate limit reached')) ||
      (isErrorWithResponse(error) && error.response.status === 429);

    if (isRateLimitError) {
      let retryAfter = delay;
      if (isErrorWithResponse(error)) {
        const headers = error.response.headers as Record<string, unknown> | undefined;
        if (headers) {
          if ('retry-after' in headers) {
            retryAfter = typeof headers['retry-after'] === 'number' 
              ? headers['retry-after'] 
              : delay;
          } else if ('x-ratelimit-reset-tokens' in headers) {
            retryAfter = typeof headers['x-ratelimit-reset-tokens'] === 'number'
              ? headers['x-ratelimit-reset-tokens']
              : delay;
          }
        }
      }
      
      const waitTime = Math.min(
        retryAfter * 1000,
        MAX_RETRY_DELAY
      );
      
      console.log(`Rate limited. Retrying in ${waitTime}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return withRetry(fn, retries - 1, Math.min(delay * 2, MAX_RETRY_DELAY));
    }

    // For other errors, use exponential backoff
    const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown error';
    console.log(`Error: ${errorMessage}. Retrying in ${delay}ms... (${retries} retries left)`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, Math.min(delay * 2, MAX_RETRY_DELAY));
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) return [];
  try {
    //console.log(`Generating embedding for text (${text.length} chars)`);
    //await rateLimit();
    const resp = await timeout(ai.models.embedContent({ 
      model: "text-embedding-004", 
      contents: text 
    }), 30000) as EmbeddingResponse; // 30s timeout for embedding
    
    const vals = resp.embeddings?.[0]?.values;
    if (!Array.isArray(vals)) {
      console.error('Invalid embedding response:', { response: resp });
      return [];
    }
    return vals;
  } catch (error) {
    console.error('Error generating embedding:', error instanceof Error ? error.message : 'Unknown error');
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
- Reference: Array of 1-3 exact quotes from the evidence (include source numbers like [Source 1])
- Trust_Score: Number based on evidence strength
  - 100: Support (claim is fully supported by evidence)
  - 50: Partially Support (claim is partially supported by evidence)
  - 0: Unclear/Contradict/Refute (insufficient or contradictory evidence, or evidence refutes the claim)

Format example:
[
  {
    "claim": "Example claim",
    "Verdict": "Support",
    "Reason": "Explain which sources support the verdict.",
    "Reference": ["[Source 1] Supporting evidence quote."],
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
        
        // Estimate tokens (roughly 1 token = 4 chars for English text)
        const estimatedTokens = Math.min(1200, Math.ceil(batchPrompt.length / 4));
        
        // Queue the request to respect RPM and TPM
        const result = await enqueueRateLimited(async () => {
          return await generateObject({
            model: groq('moonshotai/kimi-k2-instruct-0905'),
            schema: factCheckSchema,
            prompt: batchPrompt,
          });
        }, estimatedTokens);

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
            Trust_Score: 0
          });
        });
      }
    }

    // Calculate average trust score (excluding Unclear verdicts)
    const validScores = batchResults.filter(r => 
      typeof r.Trust_Score === 'number' && 
      !isNaN(r.Trust_Score) && 
      r.Verdict !== 'Unclear'
    );
    const averageTrustScore = validScores.length > 0 
      ? Math.round(validScores.reduce((sum, r) => sum + r.Trust_Score, 0) / validScores.length)
      : 0;

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
