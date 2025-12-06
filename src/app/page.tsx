'use client';

import { useState } from 'react';
import AnalysisSummary from '@/components/AnalysisSummary';
import InfoDialog from '@/components/InfoDialog';
import { ReclaimifyResponseViewer } from '@/components/ReclaimifyResponseViewer';
import { ThreeColumnLayout } from '@/components/ThreeColumnLayout';
import WebSearchViewer from '@/components/WebSearchViewer';
import FactCheckViewer from '@/components/FactCheckViewer';
import { SearchResult, ClaimsResponse, ReclaimifyApiResponse, FactCheckResult } from '@/types';

// Step navigation type
type AnalysisStep = 'extract' | 'claimify' | 'websearch' | 'batch' | 'factcheck' | null;

interface RelevantChunk {
  text: string;
  similarity: number;
}

// Types for the batch analysis response
interface BatchAnalysisResult {
  claim?: string;
  url?: string;
  content?: string;
  title?: string;
  excerpt?: string;
  error?: string;
  relevantChunks?: RelevantChunk[];
}

// Type guard for BatchAnalysisResult
const isBatchAnalysisResult = (data: unknown): data is BatchAnalysisResult => {
  return (
    typeof data === 'object' && 
    data !== null && 
    (data as BatchAnalysisResult).claim !== undefined
  );
};

// Type for the web search response
interface WebSearchResponse {
  urls: string[][];
  metrics?: {
    totalSearches: number;
    successfulSearches: number;
    failedSearches: number;
    sources: Record<string, number>;
    errors: Array<{ claim: string; stage: string; source: string; error: string }>;
  };
}

// Type guard for WebSearchResponse
const isWebSearchResponse = (data: unknown): data is WebSearchResponse => {
  return (
    typeof data === 'object' && 
    data !== null && 
    Array.isArray((data as WebSearchResponse).urls)
  );
};

interface AnalysisState {
  totalClaims?: number;
  analyzedCount?: number;
  verdicts?: {
    support: number;
    partially: number;
    unclear: number;
    contradict: number;
    refute: number;
  };
  avgTrustScore?: number;
  bias?: {
    positivePercent: number;
    negativePercent: number;
    otherPercent: number;
    total: number;
  };
}

