import { NextResponse } from 'next/server';
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

// --- Helper: Detect if text is primarily in Hindi (Devanagari script) ---
function isHindiText(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  
  // Devanagari script Unicode range: U+0900 to U+097F
  // Check if text contains Devanagari characters
  const devanagariPattern = /[\u0900-\u097F]/g;
  const devanagariMatches = text.match(devanagariPattern);
  const devanagariCount = devanagariMatches ? devanagariMatches.length : 0;
  
  // If no Devanagari characters found, it's not Hindi
  if (devanagariCount === 0) return false;
  
  // Count all non-whitespace, non-punctuation characters (both Devanagari and Latin)
  const allLetters = text.match(/[\u0900-\u097Fa-zA-Z]/g);
  const totalLetterCount = allLetters ? allLetters.length : 0;
  
  // If we have significant Devanagari characters, check the ratio
  if (totalLetterCount === 0) {
    // Edge case: only punctuation/whitespace, but if we have Devanagari, it's likely Hindi
    return devanagariCount >= 5;
  }
  
  const devanagariRatio = devanagariCount / totalLetterCount;
  
  // If more than 15% of letters are Devanagari, OR if we have 20+ Devanagari chars, consider it Hindi
  // Lower threshold to catch more Hindi text
  return devanagariRatio > 0.15 || devanagariCount >= 20;
}

// --- Helper: Split Hindi text into sentences ---
function splitHindiIntoSentences(text: string): string[] {
  // Hindi uses '।' (Danda/U+0964) as sentence end marker, along with ? and !
  // Also handle English punctuation (., !, ?) that might be mixed in
  // Split on: । (Danda), . (period), ? (question mark), ! (exclamation mark)
  // Pattern: Look for sentence end markers followed by whitespace or end of string
  return text
    .split(/(?<=[।.!?])\s+|(?<=[।.!?])$/gm) // Split at Hindi Danda (।), English period (.), !, ?
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 500) // Filter out very long or empty sentences
    .filter(s => {
      // Remove sentences that are only punctuation/whitespace
      const withoutPunctuation = s.replace(/[।.!?\s\u0900-\u097F]/g, '');
      // Keep if it has non-Devanagari content OR if it has Devanagari characters
      const hasDevanagari = /[\u0900-\u097F]/.test(s);
      const hasContent = s.replace(/[।.!?\s]/g, '').length > 0;
      return hasContent && (hasDevanagari || withoutPunctuation.length > 0);
    });
}

// --- Helper: Split English text into sentences ---
function splitEnglishIntoSentences(text: string): string[] {
  // Simple sentence splitting that handles common cases for English
  return text
    .split(/(?<=\S[\.!?]\s+)(?=[A-Z])/g) // Split at sentence boundaries (., !, ?)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 500) // Filter out very long or empty sentences
    .filter(s => !/^[\s\d\W]+$/.test(s)); // Filter out sentences with only numbers/symbols
}

// --- Helper: Split text into sentences (auto-detects language) ---
function splitIntoSentences(text: string): string[] {
  // Detect language and use appropriate splitting method
  if (isHindiText(text)) {
    console.log('Detected Hindi text, using Hindi sentence splitting');
    return splitHindiIntoSentences(text);
  } else {
    console.log('Detected English text, using English sentence splitting');
    return splitEnglishIntoSentences(text);
  }
}

