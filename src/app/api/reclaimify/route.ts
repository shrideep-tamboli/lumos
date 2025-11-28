import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { extract } from '@extractus/article-extractor';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Types for the unified LLM response
interface ProcessedSentence {
  originalSentence: string;
  category: 'Verifiable' | 'Partially Verifiable' | 'Not Verifiable';
  categoryReasoning: string;
  rewrittenSentence?: string; // Only for Partially Verifiable
  rewriteReasoning?: string;
  isAmbiguous: boolean;
  ambiguityType?: 'referential' | 'structural';
  ambiguityReasoning?: string;
  disambiguatedSentence?: string; // Final verifiable claim
  finalClaim?: string; // The ultimate claim to fact-check
}

// --- Helper: Clean extracted text ---
function cleanText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ') // Remove HTML tags
    .replace(/\s+/g, ' ')     // Collapse whitespace
    .trim();
}

// --- Helper: Extract article text ---
async function extractArticleText(url: string): Promise<{
  content: string;
  title?: string;
  excerpt?: string;
  source: 'article-extractor' | 'fallback';
}> {
  try {
    // First try with article-extractor
    const article = await extract(url);
    if (article?.content) {
      return {
        content: cleanText(article.content),
        title: article.title,
        excerpt: article.description,
        source: 'article-extractor',
      };
    }
  } catch (error) {
    console.error('Error with article-extractor:', error);
  }

  // Fallback to cheerio for basic extraction
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    
    // Try to get main content
    let content = '';
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.post-content',
      '.article-content',
      '.entry-content',
      'body',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        content = element.text();
        if (content.length > 100) break; // Found substantial content
      }
    }

    return {
      content: cleanText(content || response.data),
      title: $('title').first().text().trim(),
      excerpt: $('meta[property="og:description"]').attr('content') || 
               $('meta[name="description"]').attr('content') ||
               $('p').first().text().substring(0, 200) + '...',
      source: 'fallback',
    };
  } catch (error) {
    console.error('Error with fallback extraction:', error);
    throw new Error('Failed to extract content from the provided URL');
  }
}

// --- Helper: Split text into sentences ---
function splitIntoSentences(text: string): string[] {
  // Simple sentence splitting that handles common cases
  return text
    .split(/(?<=\S[\.!?]\s+)(?=[A-Z])/g) // Split at sentence boundaries (., !, ?)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 500) // Filter out very long or empty sentences
    .filter(s => !/^[\s\d\W]+$/.test(s)); // Filter out sentences with only numbers/symbols
}

