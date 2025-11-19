import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

type SentenceCategory = 'Verifiable' | 'Partially Verifiable' | 'Not Verifiable';

interface ProcessedSentence {
  originalSentence: string;
  category: SentenceCategory;
  categoryReasoning: string;
  rewrittenSentence?: string;
  rewriteReasoning?: string;
  isAmbiguous: boolean;
  ambiguityType?: 'referential' | 'structural';
  ambiguityReasoning?: string;
  canBeDisambiguated?: boolean;
  disambiguationReasoning?: string;
  disambiguatedSentence?: string;
  clarityReasoning?: string;
  finalClaim: string | null;
  implicitClaims?: string[];
  implicitClaimsReasoning?: string;
}

interface InternalProcessedSentence extends ProcessedSentence {
  id: string;
  candidateSentence?: string;
  disambiguationSource?: 'original' | 'rewritten';
}

interface CategorizationInput {
  id: string;
  sentence: string;
}

interface CategorizationResult extends CategorizationInput {
  category: SentenceCategory;
  reasoning: string;
}

interface RewriteInput {
  id: string;
  sentence: string;
  reasoning: string;
}

interface RewrittenPartial {
  id: string;
  originalSentence: string;
  reasoning: string;
  rewrittenSentence: string;
}

interface DisambiguationInput {
  id: string;
  sentence: string;
}

interface DisambiguationResult {
  id: string;
  sentence: string;
  isAmbiguous: boolean;
  reasoning: string;
  ambiguityType?: 'referential' | 'structural';
  ambiguityReasoning?: string;
  canBeDisambiguated?: boolean;
  disambiguationReasoning?: string;
  disambiguatedSentence?: string;
  clarityReasoning?: string;
}

interface ImplicitClaimInput {
  id: string;
  sentence: string;
  category: SentenceCategory;
  reasoning: string;
}

interface ImplicitClaimResult {
  id: string;
  originalSentence: string;
  hasImplicitClaims: boolean;
  implicitClaims: string[];
  reasoning: string;
}

const DEFAULT_CATEGORY_REASONING = 'Failed to categorize this sentence';

function isHindiText(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  const devanagariPattern = /[\u0900-\u097F]/g;
  const devanagariMatches = text.match(devanagariPattern);
  const devanagariCount = devanagariMatches ? devanagariMatches.length : 0;

  if (devanagariCount === 0) return false;

  const allLetters = text.match(/[\u0900-\u097Fa-zA-Z]/g);
  const totalLetterCount = allLetters ? allLetters.length : 0;

  if (totalLetterCount === 0) {
    return devanagariCount >= 5;
  }

  const devanagariRatio = devanagariCount / totalLetterCount;
  return devanagariRatio > 0.15 || devanagariCount >= 20;
}

function splitHindiIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[।.!?])\s+|(?<=[।.!?])$/gm)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 500)
    .filter(s => {
      const withoutPunctuation = s.replace(/[।.!?\s\u0900-\u097F]/g, '');
      const hasDevanagari = /[\u0900-\u097F]/.test(s);
      const hasContent = s.replace(/[।.!?\s]/g, '').length > 0;
      return hasContent && (hasDevanagari || withoutPunctuation.length > 0);
    });
}

function splitEnglishIntoSentences(text: string): string[] {
  return text
    .split(/(?<=\S[\.!?]\s+)(?=[A-Z])/g)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 500)
    .filter(s => !/^[\s\d\W]+$/.test(s));
}

function splitIntoSentences(text: string): string[] {
  if (isHindiText(text)) {
    console.log('Detected Hindi text, using Hindi sentence splitting');
    return splitHindiIntoSentences(text);
  }

  console.log('Detected English text, using English sentence splitting');
  return splitEnglishIntoSentences(text);
}