interface LoadingState {
  step1: boolean; // claims extraction
  step2: boolean; // web search
  step3: boolean; // batch analysis
  step4: boolean; // fact checking
  step5: boolean; // complete
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzingClaims] = useState(false);
  const [mode] = useState<'analyze' | 'claimify' | 'reclaimify'>('analyze');
  const [activeTab, setActiveTab] = useState<'analysis' | 'summary'>('analysis');
  const [, setResult] = useState<{ url: string; content: string } | null>(null);

  const [claims, setClaims] = useState<ClaimsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [reclaimifyData, setReclaimifyData] = useState<ReclaimifyApiResponse | null>(null);

  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    totalClaims: 0,
    analyzedCount: 0,
    avgTrustScore: 0,
    verdicts: {
      support: 0,
      partially: 0,
      unclear: 0,
      contradict: 0,
      refute: 0
    }
  });
  const [loadingState, setLoadingState] = useState<LoadingState>({
    step1: false,
    step2: false,
    step3: false,
    step4: false,
    step5: false,
  });

  const [, setShowClaimsPanel] = useState(false);

  // Step navigation states
  const [selectedStep, setSelectedStep] = useState<AnalysisStep>(null);
  const [extractData, setExtractData] = useState<{ url: string; content: string; title?: string; excerpt?: string } | null>(null);
  const [websearchData, setWebsearchData] = useState<{ urlsPerClaim: string[][]; claims: Array<{ claim: string; search_date: string }> } | null>(null);
  const [factCheckResults, setFactCheckResults] = useState<FactCheckResult[]>([]);
  const [batchResults, setBatchResults] = useState<BatchAnalysisResult[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const isProbablyUrl = (value: string): boolean => {
    const v = value.trim();
    if (!v) return false;
    if (/^https?:\/\//i.test(v)) return true;
    if (/^www\./i.test(v)) return true;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v)) return true; // any scheme://
    if(/[\s\n]/.test(v)) return false; // spaces/newlines -> likely text
    // domain.tld/path pattern
    if (/^[^\s]+\.[^\s]{2,}(\/|$)/.test(v)) return true;
    try {
      // new URL will throw for plain text
      new URL(v.startsWith('http') ? v : `https://${v}`);
      return true;
    } catch {
      return false;
    }
  };

  const handleAnalyze = async () => {
    if (!url.trim()) {
      setError('Please enter a URL or text');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setResult(null);
    setClaims(null);
    setReclaimifyData(null);
    setExtractData(null);
    setWebsearchData(null);
    setFactCheckResults([]);
    setBatchResults([]);
    setSelectedStep(null);
    setLoadingState({
      step1: true,  // Starting step 1
      step2: false,
      step3: false,
      step4: false,
      step5: false
    });
    setShowClaimsPanel(false);

    try {
      // 1. Extract or accept plain text
      setLoadingState(prev => ({ ...prev, step1: true }));
      
      let extractDataResponse: { url?: string; content?: string; title?: string; excerpt?: string; error?: string };
      const inputVal = url.trim();
      const inputIsUrl = isProbablyUrl(inputVal);
      
      if (inputIsUrl) {
        const extractUrl = `/api/extract?url=${encodeURIComponent(inputVal)}`;
        
        let extractResponse: Response;
        try {
          extractResponse = await fetch(extractUrl);
          extractDataResponse = await extractResponse.json();
          
          if (!extractResponse.ok) {
            throw new Error(extractDataResponse.error || 'Failed to extract content from URL');
          }
        } catch (err) {
          throw err;
        }
        // Save extract data for step navigation
        setExtractData({
          url: extractDataResponse.url || inputVal,
          content: extractDataResponse.content || '',
          title: extractDataResponse.title,
          excerpt: extractDataResponse.excerpt
        });
        setSelectedStep('extract');
      } else {
        // Treat input as plain text and skip extract API
        extractDataResponse = { url: '', content: inputVal };
        setExtractData({ url: '', content: inputVal });
        setSelectedStep('extract');
      }
      
      // 2. Send extracted content to reclaimify for processing (works for both regular URLs and YouTube URLs)
      const reclaimifyPayload = {
        url: extractDataResponse.url || (isProbablyUrl(url.trim()) ? url.trim() : undefined),
        content: extractDataResponse.content,
        title: extractDataResponse.title,
        excerpt: extractDataResponse.excerpt
      };
      
      let reclaimifyResponse: Response;
      let reclaimifyDataResponse: ReclaimifyApiResponse;
      
      try {
        reclaimifyResponse = await fetch('/api/reclaimify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reclaimifyPayload)
        });
        
        reclaimifyDataResponse = await reclaimifyResponse.json();
        
        if (!reclaimifyResponse.ok) {
          throw new Error((reclaimifyDataResponse as ReclaimifyApiResponse & { error?: string }).error || 'Failed to process content');
        }
      } catch (err) {
        throw err;
      }
      setReclaimifyData(reclaimifyDataResponse);
      setSelectedStep('claimify');
      setResult({ url: reclaimifyDataResponse.url || url.trim(), content: reclaimifyDataResponse.content || '' });
      setActiveTab('summary'); // Switch to Analysis Summary tab after getting reclaimify data

      // 3. Build verifiable claims from new API shape first, fallback to old
      const verifiableFromArray = Array.isArray(reclaimifyDataResponse.verifiableClaims)
        ? reclaimifyDataResponse.verifiableClaims.filter((s) => typeof s === 'string' && s.trim().length > 0)
        : [];

      interface ProcessedSentence {
        category: string;
        originalSentence: string;
        // Add other properties if they exist
        [key: string]: unknown;
      }

      const processedSentences = reclaimifyDataResponse.processedSentences as (ProcessedSentence & {
        implicitClaims?: Array<string | { claim: string }>;
      })[] | undefined;
      const verifiableFromProcessed = Array.isArray(processedSentences)
        ? processedSentences
            .flatMap((p) => {
              const implicit = Array.isArray(p?.implicitClaims)
                ? p!.implicitClaims!
                    .map((c) => (typeof c === 'string' ? c : c.claim))
                    .map((s) => (s ?? '').toString().trim())
                    .filter((s) => s.length > 0)
                : [];
              if (implicit.length > 0) return implicit;
              const fc = (p?.finalClaim ?? '').toString().trim();
              return fc ? [fc] : [];
            })
            .filter((s) => s.length > 0)
        : [];

      const categorized = Array.isArray(reclaimifyDataResponse.categorizedSentences)
        ? reclaimifyDataResponse.categorizedSentences
        : [];
      const verifiableFromCategorized = categorized
        .filter((item) => item.category === 'Verifiable')
        .map((item) => item.sentence);

      const verifiableList: string[] = verifiableFromArray.length > 0
        ? verifiableFromArray
        : (verifiableFromProcessed.length > 0
            ? verifiableFromProcessed
            : verifiableFromCategorized);

      if (!verifiableList.length) {
        setLoadingState(prev => ({ ...prev, step1: false }));
        setError('No verifiable claims found from the article.');
        return;
      }

      // Collect Not Verifiable sentences for bias analysis
      const notVerifiableItems: string[] = Array.isArray(reclaimifyDataResponse.processedSentences)
        ? (reclaimifyDataResponse.processedSentences as ProcessedSentence[])
            .filter((s): s is ProcessedSentence & { originalSentence: string } => 
              s?.category === 'Not Verifiable' && 
              typeof s?.originalSentence === 'string' && 
              s.originalSentence.trim().length > 0
            )
            .map((s) => s.originalSentence.trim())
        : [];

      const searchDate = new Date().toISOString().split('T')[0];
      const claimsData = {
        claims: verifiableList.map((claim: string) => ({ claim, search_date: searchDate })),
        search_date: searchDate,
      };

      setAnalysisState(prev => ({
        ...prev,
        totalClaims: claimsData.claims.length
      }));

      // 4. Call websearch
      setLoadingState(prev => ({ ...prev, step1: false, step2: true }));
      
      const webSearchPayload = { 
        claims: claimsData.claims,
        search_date: searchDate,
        ...(isProbablyUrl(url.trim()) ? { originalUrl: url.trim() } : {})
      };
      
      let webSearchResponse: Response;
      let webSearchData: WebSearchResponse;
      
      try {
        webSearchResponse = await fetch('/api/websearch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webSearchPayload)
        });
        
        webSearchData = await webSearchResponse.json() as WebSearchResponse;
        
        if (!webSearchResponse.ok) {
          throw new Error('Failed to perform web search');
        }
      } catch (err) {
        throw err;
      }
      
      if (!isWebSearchResponse(webSearchData)) {
        throw new Error('Invalid web search response format');
      }
      
      const urlsPerClaim: string[][] = webSearchData.urls || [];
      
      // Save websearch data for step navigation
      setWebsearchData({
        urlsPerClaim,
        claims: claimsData.claims
      });
      setSelectedStep('websearch');
      
      // Flatten URLs for batch extraction and create claim mapping
      const flattenedUrls: string[] = [];
      const claimsOnePerUrl: string[] = [];
      
      urlsPerClaim.forEach((urls, claimIndex) => {
        urls.forEach(url => {
          if (typeof url === 'string' && url.trim() !== '') {
            flattenedUrls.push(url.trim());
            const claim = claimsData.claims[claimIndex]?.claim;
            claimsOnePerUrl.push(claim || '');
          }
        });
      });

      // 5. Call batch analysis with URLs and claims
      setLoadingState(prev => ({ ...prev, step2: false, step3: true }));
      
      if (flattenedUrls.length === 0) {
        const errorMsg = 'No valid URLs found for analysis';
        throw new Error(errorMsg);
      }
      
      const batchPayload = { 
        urls: flattenedUrls,
        claims: claimsOnePerUrl
      };
      
      let batchResponse: Response;
      let batchData: { results?: unknown[] } = {};
      
      try {
        batchResponse = await fetch('/api/analyze/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batchPayload)
        });
        
        batchData = await batchResponse.json();
        
        if (!batchResponse.ok) {
          console.error('Batch analysis failed:', batchData);
          throw new Error('Failed to analyze content');
        }
      } catch (err) {
        throw err;
      }

      const batchResultsLocal: BatchAnalysisResult[] = Array.isArray(batchData?.results) 
        ? batchData.results.filter(isBatchAnalysisResult) 
        : [];

      // Save batch results for step navigation
      setBatchResults(batchResultsLocal);
      setSelectedStep('batch');

      // Group extracted contents per claim for fact checking
      const contentsByClaim: Record<string, string[]> = {};
      
      batchResultsLocal.forEach((result) => {
        const claimKey = (result?.claim || '').toString().trim();
        const content = (result?.content || '').toString().trim();
        
        if (claimKey && content) {
          if (!contentsByClaim[claimKey]) {
            contentsByClaim[claimKey] = [];
          }
          contentsByClaim[claimKey].push(content);
        }
      });

      // 6. Call fact check with claims and their associated content
      setLoadingState(prev => ({ ...prev, step3: false, step4: true }));
      // Client-side rate limiter for /api/factCheck
      const FACTCHECK_REQUESTS_PER_MINUTE = 60;
      const FACTCHECK_TOKENS_PER_MINUTE = 10000;
      const FACTCHECK_COOLDOWN_MS = 60000;

      type FCQueueItem<T = unknown> = {
        run: () => Promise<T>;
        estimatedTokens: number;
        resolve: (value: T) => void;
        reject: (reason?: unknown) => void;
      };

      // Rate limiter state
      let fcSchedulerRunning = false;
      let fcCooldown = false;
      let fcCooldownTimer: number | null = null;
      let fcLastRequestTimes: number[] = [];
      let fcTokenEvents: { ts: number; tokens: number }[] = [];
      const fcPending: FCQueueItem<unknown>[] = [];

      async function fcScheduleLoop() {
        if (fcSchedulerRunning) return;
        fcSchedulerRunning = true;
        
        while (fcPending.length > 0) {
          if (fcCooldown) {
            await new Promise(r => setTimeout(r, 100));
            continue;
          }

          const now = Date.now();
          const oneMinuteAgo = now - 60000;
          
          // Clean up old requests and tokens
          fcLastRequestTimes = fcLastRequestTimes.filter(t => t > oneMinuteAgo);
          fcTokenEvents = fcTokenEvents.filter(e => e.ts > oneMinuteAgo);
          
          const usedTokens = fcTokenEvents.reduce((s, e) => s + e.tokens, 0);
          const reqCount = fcLastRequestTimes.length;
          
          // Check limits
          const hitReq = reqCount >= FACTCHECK_REQUESTS_PER_MINUTE;
          const hitTok = usedTokens >= FACTCHECK_TOKENS_PER_MINUTE;
          
          if (hitReq || hitTok) {
            fcCooldown = true;
            if (fcCooldownTimer) clearTimeout(fcCooldownTimer);
            fcCooldownTimer = window.setTimeout(() => {
              fcCooldown = false;
              fcLastRequestTimes = [];
              fcTokenEvents = [];
            }, FACTCHECK_COOLDOWN_MS);
            await new Promise(r => setTimeout(r, FACTCHECK_COOLDOWN_MS));
            continue;
          }

          let availReq = FACTCHECK_REQUESTS_PER_MINUTE - reqCount;
          let availTok = FACTCHECK_TOKENS_PER_MINUTE - usedTokens;
          
          // Sort by smallest token count first
          fcPending.sort((a, b) => a.estimatedTokens - b.estimatedTokens);
          
          let launched = 0;
          while (fcPending.length > 0 && availReq > 0) {
            const item = fcPending[0];
            if (!item || item.estimatedTokens > availTok) break;
            
            fcPending.shift();
            fcLastRequestTimes.push(now);
            fcTokenEvents.push({ ts: now, tokens: item.estimatedTokens });
            
            availReq--;
            availTok -= item.estimatedTokens;
            
            // Execute the request
            (async () => {
              try {
                const res = await item.run();
                item.resolve(res);
              } catch (e) {
                item.reject(e);
              }
            })();
            
            launched++;
          }
          
          if (launched === 0) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
        
        fcSchedulerRunning = false;
      }

      function enqueueFactCheck<T>(fn: () => Promise<T>, estimatedTokens: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
          // Create a properly typed item
          const item: FCQueueItem<T> = {
            run: fn,
            estimatedTokens,
            resolve,
            reject
          };
          
          // Cast to unknown first, then to FCQueueItem<unknown>
          fcPending.push(item as unknown as FCQueueItem<unknown>);
          void fcScheduleLoop();
        });
      }

      let factCheckResultsLocal: FactCheckResult[] = [];
      let averageTrustScore: number | undefined = undefined;
      let biasPercentages: { positive?: number; negative?: number; other?: number; total?: number } | undefined = undefined;
      const factCheckClaims = Object.entries(contentsByClaim).map(([claim, content]) => ({
            claim,
            content: content.length === 1 ? content[0] : content
          }));
      if (factCheckClaims.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const requests: Array<Promise<any>> = [];
        
        // Create a promise for each claim's fact check
        const factCheckPromises = factCheckClaims.map(claimData => {
        const estimatedTokens = 1200; // Rough estimate per request
          return enqueueFactCheck(() => 
            fetch('/api/factCheck', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ claims: [claimData] })
            })
            .then(async (r) => {
              const json = await r.json().catch(() => null);
              if (!r.ok) {
                console.error('Failed to perform fact checking for claim:', claimData.claim);
                return null;
              }
              return json;
            })
            .catch(error => {
              console.error('Error in fact check request:', error);
              return null;
            }),
            estimatedTokens
          );
        });

        // Bias request (only if we have items)
        if (notVerifiableItems.length > 0) {
          requests.push(
            fetch('/api/bias', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: notVerifiableItems })
            }).then(async (r) => {
              const json = await r.json().catch(() => null);
              if (!r.ok) throw new Error('Failed to classify opinions');
              return json;
            }).catch(() => {
              return null;
            })
          );
        }

        // Process fact check results
        const factCheckResponses = await Promise.all(factCheckPromises);
        factCheckResultsLocal = factCheckResponses
          .filter(response => response?.results?.length > 0)
          .flatMap(response => response.results);
        
        // Save fact check results progressively for step navigation
        setFactCheckResults(factCheckResultsLocal);
        setSelectedStep('factcheck');

        // Calculate average trust score from valid responses only
        // Include only Support (100), Partially Support (50), Refute (0), and Contradict (0)
        const validScores = factCheckResultsLocal
          .map(r => r.trustScore ?? r.Trust_Score ?? r.trust_score)
          .filter((score): score is number => typeof score === 'number' && !isNaN(score));

        averageTrustScore = validScores.length > 0
          ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
          : 0;

        // Process bias results if any
        if (requests.length > 0) {
          const biasResponse = await Promise.all(requests);
          const biasJson = biasResponse[0];
          if (biasJson && typeof biasJson === 'object' && biasJson.percentages) {
            biasPercentages = {
              positive: Number(biasJson.percentages.positive) || 0,
              negative: Number(biasJson.percentages.negative) || 0,
              other: Number(biasJson.percentages.other) || 0,
              total: Array.isArray(biasJson.results) ? biasJson.results.length : (notVerifiableItems.length || 0),
            };
          }
        } else if (notVerifiableItems.length === 0) {
          biasPercentages = { positive: 0, negative: 0, other: 0, total: 0 };
        }
      }

      // Merge fact-check results with batch extraction results per claim
      const groupedByClaim: Record<string, SearchResult[]> = {};
      batchResultsLocal.forEach((r) => {
        const k = (r?.claim || '').toString().trim();
        if (!k) return;
        if (!groupedByClaim[k]) groupedByClaim[k] = [];
        groupedByClaim[k].push({
          url: String(r?.url || ''),
          content: String(r?.content || ''),
          title: r?.title || undefined,
          excerpt: r?.excerpt || undefined,
          error: r?.error || undefined,
          relevantChunks: Array.isArray(r?.relevantChunks) ? r.relevantChunks as RelevantChunk[] : [],
        });
      });

      const mergedResults: SearchResult[] = claimsData.claims.map((c) => {
        const claimText = c.claim;
        const group = groupedByClaim[claimText] || [];
        const representative: SearchResult = group.length > 0
          ? group[0]
          : { url: '', content: '' };
        const fc = factCheckResultsLocal.find((r) => (r?.claim || '').toString().trim() === claimText.trim());
        // Normalize reference into either `reference` (string) or `Reference` (string[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const refAny = (fc as any)?.reference ?? (fc as any)?.Reference;
        const refString = typeof refAny === 'string' ? refAny : undefined;
        const refArray = Array.isArray(refAny) ? refAny as string[] : undefined;

        return {
          ...representative,
          relevantChunks: group.flatMap((g: SearchResult & { relevantChunks?: RelevantChunk[] }) => g.relevantChunks || []),
          factCheckSourceUrls: group.slice(0, 3).map((g: SearchResult) => g.url).filter(Boolean),
          // Map the fact-check fields to the expected case
          verdict: fc?.verdict || fc?.Verdict, // Try both cases
          reason: fc?.reason || fc?.Reason,
          ...(refString ? { reference: refString } : {}),
          ...(refArray ? { Reference: refArray } : {}),
          trustScore: typeof fc?.trustScore === 'number' ? fc.trustScore : 
                     typeof fc?.Trust_Score === 'number' ? fc.Trust_Score :
                     typeof fc?.trust_score === 'number' ? fc.trust_score : undefined,
        } as SearchResult;
      });
      
      // Add the average trust score to the first result
      if (mergedResults.length > 0) {
        mergedResults[0].aggregateTrustScore = averageTrustScore;
      }

      // Update analysis summary metrics
      const verdictCounts = { support: 0, partially: 0, unclear: 0, contradict: 0, refute: 0 };
      for (const fc of factCheckResultsLocal) {
        const v = (fc?.verdict || fc?.Verdict || '').toString();
        if (v === 'Support') verdictCounts.support++;
        else if (v === 'Partially Support') verdictCounts.partially++;
        else if (v === 'Unclear') verdictCounts.unclear++;
        else if (v === 'Contradict') verdictCounts.contradict++;
        else if (v === 'Refute') verdictCounts.refute++;
      }
      setAnalysisState((prev: AnalysisState) => ({
        ...prev,
        analyzedCount: mergedResults.length,
        verdicts: verdictCounts,
        avgTrustScore: typeof averageTrustScore === 'number' ? averageTrustScore : prev.avgTrustScore,
        bias: biasPercentages
          ? {
              positivePercent: biasPercentages.positive ?? 0,
              negativePercent: biasPercentages.negative ?? 0,
              otherPercent: biasPercentages.other ?? 0,
              total: biasPercentages.total ?? 0,
            }
          : prev.bias,
      }));

      // Update final state with merged results so ClaimsList can render
      setClaims({
        ...claimsData,
        searchResults: mergedResults,
        analysis: batchData,
        factChecks: factCheckResultsLocal
      });
      
      setShowClaimsPanel(true);
      setLoadingState(prev => ({ ...prev, step4: false, step5: true }));

    } catch (error) {
      console.error('Error:', error);
      setError(error instanceof Error ? error.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClaimify = async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }
    
    // Redirect to claimify or reclaimify page based on mode
    const path = mode === 'reclaimify' ? 're-claimify' : 'claimify';
    window.location.href = `/${path}?url=${encodeURIComponent(url.trim())}`;
    return;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (mode === 'analyze') {
        handleAnalyze();
      } else {
        handleClaimify();
      }
    }
  };

  // Render content based on selected step
  const renderStepContent = () => {
    switch (selectedStep) {
      case 'extract':
        if (!extractData) return null;
        return (
          <div className="bg-white border-2 border-black p-6 mt-6">
            <h3 className="text-lg text-gray-900 font-bold mb-4 flex items-center gap-2">
              <span>📄</span> Extracted Content
            </h3>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-gray-600">Source URL</div>
                <a href={extractData.url} target="_blank" rel="noopener noreferrer" 
                   className="text-blue-600 hover:underline break-all">
                  {extractData.url}
                </a>
              </div>
              {extractData.title && (
                <div>
                  <div className="text-sm font-medium text-gray-600">Title</div>
                  <div className="text-gray-900">{extractData.title}</div>
                </div>
              )}
              {extractData.excerpt && (
                <div>
                  <div className="text-sm font-medium text-gray-600">Excerpt</div>
                  <div className="text-gray-700 text-sm">{extractData.excerpt}</div>
                </div>
              )}
              <div>
                <div className="text-sm font-medium text-gray-600 mb-2">Content</div>
                <div className="bg-gray-50 p-4 border border-gray-200 rounded max-h-96 overflow-y-auto text-sm text-gray-800 whitespace-pre-wrap">
                  {extractData.content?.slice(0, 3000)}
                  {extractData.content && extractData.content.length > 3000 && '...'}
                </div>
              </div>
            </div>
          </div>
        );

      case 'claimify':
        if (!reclaimifyData) return null;
        return (
          <div className="bg-white border-2 border-black p-6 mt-6">
            <h3 className="text-lg text-black font-bold mb-4 flex items-center gap-2">
              <span>🔍</span> Claimify Results
            </h3>
            <ReclaimifyResponseViewer data={reclaimifyData} />
          </div>
        );

      case 'websearch':
        if (!websearchData) return null;
        return (
          <div className="bg-white border-2 border-black p-6 mt-6">
            <h3 className="text-lg text-black font-bold mb-4 flex items-center gap-2">
              <span>🌐</span> Web Search Results
            </h3>
            <WebSearchViewer 
              claims={websearchData.claims}
              urlsPerClaim={websearchData.urlsPerClaim}
              isLoading={loadingState.step2}
            />
          </div>
        );

      case 'batch':
        if (batchResults.length === 0) return null;
        return (
          <div className="bg-white border-2 border-black p-6 mt-6">
            <h3 className="text-lg text-black font-bold mb-4 flex items-center gap-2">
              <span>📦</span> Batch Analysis Results
            </h3>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                Scraped data from {batchResults.length} sources
              </div>
              <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
                {batchResults.slice(0, 20).map((result, index) => (
                  <div key={index} className="py-3">
                    <div className="flex items-start gap-2">
                      <span className="text-gray-400 font-mono text-sm">{index + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <a href={result.url} target="_blank" rel="noopener noreferrer"
                           className="text-blue-600 hover:underline text-sm truncate block">
                          {result.url}
                        </a>
                        {result.title && (
                          <div className="text-gray-900 text-sm font-medium mt-1">{result.title}</div>
                        )}
                        <div className="text-gray-600 text-xs mt-1">
                          Claim: {result.claim?.slice(0, 100)}{(result.claim?.length ?? 0) > 100 ? '...' : ''}
                        </div>
                        {result.content && (
                          <div className="text-gray-500 text-xs mt-1 line-clamp-2">
                            {result.content.slice(0, 200)}...
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {batchResults.length > 20 && (
                  <div className="py-3 text-center text-gray-500 text-sm">
                    ... and {batchResults.length - 20} more results
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'factcheck':
        return (
          <div className="bg-white border-2 border-black p-6 mt-6">
            <h3 className="text-lg text-black font-bold mb-4 flex items-center gap-2">
              <span>✅</span> Fact Check Results
            </h3>
            <FactCheckViewer 
              claims={websearchData?.claims || []}
              factCheckResults={factCheckResults}
              isLoading={loadingState.step4}
              searchResults={claims?.searchResults}
            />
          </div>
        );

      default:
        return null;
    }
  };

  // Step navigation configuration
  const steps: { id: AnalysisStep; label: string; icon: string; isActive: boolean; isComplete: boolean }[] = [
    { 
      id: 'extract', 
      label: 'Extract content', 
      icon: '📄', 
      isActive: loadingState.step1,
      isComplete: !!extractData
    },
    { 
      id: 'claimify', 
      label: 'Extract claims', 
      icon: '🔍', 
      isActive: loadingState.step1,
      isComplete: !!reclaimifyData
    },
    { 
      id: 'websearch', 
      label: 'WebSearch', 
      icon: '🌐', 
      isActive: loadingState.step2,
      isComplete: !!websearchData
    },
    { 
      id: 'batch', 
      label: 'Scrape web', 
      icon: '📦', 
      isActive: loadingState.step3,
      isComplete: batchResults.length > 0
    },
    { 
      id: 'factcheck', 
      label: 'FactCheck', 
      icon: '✅', 
      isActive: loadingState.step4,
      isComplete: factCheckResults.length > 0
    },
  ];

  // Left Sidebar Component
  const leftSidebar = (
    <div className={`h-full flex flex-col transition-all duration-300 ${isSidebarCollapsed ? 'w-16' : 'w-full'}`}>
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        {!isSidebarCollapsed && <h2 className="font-bold text-lg text-black">Analysis Steps</h2>}
        <button
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg 
            className={`w-5 h-5 text-gray-600 transition-transform duration-300 ${isSidebarCollapsed ? 'rotate-180' : ''}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className={isSidebarCollapsed ? 'flex flex-col items-center py-2' : 'divide-y divide-gray-100'}>
          {steps.map((step, index) => {
            const isSelected = selectedStep === step.id;
            const canClick = step.isComplete || step.isActive;
            
            if (isSidebarCollapsed) {
              // Collapsed view - show only emojis
              return (
                <button 
                  key={step.id} 
                  onClick={() => canClick && setSelectedStep(step.id)}
                  disabled={!canClick}
                  title={`${index + 1}. ${step.label}`}
                  className={`w-12 h-12 flex items-center justify-center text-xl transition-all duration-200 my-1 rounded ${
                    isSelected ? 'bg-blue-100 ring-2 ring-blue-600' : 
                    canClick ? 'hover:bg-gray-100' : 
                    'opacity-50 cursor-not-allowed'
                  }`}
                >
                  {step.isActive ? (
                    <span className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></span>
                  ) : (
                    <span>{step.icon}</span>
                  )}
                </button>
              );
            }
            
            // Expanded view - full content
            return (
              <button 
                key={step.id} 
                onClick={() => canClick && setSelectedStep(step.id)}
                disabled={!canClick}
                className={`w-full text-left p-4 transition-all duration-200 ${
                  isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : 
                  canClick ? 'hover:bg-gray-50 border-l-4 border-transparent' : 
                  'opacity-50 cursor-not-allowed border-l-4 border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{step.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                        {index + 1}. {step.label}
                      </span>
                      {step.isActive && (
                        <span className="inline-flex items-center">
                          <span className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></span>
                        </span>
                      )}
                      {step.isComplete && !step.isActive && (
                        <span className="text-green-600 text-sm font-medium">✓ Done</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        
        {/* Progress indicator - only show when expanded */}
        {!isSidebarCollapsed && (
          <div className="p-4 border-t border-gray-200">
            <div className="text-xs text-gray-500 mb-2">Progress</div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ 
                  width: `${(steps.filter(s => s.isComplete).length / steps.length) * 100}%` 
                }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {steps.filter(s => s.isComplete).length} / {steps.length} steps completed
            </div>
          </div>
        )}
        
        {/* Collapsed progress indicator */}
        {isSidebarCollapsed && (
          <div className="p-2 border-t border-gray-200">
            <div 
              className="w-8 mx-auto bg-gray-200 rounded-full h-1"
              title={`${steps.filter(s => s.isComplete).length} / ${steps.length} steps completed`}
            >
              <div 
                className="bg-blue-600 h-1 rounded-full transition-all duration-300"
                style={{ 
                  width: `${(steps.filter(s => s.isComplete).length / steps.length) * 100}%` 
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Main Content Component
  const mainContent = (
    <div className="space-y-6">
      {/* URL Input */}
      <div className="bg-white p-6 border-2 border-black">
        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Paste a link or text here..."
              className="w-full pl-10 pr-4 py-4 border-2 border-black rounded-none focus:outline-none focus:ring-0 focus:border-black transition-all duration-200 font-mono placeholder-gray-500 text-black bg-white"
              value={url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
          </div>
          <button 
            onClick={mode === 'analyze' ? handleAnalyze : handleClaimify}
            disabled={isLoading}
            className={`bg-black text-white font-medium py-4 px-8 rounded-none border-2 border-black hover:bg-white hover:text-black transition-all duration-200 flex-shrink-0 ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {isLoading 
              ? (mode === 'analyze' ? 'ANALYZING...' : 'PROCESSING...') 
              : mode === 'analyze' ? 'ANALYZE' : 'EXTRACT'}
          </button>
        </div>
        
        {error && (
          <div className="mt-4 p-3 bg-red-100 text-red-700 border border-red-300">
            {error}
          </div>
        )}

        {(reclaimifyData || isAnalyzingClaims || loadingState.step5) && (
          <div className="mt-6">
            <div className="flex border-b border-gray-200 mb-4">
              <button
                className={`py-2 px-4 font-medium text-sm ${
                  activeTab === 'summary' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('summary')}
              >
                Analysis Summary
              </button>
            </div>
            
            <div className={activeTab === 'analysis' ? 'block' : 'hidden'}>
              {reclaimifyData && <ReclaimifyResponseViewer data={reclaimifyData} />}
            </div>
            
            <div className={activeTab === 'summary' ? 'block' : 'hidden'}>
              <AnalysisSummary 
                totalClaims={analysisState.totalClaims}
                avgTrustScore={analysisState.avgTrustScore}
                verdicts={analysisState.verdicts}
                isLoading={loadingState.step1}
              />
            </div>
          </div>
        )} 
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href="/api/download/extension"
          className="bg-black text-white font-medium py-3 px-6 rounded-none border-2 border-black hover:bg-white hover:text-black transition-all duration-200 text-center"
        >
          DOWNLOAD EXTENSION
        </a>
        <button
          onClick={() => setShowInstall(true)}
          className="bg-white text-black font-medium py-3 px-6 rounded-none border-2 border-black hover:bg-black hover:text-white transition-all duration-200 text-center"
        >
          HOW TO INSTALL
        </button>
      </div>

      {/* Step-specific content display */}
      {selectedStep && renderStepContent()}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-black text-white p-4">
        <div className="container mx-auto">
          <h1 className="text-2xl font-bold">LUMOS</h1>
          <p className="text-sm text-gray-300">Illuminate the truth behind every headline</p>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="flex-1">
        <ThreeColumnLayout 
          leftSidebar={leftSidebar}
          mainContent={mainContent}
          isLeftCollapsed={isSidebarCollapsed}
        />
      </main>
      
      {/* Global Components */}
      <InfoDialog />
      
      {/* Install Modal */}
      {showInstall && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-extension-title"
      >
        <div className="absolute inset-0 bg-black/50" onClick={() => setShowInstall(false)} />
        <div className="relative z-10 w-full max-w-lg mx-4 bg-white p-8 rounded-none border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
          <div className="flex items-start justify-between">
            <h2 id="install-extension-title" className="text-2xl font-black text-black tracking-tight">Install the Chrome extension</h2>
            <button
              onClick={() => setShowInstall(false)}
              className="ml-4 -mt-2 text-black border-2 border-black px-2 py-1 hover:bg-black hover:text-white transition-all duration-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <ol className="mt-4 list-decimal list-inside space-y-2 text-gray-900 text-sm text-left">
            <li>Click <span className="font-semibold">DOWNLOAD EXTENSION</span> on the main page to get <code className="font-mono">extension.zip</code>.</li>
            <li>Extract the ZIP to a folder on your computer.</li>
            <li>Open Chrome and go to <span className="font-mono">chrome://extensions</span>.</li>
            <li>Enable <span className="font-semibold">Developer mode</span> (top-right).</li>
            <li>Click <span className="font-semibold">Load unpacked</span> and select the extracted <code className="font-mono">extension/</code> folder.</li>
            <li>Pin the extension from the toolbar for quick access.</li>
          </ol>
          <div className="mt-6 flex justify-end gap-3">
            <a
              href="/api/download/extension"
              className="bg-black text-white font-medium py-2 px-4 rounded-none border-2 border-black hover:bg-white hover:text-black transition-all duration-200"
            >
              Download ZIP
            </a>
            <button
              onClick={() => setShowInstall(false)}
              className="bg-white text-black font-medium py-2 px-4 rounded-none border-2 border-black hover:bg-black hover:text-white transition-all duration-200"
            >
              Close
            </button>
          </div>
          <p className="text-xs text-gray-700 mt-4">
            To update later, remove the old version in <span className="font-mono">chrome://extensions</span> and load the new extracted folder again.
          </p>
        </div>
      </div>
    )}
  </div>
)};