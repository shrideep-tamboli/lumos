export interface RelevantChunk {
  text: string;
  similarity: number;
  source?: {
    url: string;
    title?: string;
  };
}

export interface SearchResult {
  url: string;
  content: string;
  title?: string;
  excerpt?: string;
  error?: string;
  relevantChunks?: RelevantChunk[];
  factCheckSourceUrls?: string[];
  // Support both camelCase and PascalCase for API response fields
  verdict?: "Support" | "Partially Support" | "Unclear" | "Contradict" | "Refute";
  Verdict?: "Support" | "Partially Support" | "Unclear" | "Contradict" | "Refute";
  reason?: string;
  Reason?: string;
  reference?: string;
  Reference?: string | string[];
  trustScore?: number;
  Trust_Score?: number;
  trust_score?: number;
  aggregateTrustScore?: number;
}

export interface ClaimsResponse {
  claims: Array<{
    claim: string;
    search_date: string;
  }>;
  search_date: string;
  searchResults?: SearchResult[];
  factCheckResults?: Array<{
    claim: string;
    relevantChunks: RelevantChunk[];
  }>;
  aggregateTrustScore?: number;
  analysis?: unknown;
  factChecks?: FactCheckResult[];
}

export interface ClaimsListProps {
  claims: ClaimsResponse | null;
  searchResults?: SearchResult[];
}

// Reclaimify and Fact Check shared types
export interface DisambiguationResult {
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

export interface CategorizedSentence {
  sentence: string;
  category: 'Verifiable' | 'Partially Verifiable' | 'Not Verifiable';
  reasoning: string;
  implicitClaims?: string[];
  implicitClaimsReasoning?: string;
}

export interface RewrittenPartial {
  originalSentence: string;
  reasoning: string;
  rewrittenSentence: string;
}

export interface ReclaimifyApiResponse {
  url: string;
  title?: string;
  excerpt?: string;
  content: string;
  sentences: string[];
  timestamp: string;
  // Old shape (backward compatibility)
  categorizedSentences?: CategorizedSentence[];
  rewrittenPartials?: RewrittenPartial[];
  disambiguatedSentences?: DisambiguationResult[];
  // New shape
  processedSentences?: Array<{
    originalSentence: string;
    category: 'Verifiable' | 'Partially Verifiable' | 'Not Verifiable';
    categoryReasoning: string;
    rewrittenSentence?: string;
    rewriteReasoning?: string;
    isAmbiguous: boolean;
    ambiguityType?: 'referential' | 'structural';
    ambiguityReasoning?: string | null;
    disambiguatedSentence?: string | null;
    finalClaim?: string | null;
  }>;
  verifiableClaims?: string[];
}

export interface FactCheckResult {
  claim: string;
  verdict?: "Support" | "Partially Support" | "Unclear" | "Contradict" | "Refute";
  Verdict?: "Support" | "Partially Support" | "Unclear" | "Contradict" | "Refute";
  reason?: string;
  Reason?: string;
  reference?: string | string[];
  Reference?: string | string[];
  trustScore?: number;
  Trust_Score?: number;
  trust_score?: number;
  url?: string;
}