async function categorizeSentences(items: CategorizationInput[]): Promise<CategorizationResult[]> {
  if (items.length === 0) return [];

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `You are an expert assistant that categorizes sentences based on verifiability.

IMPORTANT: Even if a sentence is a question, rhetorical statement, or contains subjective language, it may contain IMPLICIT factual claims that can be extracted and fact-checked.

For example:
- "What is China afraid of to keep Tibet in such tight control?" → Contains implicit claim: "China exercises tight control over Tibet"
- "Why are Tibetans living in such inhuman conditions?" → Contains implicit claim: "Tibetans are living in poor conditions"

Each item includes:
- id: unique identifier (return unchanged)
- sentence: sentence text

For every item, respond with:
- id
- sentence
- category: one of "Verifiable", "Partially Verifiable", "Not Verifiable"
  - "Verifiable": Contains explicit, objective, falsifiable claims
  - "Partially Verifiable": Contains implicit factual claims hidden in rhetorical/subjective language, OR mix of verifiable and subjective elements
  - "Not Verifiable": Pure opinion, speculation, or no factual content whatsoever
- reasoning: concise justification (if "Partially Verifiable" due to implicit claims, mention this)

Items:\n${JSON.stringify(items, null, 2)}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const response = await result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      return parsed as CategorizationResult[];
    }

    throw new Error('Invalid response format: expected array');
  } catch (error) {
    console.error('Error categorizing sentences:', error);
    return items.map(item => ({
      ...item,
      category: 'Not Verifiable',
      reasoning: DEFAULT_CATEGORY_REASONING,
    }));
  }
}

async function rewritePartiallyVerifiable(items: RewriteInput[]): Promise<RewrittenPartial[]> {
  if (items.length === 0) return [];

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `You assist fact-checkers. Each item includes:
- id: unique identifier (return unchanged)
- sentence: partially verifiable sentence
- reasoning: explanation of which parts are verifiable

Rewrite each sentence to keep only the objective, verifiable content. If nothing verifiable remains, set rewrittenSentence to "".

Return JSON array with:
- id
- originalSentence
- reasoning
- rewrittenSentence

Items:\n${JSON.stringify(items, null, 2)}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const response = await result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      return parsed as RewrittenPartial[];
    }
    throw new Error('Invalid response format: expected array');
  } catch (error) {
    console.error('Error rewriting partially verifiable sentences:', error);
    return items.map(item => ({
      id: item.id,
      originalSentence: item.sentence,
      reasoning: item.reasoning,
      rewrittenSentence: '',
    }));
  }
}

async function extractImplicitClaims(items: ImplicitClaimInput[]): Promise<ImplicitClaimResult[]> {
  if (items.length === 0) return [];

  // Only process sentences that are "Not Verifiable" or "Partially Verifiable" 
  // and might contain implicit claims (questions, rhetorical statements, etc.)
  const candidates = items.filter(item => 
    item.category === 'Not Verifiable' || item.category === 'Partially Verifiable'
  );

  if (candidates.length === 0) {
    return items.map(item => ({
      id: item.id,
      originalSentence: item.sentence,
      hasImplicitClaims: false,
      implicitClaims: [],
      reasoning: 'No implicit claims to extract',
    }));
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `You assist fact-checkers by extracting implicit factual claims from rhetorical, opinionated, or question-based sentences.

CRITICAL: Extract factual sub-claims that can be objectively verified, even if the original sentence is a question or contains subjective language.

Examples:
- Input: "What is China afraid of to keep Tibet in such tight control?"
  Output: ["China exercises tight control over Tibet"]
  
- Input: "Why are Tibetans living in such inhuman conditions?"
  Output: ["Tibetans are living in poor conditions"]
  
- Input: "This is the best product ever"
  Output: [] (no verifiable factual claim)

Each item includes:
- id: unique identifier (return unchanged)
- sentence: the original sentence
- category: current categorization
- reasoning: why it was categorized that way

For each item, return:
- id
- originalSentence
- hasImplicitClaims: boolean (true if you found extractable factual claims)
- implicitClaims: array of strings (each string is a factual claim that can be verified)
- reasoning: explanation of what claims were extracted and why

Return JSON array. If no implicit claims exist, set hasImplicitClaims to false and implicitClaims to empty array.

Items:\n${JSON.stringify(candidates, null, 2)}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const response = await result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      const extractedMap = new Map(parsed.map((item: ImplicitClaimResult) => [item.id, item]));
      
      // Return results for all items, with extracted claims for candidates
      return items.map(item => {
        const extracted = extractedMap.get(item.id);
        if (extracted) {
          return extracted;
        }
        return {
          id: item.id,
          originalSentence: item.sentence,
          hasImplicitClaims: false,
          implicitClaims: [],
          reasoning: 'No implicit claims detected',
        };
      });
    }
    throw new Error('Invalid response format: expected array');
  } catch (error) {
    console.error('Error extracting implicit claims:', error);
    return items.map(item => ({
      id: item.id,
      originalSentence: item.sentence,
      hasImplicitClaims: false,
      implicitClaims: [],
      reasoning: 'Error extracting implicit claims',
    }));
  }
}

async function disambiguateSentences(items: DisambiguationInput[]): Promise<DisambiguationResult[]> {
  if (items.length === 0) return [];

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `You assist fact-checkers by detecting ambiguity.

Each JSON item contains:
- id: unique identifier (return unchanged)
- sentence: sentence to analyze

For each item return:
- id
- sentence
- isAmbiguous (boolean)
- reasoning
- If ambiguous: ambiguityType, ambiguityReasoning, canBeDisambiguated, disambiguationReasoning, disambiguatedSentence (if clarity is possible)
- If not ambiguous: clarityReasoning

Return JSON array.

Items:\n${JSON.stringify(items, null, 2)}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const response = await result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      return parsed as DisambiguationResult[];
    }
    throw new Error('Invalid response format: expected array');
  } catch (error) {
    console.error('Error disambiguating sentences:', error);
    return items.map(item => ({
      id: item.id,
      sentence: item.sentence,
      isAmbiguous: false,
      reasoning: 'Error analyzing sentence for ambiguity',
      clarityReasoning: 'An error occurred while attempting to analyze this sentence.',
    }));
  }
}