// --- SINGLE LLM CALL: Process all sentences at once ---
async function processAllSentences(sentences: string[]): Promise<ProcessedSentence[]> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    // Detect if sentences contain Hindi text
    const hasHindi = sentences.some(s => /[\u0900-\u097F]/.test(s));
    const languageNote = hasHindi 
      ? '\n\n⚠️ IMPORTANT: The input sentences contain Hindi text (Devanagari script). Apply the same categorization rules to Hindi sentences as you would to English. Process Hindi sentences exactly the same way - look for verifiable facts, specific dates, proper nouns, quantifiable data, etc. The principles of verifiability are language-independent.\n'
      : '';
    
    const prompt = `You are an expert fact-checking assistant with deep knowledge of English and Hindi grammar, semantics, and logical reasoning. Your task is to process sentences through a multi-step pipeline to extract verifiable factual claims. You can process text in English, Hindi (Devanagari script), or mixed languages.${languageNote}

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
✓ Proper nouns with specific facts: "Apple released the iPhone in 2007" OR "एप्पल ने 2007 में iPhone जारी किया"
✓ Measurable quantities: "The building is 500 feet tall" OR "इमारत 500 फीट ऊंची है"
✓ Specific dates/times: "The meeting occurred on March 15, 2023" OR "बैठक 15 मार्च 2023 को हुई"
✓ Documented events: "The treaty was signed in Paris" OR "संधि पेरिस में हस्ताक्षरित हुई"
✓ Quantifiable data: "The company's revenue was $50 million" OR "कंपनी का राजस्व $50 मिलियन था"
✓ Concrete actions: "The CEO resigned on Tuesday" OR "सीईओ ने मंगलवार को इस्तीफा दिया"
✓ Scientific facts: "Water boils at 100°C at sea level" OR "समुद्र तल पर पानी 100°C पर उबलता है"
✓ Historical events: "World War II ended in 1945" OR "द्वितीय विश्व युद्ध 1945 में समाप्त हुआ"
✓ Legal facts: "The law was passed by Congress" OR "कानून संसद द्वारा पारित किया गया"
✓ Geographic facts: "Mount Everest is in the Himalayas" OR "माउंट एवरेस्ट हिमालय में है"

**PARTIALLY VERIFIABLE** - Mix of verifiable facts and subjective elements:
⚠ Verifiable core + subjective modifiers: "The amazing discovery was made in 2020" OR "अद्भुत खोज 2020 में की गई"
⚠ Facts with opinions: "The poorly designed bridge collapsed in 2019" OR "खराब डिज़ाइन वाला पुल 2019 में ढह गया"
⚠ Verifiable claims with hedging: "Some say the company was founded in 1995" OR "कुछ लोग कहते हैं कि कंपनी 1995 में स्थापित हुई"
⚠ Attributions with facts: "According to sources, the event happened yesterday" OR "सूत्रों के अनुसार, घटना कल हुई"
⚠ Comparative judgments with facts: "The faster processor was released in Q2" OR "तेज़ प्रोसेसर Q2 में जारी किया गया"
⚠ Emotional descriptions with facts: "The shocking announcement came on Monday" OR "चौंकाने वाली घोषणा सोमवार को आई"

**NOT VERIFIABLE** - Subjective, opinion-based, or too vague:
✗ Pure opinions: "This is the best product ever" OR "यह अब तक का सबसे अच्छा उत्पाद है"
✗ Subjective experiences: "I feel that this is important" OR "मुझे लगता है कि यह महत्वपूर्ण है"
✗ Value judgments: "The movie was entertaining" OR "फिल्म मनोरंजक थी"
✗ Predictions: "The stock will rise tomorrow" OR "शेयर कल बढ़ेगा"
✗ Hypotheticals: "If he had won, things would be different" OR "अगर वह जीत जाता, तो चीजें अलग होतीं"
✗ Vague generalizations: "Many people believe this" OR "कई लोग यह मानते हैं"
✗ Aesthetic judgments: "The painting is beautiful" OR "पेंटिंग सुंदर है"
✗ Moral claims: "This action was wrong" OR "यह कार्रवाई गलत थी"
✗ Indefinite statements: "Something happened somewhere" OR "कहीं कुछ हुआ"
✗ Questions: "What is the capital of France?" OR "फ्रांस की राजधानी क्या है?"
✗ Commands: "Please verify this information" OR "कृपया इस जानकारी को सत्यापित करें"
✗ Future intentions: "We plan to expand next year" OR "हम अगले साल विस्तार की योजना बना रहे हैं"

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

EXAMPLE 4B - Verifiable Hindi Sentence:
Input: "भारत ने 15 अगस्त 1947 को आज़ादी प्राप्त की"
Output: {
  "originalSentence": "भारत ने 15 अगस्त 1947 को आज़ादी प्राप्त की",
  "category": "Verifiable",
  "categoryReasoning": "Specific country, date, and event - all objectively verifiable",
  "isAmbiguous": false,
  "finalClaim": "भारत ने 15 अगस्त 1947 को आज़ादी प्राप्त की"
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
      { error: 'URL parameter is required. Please use POST method with content in the body, or use /api/extract first.' },
      { status: 400 }
    );
  }

  // GET method is deprecated - redirect to using POST with extracted content
  return NextResponse.json(
    { 
      error: 'GET method is no longer supported. Please extract content using /api/extract first, then POST to /api/reclaimify with the content.',
      message: 'Use POST method with { content, url, title?, excerpt? } in the request body'
    },
    { status: 405 }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, content, title, excerpt } = body;

    // Content must be provided - extraction is now handled by /api/extract
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

    // Split text into sentences here (moved from frontend)
    // Log language detection for debugging
    const isHindi = isHindiText(content);
    console.log(`Language detection: ${isHindi ? 'Hindi' : 'English'} (content length: ${content.length}, first 100 chars: ${content.substring(0, 100)})`);
    
    const sentences = splitIntoSentences(content);
    console.log(`Split into ${sentences.length} sentences`);
    
    // Process all sentences in ONE LLM call
    const processed = await processAllSentences(sentences);
    
    // Extract only the final verifiable claims
    const verifiableClaims = processed
      .filter(p => p.finalClaim !== null && p.finalClaim !== undefined && p.finalClaim.trim().length > 0)
      .map(p => p.finalClaim as string);

    return NextResponse.json({
      url: url || 'unknown',
      title: title,
      excerpt: excerpt,
      content: content,
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