// --- SINGLE LLM CALL: Process all sentences at once ---
async function processAllSentences(sentences: string[]): Promise<ProcessedSentence[]> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `You are an expert fact-checking assistant with deep knowledge of English grammar, semantics, and logical reasoning. Your task is to process sentences through a multi-step pipeline to extract verifiable factual claims.

═══════════════════════════════════════════════════════════════
CORE PRINCIPLES
═══════════════════════════════════════════════════════════════

1. OBJECTIVITY: A verifiable claim must be capable of being proven true or false through evidence
2. SPECIFICITY: Vague or ambiguous references prevent verification
3. TEMPORAL CLARITY: Time references must be concrete ("yesterday" needs a date)
4. ENTITY RESOLUTION: Pronouns and references must identify specific entities
5. FACT vs OPINION: Distinguish objective claims from subjective judgments

═══════════════════════════════════════════════════════════════
STEP 1: CATEGORIZATION RULES
═══════════════════════════════════════════════════════════════

**VERIFIABLE** - Contains specific, objective, falsifiable claims:
✓ Proper nouns with specific facts: "Apple released the iPhone in 2007"
✓ Measurable quantities: "The building is 500 feet tall"
✓ Specific dates/times: "The meeting occurred on March 15, 2023"
✓ Documented events: "The treaty was signed in Paris"
✓ Quantifiable data: "The company's revenue was $50 million"
✓ Concrete actions: "The CEO resigned on Tuesday"
✓ Scientific facts: "Water boils at 100°C at sea level"
✓ Historical events: "World War II ended in 1945"
✓ Legal facts: "The law was passed by Congress"
✓ Geographic facts: "Mount Everest is in the Himalayas"

**PARTIALLY VERIFIABLE** - Mix of verifiable facts and subjective elements:
⚠ Verifiable core + subjective modifiers: "The amazing discovery was made in 2020"
⚠ Facts with opinions: "The poorly designed bridge collapsed in 2019"
⚠ Verifiable claims with hedging: "Some say the company was founded in 1995"
⚠ Attributions with facts: "According to sources, the event happened yesterday"
⚠ Comparative judgments with facts: "The faster processor was released in Q2"
⚠ Emotional descriptions with facts: "The shocking announcement came on Monday"

**NOT VERIFIABLE** - Subjective, opinion-based, or too vague:
✗ Pure opinions: "This is the best product ever"
✗ Subjective experiences: "I feel that this is important"
✗ Value judgments: "The movie was entertaining"
✗ Predictions: "The stock will rise tomorrow"
✗ Hypotheticals: "If he had won, things would be different"
✗ Vague generalizations: "Many people believe this"
✗ Aesthetic judgments: "The painting is beautiful"
✗ Moral claims: "This action was wrong"
✗ Indefinite statements: "Something happened somewhere"
✗ Questions: "What is the capital of France?"
✗ Commands: "Please verify this information"
✗ Future intentions: "We plan to expand next year"

═══════════════════════════════════════════════════════════════
STEP 2: REWRITING GUIDELINES (Partially Verifiable Only)
═══════════════════════════════════════════════════════════════

**REMOVE:**
• Subjective adjectives: amazing, terrible, innovative, groundbreaking, shocking
• Adverbs of manner: allegedly, supposedly, reportedly, apparently
• Opinion markers: "I think", "Some say", "It seems", "Arguably"
• Emotional language: unfortunately, thankfully, surprisingly
• Intensifiers: very, extremely, incredibly, absolutely
• Hedging phrases: "kind of", "sort of", "somewhat"
• Vague attributions: "sources say", "reports indicate"

**KEEP:**
• Specific entities (proper nouns)
• Concrete numbers, dates, times
• Measurable facts
• Actions and events
• Locations
• Quantities

**REWRITING EXAMPLES:**
Original: "The incredibly successful company was founded in 2010"
Rewritten: "The company was founded in 2010"

Original: "According to insiders, the revolutionary product launched last month"
Rewritten: "The product launched last month"

Original: "Many experts believe the temperature reached record highs"
Rewritten: "The temperature reached record highs"

**FAILURE CASES** (leave rewrittenSentence empty):
• If removing subjective elements leaves no concrete claim
• If the verifiable part becomes meaningless without context
• Original: "This seems like an important development" → No rewrite (nothing verifiable remains)

═══════════════════════════════════════════════════════════════
STEP 3: AMBIGUITY DETECTION
═══════════════════════════════════════════════════════════════

**REFERENTIAL AMBIGUITY** - Unclear entity references:
• Pronouns without clear antecedents: "He announced it yesterday"
• Demonstratives: "This happened in 2020", "That company expanded"
• Vague references: "The company", "The product", "The event"
• Temporal ambiguity: "yesterday", "last month", "recently", "soon"
• Implicit references: "The CEO resigned" (which CEO? which company?)

**STRUCTURAL AMBIGUITY** - Grammar/syntax issues:
• Modifier attachment: "The man saw the woman with the telescope"
• Coordination ambiguity: "Old men and women" (old applies to both or just men?)
• Scope ambiguity: "All students didn't pass" (none passed vs some didn't)
• Prepositional phrase attachment: "I saw the car in the driveway" (where was I? where was car?)
• Compound noun ambiguity: "Visiting relatives can be boring"

**NOT AMBIGUOUS:**
• Clear proper nouns: "Apple Inc. was founded in 1976"
• Specific dates: "The earthquake occurred on January 12, 2010"
• Complete context: "Microsoft's CEO Satya Nadella announced Azure growth"
• Self-contained statements with all necessary information

═══════════════════════════════════════════════════════════════
STEP 4: DISAMBIGUATION STRATEGIES
═══════════════════════════════════════════════════════════════

**For Referential Ambiguity:**
1. Replace pronouns with specific nouns
2. Convert relative time to absolute dates
3. Add missing context from surrounding information
4. Specify which entity is referenced

**For Structural Ambiguity:**
1. Reorder sentence elements for clarity
2. Add clarifying words
3. Split compound statements
4. Use punctuation to clarify meaning

**IMPORTANT:** 
- Only disambiguate if you have sufficient context to do so accurately
- If context is missing, leave disambiguatedSentence empty
- Don't invent information - use only what's available or strongly implied

═══════════════════════════════════════════════════════════════
STEP 5: FINAL CLAIM SELECTION
═══════════════════════════════════════════════════════════════

Priority order:
1. If Verifiable + Not Ambiguous → finalClaim = originalSentence
2. If Verifiable + Disambiguated → finalClaim = disambiguatedSentence
3. If Partially Verifiable + Rewritten + Not Ambiguous → finalClaim = rewrittenSentence
4. If Partially Verifiable + Rewritten + Disambiguated → finalClaim = disambiguatedSentence
5. If Not Verifiable → finalClaim = null
6. If Partially Verifiable but no verifiable content remains → finalClaim = null

═══════════════════════════════════════════════════════════════
COMPREHENSIVE EXAMPLES
═══════════════════════════════════════════════════════════════

EXAMPLE 1 - Verifiable with Referential Ambiguity:
Input: "The company was founded in 2010"
Output: {
  "originalSentence": "The company was founded in 2010",
  "category": "Verifiable",
  "categoryReasoning": "Contains specific, objective claim about founding year",
  "isAmbiguous": true,
  "ambiguityType": "referential",
  "ambiguityReasoning": "'The company' is a vague reference - which specific company is not identified",
  "disambiguatedSentence": "Tesla Inc. was founded in 2010",
  "finalClaim": "Tesla Inc. was founded in 2010"
}

EXAMPLE 2 - Partially Verifiable with Multiple Issues:
Input: "The groundbreaking study reportedly showed significant increases last year"
Output: {
  "originalSentence": "The groundbreaking study reportedly showed significant increases last year",
  "category": "Partially Verifiable",
  "categoryReasoning": "Contains verifiable elements (study, increases, timeframe) but includes subjective 'groundbreaking' and vague 'reportedly', 'significant'",
  "rewrittenSentence": "The study showed increases last year",
  "rewriteReasoning": "Removed subjective 'groundbreaking', hedging 'reportedly', and vague 'significant'",
  "isAmbiguous": true,
  "ambiguityType": "referential",
  "ambiguityReasoning": "Which study is unclear, 'increases' of what is unspecified, 'last year' is relative",
  "disambiguatedSentence": "The Harvard Medical School diabetes study showed blood sugar increases in 2023",
  "finalClaim": "The Harvard Medical School diabetes study showed blood sugar increases in 2023"
}

EXAMPLE 3 - Pure Opinion:
Input: "This is the best smartphone on the market"
Output: {
  "originalSentence": "This is the best smartphone on the market",
  "category": "Not Verifiable",
  "categoryReasoning": "Purely subjective value judgment - 'best' cannot be objectively verified",
  "isAmbiguous": false,
  "finalClaim": null
}

EXAMPLE 4 - Verifiable, No Ambiguity:
Input: "Apple Inc. released the iPhone 15 on September 22, 2023"
Output: {
  "originalSentence": "Apple Inc. released the iPhone 15 on September 22, 2023",
  "category": "Verifiable",
  "categoryReasoning": "Specific company, product, and date - all objectively verifiable",
  "isAmbiguous": false,
  "finalClaim": "Apple Inc. released the iPhone 15 on September 22, 2023"
}

EXAMPLE 5 - Partially Verifiable, Nothing Remains:
Input: "Many experts feel this approach might be somewhat effective"
Output: {
  "originalSentence": "Many experts feel this approach might be somewhat effective",
  "category": "Partially Verifiable",
  "categoryReasoning": "Hedged with 'feel', 'might be', 'somewhat' - has vague factual structure but no concrete verifiable content",
  "rewrittenSentence": "",
  "rewriteReasoning": "After removing 'many experts feel', 'might be', 'somewhat', and 'this approach' (vague reference), no verifiable claim remains",
  "isAmbiguous": false,
  "finalClaim": null
}

EXAMPLE 6 - Temporal Ambiguity:
Input: "The CEO resigned yesterday"
Output: {
  "originalSentence": "The CEO resigned yesterday",
  "category": "Verifiable",
  "categoryReasoning": "Specific action (resignation) that can be verified",
  "isAmbiguous": true,
  "ambiguityType": "referential",
  "ambiguityReasoning": "Which CEO of which company is unclear, and 'yesterday' is a relative date",
  "disambiguatedSentence": "Twitter CEO Elon Musk resigned on November 15, 2025",
  "finalClaim": "Twitter CEO Elon Musk resigned on November 15, 2025"
}

EXAMPLE 7 - Structural Ambiguity:
Input: "The board approved the merger with three dissenting votes"
Output: {
  "originalSentence": "The board approved the merger with three dissenting votes",
  "category": "Verifiable",
  "categoryReasoning": "Specific action and quantifiable vote count",
  "isAmbiguous": true,
  "ambiguityType": "structural",
  "ambiguityReasoning": "Unclear if 'with three dissenting votes' means the merger had three dissenting votes or the board approval had three dissenting votes",
  "disambiguatedSentence": "The board approved the merger; three board members voted against it",
  "finalClaim": "The board approved the merger; three board members voted against it"
}

EXAMPLE 8 - Attribution with Fact:
Input: "According to the report, unemployment fell to 4.2% in October"
Output: {
  "originalSentence": "According to the report, unemployment fell to 4.2% in October",
  "category": "Partially Verifiable",
  "categoryReasoning": "Contains specific verifiable data (4.2%, October) but has vague attribution 'the report'",
  "rewrittenSentence": "Unemployment fell to 4.2% in October",
  "rewriteReasoning": "Removed vague attribution 'according to the report'",
  "isAmbiguous": true,
  "ambiguityType": "referential",
  "ambiguityReasoning": "Which country/region and which October (year) are not specified",
  "disambiguatedSentence": "US unemployment fell to 4.2% in October 2024",
  "finalClaim": "US unemployment fell to 4.2% in October 2024"
}

EXAMPLE 9 - Question (Not Verifiable):
Input: "What was the company's revenue in Q3?"
Output: {
  "originalSentence": "What was the company's revenue in Q3?",
  "category": "Not Verifiable",
  "categoryReasoning": "This is a question, not a statement with a truth value",
  "isAmbiguous": false,
  "finalClaim": null
}

EXAMPLE 10 - Future Prediction:
Input: "The stock price will reach $500 by next quarter"
Output: {
  "originalSentence": "The stock price will reach $500 by next quarter",
  "category": "Not Verifiable",
  "categoryReasoning": "Future prediction that cannot be currently verified - only historical or present facts are verifiable",
  "isAmbiguous": false,
  "finalClaim": null
}

EXAMPLE 11 - Hedged Statement:
Input: "It seems like the policy was implemented around 2015"
Output: {
  "originalSentence": "It seems like the policy was implemented around 2015",
  "category": "Partially Verifiable",
  "categoryReasoning": "Core claim about policy implementation is verifiable, but hedged with 'seems like' and vague 'around'",
  "rewrittenSentence": "The policy was implemented in 2015",
  "rewriteReasoning": "Removed hedging 'seems like' and made timeframe more specific",
  "isAmbiguous": true,
  "ambiguityType": "referential",
  "ambiguityReasoning": "Which specific policy is not identified",
  "disambiguatedSentence": "The Affordable Care Act was implemented in 2015",
  "finalClaim": "The Affordable Care Act was implemented in 2015"
}

EXAMPLE 12 - Mixed Fact and Opinion:
Input: "The disastrous product launch resulted in 30% sales decline"
Output: {
  "originalSentence": "The disastrous product launch resulted in 30% sales decline",
  "category": "Partially Verifiable",
  "categoryReasoning": "Sales decline of 30% is verifiable, but 'disastrous' is subjective judgment",
  "rewrittenSentence": "The product launch resulted in 30% sales decline",
  "rewriteReasoning": "Removed subjective 'disastrous'",
  "isAmbiguous": true,
  "ambiguityType": "referential",
  "ambiguityReasoning": "Which product and which company are not specified, timeframe unclear",
  "disambiguatedSentence": "The Meta Quest Pro launch in October 2022 resulted in 30% sales decline",
  "finalClaim": "The Meta Quest Pro launch in October 2022 resulted in 30% sales decline"
}

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════

Return a JSON array with one object per sentence containing:
{
  "originalSentence": string,
  "category": "Verifiable" | "Partially Verifiable" | "Not Verifiable",
  "categoryReasoning": string (detailed explanation of categorization),
  "rewrittenSentence": string (only if Partially Verifiable and verifiable content exists, empty string if nothing remains),
  "rewriteReasoning": string (only if rewrittenSentence is provided),
  "isAmbiguous": boolean,
  "ambiguityType": "referential" | "structural" (only if isAmbiguous is true),
  "ambiguityReasoning": string (only if isAmbiguous is true),
  "disambiguatedSentence": string (only if isAmbiguous and disambiguation is possible),
  "finalClaim": string | null (the ultimate claim for fact-checking, following priority rules)
}

Now process these sentences:
${JSON.stringify(sentences, null, 2)}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const response = await result.response;
    const text = response.text();
    
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed as ProcessedSentence[];
      }
      throw new Error('Invalid response format: expected array');
    } catch (error) {
      console.error('Error parsing LLM response:', error);
      console.error('Raw response:', text);
      // Return empty results rather than crashing
      return sentences.map(sentence => ({
        originalSentence: sentence,
        category: 'Not Verifiable' as const,
        categoryReasoning: 'Failed to process',
        isAmbiguous: false,
        finalClaim: undefined
      }));
    }
  } catch (error) {
    console.error('Error in processAllSentences:', error);
    return sentences.map(sentence => ({
      originalSentence: sentence,
      category: 'Not Verifiable' as const,
      categoryReasoning: 'Error during processing',
      isAmbiguous: false,
      finalClaim: undefined
    }));
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'URL parameter is required' },
      { status: 400 }
    );
  }

  try {
    const { content, title, excerpt } = await extractArticleText(url);
    const sentences = splitIntoSentences(content);
    
    // Process all sentences in ONE LLM call
    const processed = await processAllSentences(sentences);
    
    // Extract only the final verifiable claims
    const verifiableClaims = processed
      .filter(p => p.finalClaim !== null && p.finalClaim !== undefined && p.finalClaim.trim().length > 0)
      .map(p => p.finalClaim as string);

    return NextResponse.json({
      url,
      title,
      excerpt,
      content,
      sentences,
      processedSentences: processed,
      verifiableClaims,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error processing URL:', error);
    return NextResponse.json(
      { error: 'Failed to process the URL', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required in the request body' },
        { status: 400 }
      );
    }

    const { content, title, excerpt } = await extractArticleText(url);
    const sentences = splitIntoSentences(content);
    
    // Process all sentences in ONE LLM call
    const processed = await processAllSentences(sentences);
    
    // Extract only the final verifiable claims
    const verifiableClaims = processed
      .filter(p => p.finalClaim !== null && p.finalClaim !== undefined && p.finalClaim.trim().length > 0)
      .map(p => p.finalClaim as string);

    return NextResponse.json({
      url,
      title,
      excerpt,
      content,
      sentences,
      processedSentences: processed,
      verifiableClaims,
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