async function processSentencesMultiStep(sentences: string[]): Promise<{
  processedSentences: ProcessedSentence[];
  processedImplicitClaims: ProcessedSentence[];
}> {
  if (sentences.length === 0) return { processedSentences: [], processedImplicitClaims: [] };

  const sentenceItems: CategorizationInput[] = sentences.map((sentence, index) => ({
    id: `sentence-${index}`,
    sentence,
  }));

  const categorized = await categorizeSentences(sentenceItems);
  const categorizedMap = new Map(categorized.map(item => [item.id, item]));

  const processed: InternalProcessedSentence[] = sentenceItems.map(item => {
    const categorization = categorizedMap.get(item.id);
    return {
      id: item.id,
      originalSentence: item.sentence,
      category: categorization?.category ?? 'Not Verifiable',
      categoryReasoning: categorization?.reasoning ?? DEFAULT_CATEGORY_REASONING,
      isAmbiguous: false,
      finalClaim: null,
    };
  });

  // Extract implicit claims from sentences that might contain them
  const implicitClaimInputs: ImplicitClaimInput[] = processed.map(p => ({
    id: p.id,
    sentence: p.originalSentence,
    category: p.category,
    reasoning: p.categoryReasoning,
  }));

  const implicitClaimsResults = await extractImplicitClaims(implicitClaimInputs);
  const implicitClaimsMap = new Map(implicitClaimsResults.map(result => [result.id, result]));

  // Store implicit claims in processed sentences
  processed.forEach(entry => {
    const implicitResult = implicitClaimsMap.get(entry.id);
    if (implicitResult && implicitResult.hasImplicitClaims && implicitResult.implicitClaims.length > 0) {
      entry.implicitClaims = implicitResult.implicitClaims;
      entry.implicitClaimsReasoning = implicitResult.reasoning;
    }
  });

  // Process extracted implicit claims as separate verifiable sentences
  const allImplicitClaims: string[] = [];
  processed.forEach(entry => {
    if (entry.implicitClaims && entry.implicitClaims.length > 0) {
      allImplicitClaims.push(...entry.implicitClaims);
    }
  });

  // Process implicit claims through the full pipeline if any exist
  let processedImplicitClaims: ProcessedSentence[] = [];
  if (allImplicitClaims.length > 0) {
    console.log(`Processing ${allImplicitClaims.length} extracted implicit claims`);
    const implicitSentenceItems: CategorizationInput[] = allImplicitClaims.map((claim, idx) => ({
      id: `implicit-${idx}`,
      sentence: claim,
    }));

    const implicitCategorized = await categorizeSentences(implicitSentenceItems);
    const implicitCategorizedMap = new Map(implicitCategorized.map(item => [item.id, item]));

    const implicitProcessed: InternalProcessedSentence[] = implicitSentenceItems.map(item => {
      const categorization = implicitCategorizedMap.get(item.id);
      return {
        id: item.id,
        originalSentence: item.sentence,
        category: categorization?.category ?? 'Not Verifiable',
        categoryReasoning: categorization?.reasoning ?? DEFAULT_CATEGORY_REASONING,
        isAmbiguous: false,
        finalClaim: null,
      };
    });

    // Process implicit claims through disambiguation
    const implicitDisambiguationInputs: DisambiguationInput[] = implicitProcessed
      .filter(p => p.category === 'Verifiable')
      .map(p => ({ id: p.id, sentence: p.originalSentence }));

    if (implicitDisambiguationInputs.length > 0) {
      const implicitDisambiguated = await disambiguateSentences(implicitDisambiguationInputs);
      const implicitDisambiguationMap = new Map(implicitDisambiguated.map(result => [result.id, result]));

      implicitProcessed.forEach(entry => {
        const disambiguation = implicitDisambiguationMap.get(entry.id);
        if (disambiguation) {
          entry.isAmbiguous = disambiguation.isAmbiguous;
          entry.ambiguityType = disambiguation.ambiguityType;
          entry.ambiguityReasoning = disambiguation.ambiguityReasoning;
          entry.canBeDisambiguated = disambiguation.canBeDisambiguated;
          entry.disambiguationReasoning = disambiguation.disambiguationReasoning || disambiguation.reasoning;
          entry.disambiguatedSentence = disambiguation.disambiguatedSentence;
          entry.clarityReasoning = disambiguation.clarityReasoning;

          // Set final claim
          if (!disambiguation.isAmbiguous) {
            entry.finalClaim = entry.originalSentence;
          } else if (disambiguation.disambiguatedSentence && disambiguation.disambiguatedSentence.trim().length > 0) {
            entry.finalClaim = disambiguation.disambiguatedSentence.trim();
          } else {
            entry.finalClaim = null;
          }
        } else {
          entry.finalClaim = entry.originalSentence;
        }
      });
    } else {
      implicitProcessed.forEach(entry => {
        entry.finalClaim = entry.originalSentence;
      });
    }

    processedImplicitClaims = implicitProcessed.map(({ id, candidateSentence, disambiguationSource, ...rest }) => rest);
  }

  const partialInputs: RewriteInput[] = processed
    .filter(p => p.category === 'Partially Verifiable')
    .map(p => ({
      id: p.id,
      sentence: p.originalSentence,
      reasoning: p.categoryReasoning,
    }));

  if (partialInputs.length > 0) {
    const rewrites = await rewritePartiallyVerifiable(partialInputs);
    const rewriteMap = new Map(rewrites.map(item => [item.id, item]));
    processed.forEach(entry => {
      const rewrite = rewriteMap.get(entry.id);
      if (rewrite) {
        entry.rewrittenSentence = rewrite.rewrittenSentence?.trim() || '';
        entry.rewriteReasoning = rewrite.reasoning;
      }
    });
  }

  const disambiguationInputs: DisambiguationInput[] = [];

  processed.forEach(entry => {
    if (entry.category === 'Verifiable') {
      entry.disambiguationSource = 'original';
      entry.candidateSentence = entry.originalSentence;
      disambiguationInputs.push({ id: entry.id, sentence: entry.originalSentence });
    } else if (
      entry.category === 'Partially Verifiable' &&
      entry.rewrittenSentence &&
      entry.rewrittenSentence.trim().length > 0
    ) {
      entry.disambiguationSource = 'rewritten';
      entry.candidateSentence = entry.rewrittenSentence.trim();
      disambiguationInputs.push({ id: entry.id, sentence: entry.rewrittenSentence });
    } else {
      entry.candidateSentence = undefined;
    }
  });

  let disambiguationMap = new Map<string, DisambiguationResult>();
  if (disambiguationInputs.length > 0) {
    const disambiguated = await disambiguateSentences(disambiguationInputs);
    disambiguationMap = new Map(disambiguated.map(result => [result.id, result]));
  }

  processed.forEach(entry => {
    const disambiguation = disambiguationMap.get(entry.id);
    if (disambiguation) {
      entry.isAmbiguous = disambiguation.isAmbiguous;
      entry.ambiguityType = disambiguation.ambiguityType;
      entry.ambiguityReasoning = disambiguation.ambiguityReasoning;
      entry.canBeDisambiguated = disambiguation.canBeDisambiguated;
      entry.disambiguationReasoning = disambiguation.disambiguationReasoning || disambiguation.reasoning;
      entry.disambiguatedSentence = disambiguation.disambiguatedSentence;
      entry.clarityReasoning = disambiguation.clarityReasoning;
    } else {
      entry.isAmbiguous = false;
      entry.ambiguityType = undefined;
      entry.ambiguityReasoning = undefined;
      entry.canBeDisambiguated = undefined;
      entry.disambiguationReasoning = undefined;
      entry.disambiguatedSentence = undefined;
      entry.clarityReasoning = undefined;
    }

    const baseSentence =
      entry.category === 'Verifiable'
        ? entry.originalSentence
        : entry.rewrittenSentence?.trim() || '';

    if (!baseSentence) {
      entry.finalClaim = null;
      return;
    }

    if (!disambiguation) {
      entry.finalClaim = baseSentence;
      entry.isAmbiguous = false;
      return;
    }

    if (!disambiguation.isAmbiguous) {
      entry.finalClaim = baseSentence;
      return;
    }

    if (disambiguation.disambiguatedSentence && disambiguation.disambiguatedSentence.trim().length > 0) {
      entry.finalClaim = disambiguation.disambiguatedSentence.trim();
    } else {
      entry.finalClaim = null;
    }
  });

  return {
    processedSentences: processed.map(({ id, candidateSentence, disambiguationSource, ...rest }) => rest),
    processedImplicitClaims,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'URL parameter is required. Please use POST method with content in the body, or use /api/extract first.' },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      error: 'GET method is no longer supported. Please extract content using /api/extract first, then POST to /api/reclaimify with the content.',
      message: 'Use POST method with { content, url, title?, excerpt? } in the request body',
    },
    { status: 405 }
  );
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
    const { url, content, title, excerpt } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content is required in the request body. Please extract content using /api/extract first.' },
        { status: 400 }
      );
    }

    if (content.trim().length === 0) {
      return NextResponse.json(
        { error: 'Content is empty or invalid' },
        { status: 400 }
      );
    }

    const detectedHindi = isHindiText(content);
    console.log(
      `Language detection: ${detectedHindi ? 'Hindi' : 'English'} (content length: ${content.length}, first 100 chars: ${content.substring(
        0,
        100
      )})`
    );

    const sentences = splitIntoSentences(content);
    console.log(`Split into ${sentences.length} sentences`);

    const { processedSentences, processedImplicitClaims } = await processSentencesMultiStep(sentences);
    
    // Collect verifiable claims from both original sentences and extracted implicit claims
    // Collect verifiable claims from both original sentences and extracted implicit claims
const VerifiableClaims = processedSentences.flatMap(sentence => {
  // If we have implicit claims, use those
  if (sentence.implicitClaims && sentence.implicitClaims.length > 0) {
    return sentence.implicitClaims
      .filter(claim => typeof claim === 'string' && claim.trim().length > 0)
      .map(claim => claim.trim());
  }
  // Otherwise use finalClaim if available
  if (sentence.finalClaim && sentence.finalClaim.trim().length > 0) {
    return [sentence.finalClaim.trim()];
  }
  return [];
});

// Add any additional verifiable claims from processedImplicitClaims
const additionalImplicitClaims = processedImplicitClaims
  .filter(sentence => sentence.finalClaim && sentence.finalClaim.trim().length > 0)
  .map(sentence => sentence.finalClaim!.trim());

const allVerifiableClaims = [...VerifiableClaims, ...additionalImplicitClaims];
    return NextResponse.json({
      url: url || 'unknown',
      title,
      excerpt,
      content,
      sentences,
      processedSentences,
      processedImplicitClaims,
      verifiableClaims: allVerifiableClaims,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in POST /api/reclaimify:', error);
    return NextResponse.json(
      { error: 'Failed to process the request', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

