/**
 * Unified Reclaimify Prompt
 * This prompt processes sentences through categorization, rewriting, and disambiguation in ONE LLM call
 * 
 * Edit this file to fine-tune the model's behavior
 */

export const RECLAIMIFY_SYSTEM_PROMPT = `You are an expert fact-checking assistant with deep knowledge of logic, language, and verification methods. Your task is to process sentences through multiple analytical steps with EXTREME ACCURACY.`;

export const RECLAIMIFY_USER_PROMPT = (sentences: string[]) => `Process each sentence through ALL these steps in ONE comprehensive analysis:

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULES (FOLLOW STRICTLY):
═══════════════════════════════════════════════════════════════════════════════

1. 🚫 NEVER HALLUCINATE - If you need context that isn't in the sentence, mark it as ambiguous
2. ✓ PRESERVE ACCURACY - All factual details (names, dates, numbers) must be retained
3. ⚠️ BE CONSERVATIVE - When in doubt, mark as "Not Verifiable" rather than risk false claims
4. 🎯 NO GUESSING - Only disambiguate if you have clear contextual information
5. 📊 FACTUAL ONLY - Remove opinions/subjectivity but keep ALL facts

═══════════════════════════════════════════════════════════════════════════════
STEP 1: CATEGORIZATION
═══════════════════════════════════════════════════════════════════════════════

Classify each sentence as:

▸ "Verifiable" - Contains specific factual claims that can be objectively verified
  Examples:
  - "Apple was founded in 1976"
  - "The Eiffel Tower is 330 meters tall"
  - "Biden won the 2020 US presidential election"
  
▸ "Partially Verifiable" - Has verifiable elements BUT includes subjective/vague language
  Examples:
  - "The amazing company was founded in 2010" (subjective: "amazing")
  - "He said the product launched yesterday" (vague: "he", unclear date)
  - "The innovative startup raised $50M" (subjective: "innovative", missing company name)
  
▸ "Not Verifiable" - Pure opinion, speculation, or too vague to verify
  Examples:
  - "This is the best movie ever"
  - "The weather might change tomorrow"
  - "Some people believe in aliens"

═══════════════════════════════════════════════════════════════════════════════
STEP 2: REWRITING (Only for Partially Verifiable)
═══════════════════════════════════════════════════════════════════════════════

Extract and rewrite to keep ONLY verifiable parts:
- ✓ Remove: Subjective adjectives (amazing, innovative, terrible)
- ✓ Remove: Opinions, speculation, hedging words
- ✓ Keep: ALL factual details (names, dates, numbers, events)
- ⚠️ If removing subjectivity loses critical context, leave rewrittenSentence EMPTY

Examples:
- "The innovative startup raised $50M in 2023"
  → "The startup raised $50M in 2023" ✓
  
- "He said the product launched yesterday"
  → "The product launched yesterday" ⚠️ (loses who "he" is - needs disambiguation)

- "I think the movie was released in 2020"
  → "The movie was released in 2020" ✓

═══════════════════════════════════════════════════════════════════════════════
STEP 3: AMBIGUITY DETECTION & DISAMBIGUATION
═══════════════════════════════════════════════════════════════════════════════

Check if the sentence/claim is ambiguous:

▸ Referential Ambiguity:
  - Unclear pronouns: "he", "she", "it", "they"
  - Vague references: "the company", "the product", "the event"
  - Relative time: "yesterday", "last year", "recently"
  
▸ Structural Ambiguity:
  - Grammatically unclear sentence structure
  - Multiple possible interpretations
  - Missing context that changes meaning

🔴 CRITICAL: Only disambiguate if:
1. You have clear context from surrounding sentences
2. The disambiguation doesn't introduce new facts
3. The result is more verifiable than the original

If context is insufficient, set:
- isAmbiguous: true
- disambiguatedSentence: null (don't guess!)

Examples:
✓ GOOD: "The company was founded in 2010" 
  → If context says "Apple", then "Apple was founded in 2010"
  
✗ BAD: "The company was founded in 2010"
  → If no context, leave as ambiguous (don't invent "Google")

═══════════════════════════════════════════════════════════════════════════════
STEP 4: FINAL CLAIM EXTRACTION
═══════════════════════════════════════════════════════════════════════════════

Determine the ultimate claim to fact-check:

▸ For Verifiable (not ambiguous):
  finalClaim = originalSentence

▸ For Verifiable (successfully disambiguated):
  finalClaim = disambiguatedSentence

▸ For Partially Verifiable (rewritten + not ambiguous):
  finalClaim = rewrittenSentence

▸ For Partially Verifiable (rewritten + disambiguated):
  finalClaim = disambiguatedSentence

▸ For Not Verifiable OR failed rewrites OR unresolvable ambiguity:
  finalClaim = null

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON)
═══════════════════════════════════════════════════════════════════════════════

Return a JSON array with ONE object per sentence:

{
  "originalSentence": string,
  "category": "Verifiable" | "Partially Verifiable" | "Not Verifiable",
  "categoryReasoning": string,
  "rewrittenSentence": string | null,
  "rewriteReasoning": string | null,
  "isAmbiguous": boolean,
  "ambiguityType": "referential" | "structural" | null,
  "ambiguityReasoning": string | null,
  "disambiguatedSentence": string | null,
  "finalClaim": string | null
}

═══════════════════════════════════════════════════════════════════════════════
COMPLETE EXAMPLES
═══════════════════════════════════════════════════════════════════════════════

Example 1: Pure Verifiable Claim
Input: "The Eiffel Tower was completed in 1889"
Output: {
  "originalSentence": "The Eiffel Tower was completed in 1889",
  "category": "Verifiable",
  "categoryReasoning": "Specific historical fact with concrete details",
  "rewrittenSentence": null,
  "rewriteReasoning": null,
  "isAmbiguous": false,
  "ambiguityType": null,
  "ambiguityReasoning": null,
  "disambiguatedSentence": null,
  "finalClaim": "The Eiffel Tower was completed in 1889"
}

Example 2: Partially Verifiable with Disambiguation
Input: "The innovative company launched its groundbreaking product yesterday"
Output: {
  "originalSentence": "The innovative company launched its groundbreaking product yesterday",
  "category": "Partially Verifiable",
  "categoryReasoning": "Contains verifiable product launch, but 'innovative' and 'groundbreaking' are subjective opinions",
  "rewrittenSentence": "The company launched its product yesterday",
  "rewriteReasoning": "Removed subjective adjectives 'innovative' and 'groundbreaking'",
  "isAmbiguous": true,
  "ambiguityType": "referential",
  "ambiguityReasoning": "Unclear which company, which product, and 'yesterday' needs specific date",
  "disambiguatedSentence": null,
  "finalClaim": null
}

Example 3: Not Verifiable Opinion
Input: "I believe this is the best approach to solving the problem"
Output: {
  "originalSentence": "I believe this is the best approach to solving the problem",
  "category": "Not Verifiable",
  "categoryReasoning": "Pure personal opinion with subjective judgment ('best')",
  "rewrittenSentence": null,
  "rewriteReasoning": null,
  "isAmbiguous": false,
  "ambiguityType": null,
  "ambiguityReasoning": null,
  "disambiguatedSentence": null,
  "finalClaim": null
}

Example 4: Successfully Disambiguated Claim
Input: "She announced the merger would complete in Q4 2024"
Context: Previous sentences mention "CEO Sarah Johnson"
Output: {
  "originalSentence": "She announced the merger would complete in Q4 2024",
  "category": "Verifiable",
  "categoryReasoning": "Specific announcement about merger timing",
  "rewrittenSentence": null,
  "rewriteReasoning": null,
  "isAmbiguous": true,
  "ambiguityType": "referential",
  "ambiguityReasoning": "Pronoun 'she' needs to be clarified",
  "disambiguatedSentence": "CEO Sarah Johnson announced the merger would complete in Q4 2024",
  "finalClaim": "CEO Sarah Johnson announced the merger would complete in Q4 2024"
}

═══════════════════════════════════════════════════════════════════════════════
NOW PROCESS THESE SENTENCES
═══════════════════════════════════════════════════════════════════════════════

${JSON.stringify(sentences, null, 2)}

Remember: Quality over quantity. If unsure, set finalClaim to null.`;

// Configuration
export const RECLAIMIFY_CONFIG = {
  model: 'gemini-2.0-flash-exp',
  temperature: 0.1, // Low temperature for factual consistency
  maxOutputTokens: 8192,
  responseMimeType: 'application/json',
  
  // Validation thresholds
  minWordOverlap: 0.3, // Minimum word overlap between original and final claim (30%)
  minClaimLength: 20,  // Minimum claim length in characters
  maxClaimLength: 500, // Maximum claim length in characters
};
