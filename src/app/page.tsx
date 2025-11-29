'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

import ClaimsList from '@/components/ClaimsList';
import InfoDialog from '@/components/InfoDialog';
import { ReclaimifyResponseViewer } from '@/components/ReclaimifyResponseViewer';
import { RequestLog } from '@/components/RequestLogger';
import { RequestLogger } from '@/components/RequestLogger';
import { RequestProgressDialog } from '@/components/RequestProgressDialog';
import { ThreeColumnLayout } from '@/components/ThreeColumnLayout';
import { SearchResult, ClaimsResponse, ReclaimifyApiResponse, FactCheckResult } from '@/types';

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

  const [showClaimsPanel, setShowClaimsPanel] = useState(false);
  const [requestLogs, setRequestLogs] = useState<RequestLog[]>([]);
  const [activeRequests, setActiveRequests] = useState<Array<{
    id: string;
    method: string;
    url: string;
    status: 'pending' | 'success' | 'error';
    progress?: number;
  }>>([]);
  
  const progressIntervals = useRef<Record<string, NodeJS.Timeout>>({});
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  const logRequest = useCallback((log: Omit<RequestLog, 'id' | 'timestamp'>) => {
    const id = uuidv4();
    const timestamp = new Date();
    
    // Add to active requests
    setActiveRequests(prev => [
      ...prev,
      {
        id,
        method: log.method,
        url: log.url,
        status: log.status,
        progress: 0
      }
    ]);
    
    // Start progress animation
    progressIntervals.current[id] = setInterval(() => {
      setActiveRequests(prev => 
        prev.map(req => 
          req.id === id && req.status === 'pending' && req.progress !== undefined && req.progress < 90
            ? { ...req, progress: req.progress + 10 }
            : req
        )
      );
    }, 500);
    
    // Add new log to the end of the array (chronological order)
    setRequestLogs(prevLogs => [
      ...prevLogs,
      {
        id,
        timestamp,
        ...log
      }
    ]);
    
    setSelectedRequestId(id);
    return id;
  }, []);

  const updateRequestLog = useCallback((id: string, updates: Partial<Omit<RequestLog, 'id' | 'timestamp'>>) => {
    setRequestLogs(prevLogs =>
      prevLogs.map(log =>
        log.id === id ? { ...log, ...updates } : log
      )
    );
    
    // Update active requests
    if (updates.status && updates.status !== 'pending') {
      // Clear the progress interval for this request
      if (progressIntervals.current[id]) {
        clearInterval(progressIntervals.current[id]);
        delete progressIntervals.current[id];
      }
      
      // Update the request status
      setActiveRequests(prev => 
        prev.map(req => 
          req.id === id 
            ? { 
                ...req, 
                status: updates.status as 'success' | 'error',
                progress: 100 
              }
            : req
        )
      );
      
      // Remove from active requests after a delay
      setTimeout(() => {
        setActiveRequests(prev => prev.filter(req => req.id !== id));
      }, 1000);
    }
  }, []);

  const clearLogs = useCallback(() => {
    setRequestLogs([]);
    // Clear all progress intervals
    Object.values(progressIntervals.current).forEach(interval => clearInterval(interval));
    progressIntervals.current = {};
    setActiveRequests([]);
  }, []);

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(progressIntervals.current).forEach(interval => clearInterval(interval));
    };
  }, []);

  const selectedRequest = selectedRequestId
    ? requestLogs.find(l => l.id === selectedRequestId) || null
    : (requestLogs[requestLogs.length - 1] || null);
  const selectedActive = selectedRequest
    ? activeRequests.find(a => a.id === selectedRequest.id)
    : undefined;

  const handleAnalyze = async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }
    
    // Clear previous logs when starting a new analysis
    setRequestLogs([]);

    setIsLoading(true);
    setError(null);
    setResult(null);
    setClaims(null);
    setReclaimifyData(null);
    setLoadingState({
      step1: true,  // Starting step 1
      step2: false,
      step3: false,
      step4: false,
      step5: false
    });
    setShowClaimsPanel(false);

    try {
      // 1. Extract text from URL (handles both regular URLs and YouTube URLs)
      setLoadingState(prev => ({ ...prev, step1: true }));
      
      const extractUrl = `/api/extract?url=${encodeURIComponent(url.trim())}`;
      const extractLogId = logRequest({
        method: 'GET',
        url: extractUrl,
        status: 'pending',
        requestBody: { url: url.trim() }
      });
      
      let extractResponse: Response;
      let extractData: any;
      
      try {
        extractResponse = await fetch(extractUrl);
        extractData = await extractResponse.json();
        
        updateRequestLog(extractLogId, {
          status: extractResponse.ok ? 'success' : 'error',
          response: extractData,
          error: extractResponse.ok ? undefined : extractData.error || 'Failed to extract content'
        });
        
        if (!extractResponse.ok) {
          throw new Error(extractData.error || 'Failed to extract content from URL');
        }
      } catch (err) {
        updateRequestLog(extractLogId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error during extraction'
        });
        throw err;
      }
      
      // 2. Send extracted content to reclaimify for processing (works for both regular URLs and YouTube URLs)
      const reclaimifyPayload = {
        url: extractData.url || url.trim(),
        content: extractData.content,
        title: extractData.title,
        excerpt: extractData.excerpt
      };
      
      const reclaimifyLogId = logRequest({
        method: 'POST',
        url: '/api/reclaimify',
        status: 'pending',
        requestBody: {
          ...reclaimifyPayload,
          content: reclaimifyPayload.content ? '[content truncated]' : null
        }
      });
      
      let reclaimifyResponse: Response;
      let reclaimifyData: ReclaimifyApiResponse;
      
      try {
        reclaimifyResponse = await fetch('/api/reclaimify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reclaimifyPayload)
        });
        
        reclaimifyData = await reclaimifyResponse.json();
        
        updateRequestLog(reclaimifyLogId, {
          status: reclaimifyResponse.ok ? 'success' : 'error',
          response: reclaimifyData,
          error: reclaimifyResponse.ok ? undefined : (reclaimifyData as any).error || 'Failed to process content'
        });
        
        if (!reclaimifyResponse.ok) {
          throw new Error((reclaimifyData as any).error || 'Failed to process content');
        }
      } catch (err) {
        updateRequestLog(reclaimifyLogId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error during reclaimify processing'
        });
        throw err;
      }
      setReclaimifyData(reclaimifyData);
      setResult({ url: reclaimifyData.url || url.trim(), content: reclaimifyData.content || '' });
      setActiveTab('summary'); // Switch to Analysis Summary tab after getting reclaimify data

      // 3. Build verifiable claims from new API shape first, fallback to old
      const verifiableFromArray = Array.isArray(reclaimifyData.verifiableClaims)
        ? reclaimifyData.verifiableClaims.filter((s) => typeof s === 'string' && s.trim().length > 0)
        : [];

      interface ProcessedSentence {
        category: string;
        originalSentence: string;
        // Add other properties if they exist
        [key: string]: unknown;
      }

      const processedSentences = reclaimifyData.processedSentences as (ProcessedSentence & {
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

      const categorized = Array.isArray(reclaimifyData.categorizedSentences)
        ? reclaimifyData.categorizedSentences
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
      const notVerifiableItems: string[] = Array.isArray(reclaimifyData.processedSentences)
        ? (reclaimifyData.processedSentences as ProcessedSentence[])
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
        originalUrl: url.trim()
      };
      
      const webSearchLogId = logRequest({
        method: 'POST',
        url: '/api/websearch',
        status: 'pending',
        requestBody: webSearchPayload
      });
      
      let webSearchResponse: Response;
      let webSearchData: WebSearchResponse;
      
      try {
        webSearchResponse = await fetch('/api/websearch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webSearchPayload)
        });
        
        webSearchData = await webSearchResponse.json() as WebSearchResponse;
        
        updateRequestLog(webSearchLogId, {
          status: webSearchResponse.ok ? 'success' : 'error',
          response: webSearchData,
          error: webSearchResponse.ok ? undefined : 'Failed to perform web search'
        });
        
        if (!webSearchResponse.ok) {
          throw new Error('Failed to perform web search');
        }
      } catch (err) {
        updateRequestLog(webSearchLogId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error during web search'
        });
        throw err;
      }
      
      if (!isWebSearchResponse(webSearchData)) {
        throw new Error('Invalid web search response format');
      }
      
      const urlsPerClaim: string[][] = webSearchData.urls || [];
      
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
        logRequest({
          method: 'POST',
          url: '/api/analyze/batch',
          status: 'error',
          requestBody: { urls: [], claims: claimsOnePerUrl },
          error: errorMsg
        });
        throw new Error(errorMsg);
      }
      
      const batchPayload = { 
        urls: flattenedUrls,
        claims: claimsOnePerUrl
      };
      
      const batchLogId = logRequest({
        method: 'POST',
        url: '/api/analyze/batch',
        status: 'pending',
        requestBody: {
          ...batchPayload,
          urls: batchPayload.urls.map(url => ({
            url: url,
            content: '[content truncated]'
          }))
        }
      });
      
      let batchResponse: Response;
      let batchData: { results?: unknown[] } = {};
      
      try {
        batchResponse = await fetch('/api/analyze/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batchPayload)
        });
        
        batchData = await batchResponse.json();
        
        updateRequestLog(batchLogId, {
          status: batchResponse.ok ? 'success' : 'error',
          response: batchData,
          error: batchResponse.ok ? undefined : 'Batch analysis failed'
        });
        
        if (!batchResponse.ok) {
          console.error('Batch analysis failed:', batchData);
          throw new Error('Failed to analyze content');
        }
      } catch (err) {
        updateRequestLog(batchLogId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error during batch analysis'
        });
        throw err;
      }

      const batchResults: BatchAnalysisResult[] = Array.isArray(batchData?.results) 
        ? batchData.results.filter(isBatchAnalysisResult) 
        : [];

      // Group extracted contents per claim for fact checking
      const contentsByClaim: Record<string, string[]> = {};
      
      batchResults.forEach((result) => {
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

      let factCheckResults: FactCheckResult[] = [];
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
          const fcLogId = logRequest({
            method: 'POST',
            url: '/api/factCheck',
            status: 'pending',
            requestBody: { claims: [claimData] }
          });

          return fetch('/api/factCheck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ claims: [claimData] }) // Send one claim at a time
          })
          .then(async (r) => {
            const json = await r.json().catch(() => null);
            updateRequestLog(fcLogId, {
              status: r.ok ? 'success' : 'error',
              response: json || undefined,
              error: r.ok ? undefined : 'Failed to perform fact checking'
            });
            if (!r.ok) {
              console.error('Failed to perform fact checking for claim:', claimData.claim);
              return null;
            }
            return json;
          })
          .catch(error => {
            updateRequestLog(fcLogId, { status: 'error', error: String(error) });
            console.error('Error in fact check request:', error);
            return null;
          });
        });

        // Bias request (only if we have items)
        if (notVerifiableItems.length > 0) {
          const biasLogId = logRequest({
            method: 'POST',
            url: '/api/bias',
            status: 'pending',
            requestBody: { items: notVerifiableItems.length }
          });
          requests.push(
            fetch('/api/bias', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: notVerifiableItems })
            }).then(async (r) => {
              const json = await r.json().catch(() => null);
              updateRequestLog(biasLogId, {
                status: r.ok ? 'success' : 'error',
                response: json || undefined,
                error: r.ok ? undefined : 'Failed to classify opinions'
              });
              if (!r.ok) throw new Error('Failed to classify opinions');
              return json;
            }).catch((e) => {
              updateRequestLog(biasLogId, { status: 'error', error: String(e) });
              return null;
            })
          );
        }

        // Process fact check results
        const factCheckResponses = await Promise.all(factCheckPromises);
        factCheckResults = factCheckResponses
          .filter(response => response?.results?.length > 0)
          .flatMap(response => response.results);

        // Calculate average trust score from successful responses
        const validScores = factCheckResults
          .filter(r => typeof r.trustScore === 'number' || typeof r.Trust_Score === 'number')
          .map(r => (r.trustScore ?? r.Trust_Score) as number); // Type assertion to ensure number[]

        if (validScores.length > 0) {
          averageTrustScore = validScores.reduce((sum, score) => sum + score, 0) / validScores.length;
        }

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
      batchResults.forEach((r) => {
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
        const fc = factCheckResults.find((r) => (r?.claim || '').toString().trim() === claimText.trim());
        // Normalize reference into either `reference` (string) or `Reference` (string[])
        // Instead of using 'any', use the FactCheckResult interface
        const refAny = (fc as FactCheckResult)?.reference ?? (fc as FactCheckResult)?.Reference;
        const refString = typeof refAny === 'string' ? refAny : undefined;
        const refArray = Array.isArray(refAny) ? (refAny as string[]) : undefined;

        return {
          ...representative,
          relevantChunks: group.flatMap((g: SearchResult & { relevantChunks?: RelevantChunk[] }) => g.relevantChunks || []),
          factCheckSourceUrls: group.slice(0, 3).map((g: SearchResult) => g.url).filter(Boolean),
          verdict: fc?.verdict || fc?.Verdict,
          reason: fc?.reason || fc?.Reason,
          ...(refString ? { reference: refString } : {}),
          ...(refArray ? { Reference: refArray } : {}),
          trustScore: typeof fc?.trustScore === 'number' ? fc.trustScore :
                      typeof fc?.Trust_Score === 'number' ? fc.Trust_Score :
                      typeof fc?.trust_score === 'number' ? fc.trust_score : undefined,
        };
      });
      
      // Add the average trust score to the first result
      if (mergedResults.length > 0) {
        mergedResults[0].aggregateTrustScore = averageTrustScore;
      }

      // Update analysis summary metrics
      const verdictCounts = { support: 0, partially: 0, unclear: 0, contradict: 0, refute: 0 };
      for (const fc of factCheckResults) {
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
        factChecks: factCheckResults
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const searchClaims = async (claimsData: ClaimsResponse, originalUrl: string) => {
    try {
      // 1. Get search results
      setLoadingState((prev: LoadingState) => ({ ...prev, step2: false, step3: true }));
      
      const searchResponse = await fetch('/api/websearch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claims: claimsData.claims,
          search_date: claimsData.search_date,
          originalUrl: originalUrl
        }),
      });
      
      if (!searchResponse.ok) {
        throw new Error('Failed to search claims');
      }
      
      const { urls } = await searchResponse.json(); // now urls: string[][]
      if (!urls || !urls.length) return [];

      // Build normalized per-claim url lists and keep per-claim counts to regroup
      const rawPerClaimUrls: string[][] = urls as string[][];
      const perClaimUrls: string[][] = rawPerClaimUrls.map(group =>
        (group || [])
          .flatMap(u => String(u).split(/[,;\n\r]+/).map(s => s.trim()))
          .filter(s => s.length > 0)
      );

      // Deduplicate each group's URLs while preserving order
      const perClaimUrlsNormalized = perClaimUrls.map(arr => Array.from(new Set(arr)));

      // Flatten and keep only http(s) URLs
      const flatUrls: string[] = perClaimUrlsNormalized.flat().filter(s => /^https?:\/\//i.test(s));
      if (flatUrls.length === 0) return [];

      // 2. Extract content from search results (batch)
      setLoadingState((prev: LoadingState) => ({ ...prev, step3: false, step4: true }));
      
      const analyzeResponse = await fetch('/api/analyze/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: flatUrls
        }),
      });

      if (!analyzeResponse.ok) {
        throw new Error('Failed to analyze search results');
      }

      // Explicitly type the response to avoid `never` inference and safely access .content
      interface AnalyzeBatchResult { url?: string | null; content?: string | null; relevantChunks?: RelevantChunk[]; title?: string; excerpt?: string; error?: string; [key: string]: unknown }
      const analyzeJson = await analyzeResponse.json() as unknown;
      const rawResults: AnalyzeBatchResult[] = [];
      if (analyzeJson && typeof analyzeJson === 'object' && 'results' in analyzeJson) {
        const maybeResults = (analyzeJson as Record<string, unknown>)['results'];
        if (Array.isArray(maybeResults)) {
          for (const item of maybeResults) {
            if (item && typeof item === 'object') rawResults.push(item as AnalyzeBatchResult);
          }
        }
      }

      // Normalize rawResults into SearchResult shape (guarantee url/content are strings)
      const normalizedResults: SearchResult[] = rawResults.map((r) => ({
        url: r.url || '',
        content: r.content || '',
        title: r.title || undefined,
        excerpt: r.excerpt || undefined,
        error: r.error || undefined,
        relevantChunks: Array.isArray(r.relevantChunks) ? r.relevantChunks as RelevantChunk[] : [],
      }));

      // results correspond to flatUrls order

      // Regroup results per claim (using normalizedResults)
      const groupedResults: SearchResult[][] = [];
      let offset = 0;
      for (let i = 0; i < perClaimUrls.length; i++) {
        const count = perClaimUrls[i]?.length || 0;
        const group = normalizedResults.slice(offset, offset + count);
        groupedResults.push(group);
        offset += count;
      }

      // Update analyzed count (Box 2) after batch analysis
      // count items that have at least a url or content
      const analyzedCount = normalizedResults.filter((r) => !!(r && (r.content || r.url))).length;
      setAnalysisState((prev: AnalysisState) => ({
        ...prev,
        analyzedCount: analyzedCount
      }));
      
      // 3. Prepare and log fact-checking request
      // For each claim, send the extracted contents from up to 3 urls as an array (one per source)
      const factCheckRequest = {
        claims: claimsData.claims.map((claim, index) => {
          const group = groupedResults[index] || [];
          const contentsArray = group
            .slice(0, 3)
            .map((g: SearchResult) => g.content || '');
          return {
            claim: claim.claim,
            content: contentsArray
          };
        })
      };
      
      console.log('Sending to /api/factCheck:', JSON.stringify({
        claimsCount: factCheckRequest.claims.length,
        sampleClaim: factCheckRequest.claims[0]
      }, null, 2));
      
      // 4. Perform fact-checking and get results with average trust score
      const factCheckResponse = await fetch('/api/factCheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(factCheckRequest),
      });

      if (!factCheckResponse.ok) {
        throw new Error('Failed to fact-check results');
      }

      const { results: factCheckResults, averageTrustScore } = await factCheckResponse.json();
      
      // Merge fact-check results into groupedResults (assign verdict/reference/trustScore per claim)
      const merged: SearchResult[] = groupedResults.map((group, index) => {
        const fc = (Array.isArray(factCheckResults) && (factCheckResults[index] ||
                  factCheckResults.find((r: { claim?: string }) => r?.claim === claimsData.claims?.[index]?.claim))) || undefined;
        // Keep first group's result as representative and attach fc data
        const representative: SearchResult = group.length > 0
          ? group[0]
          : { url: perClaimUrls[index]?.[0] || '', content: '' };
        
        // Debug log to see what we're getting
        console.log(`Fact-check result for claim ${index}:`, fc);
        
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
      if (merged.length > 0) {
        merged[0].aggregateTrustScore = averageTrustScore;
      }
      
      return merged;
    } catch (error) {
      console.error('Error in search, analyze, and fact-check:', error);
      return [];
    }
  };

  // Left Sidebar Component
  const leftSidebar = (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-bold text-lg">Requests</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {requestLogs.length === 0 ? (
          <div className="text-sm text-gray-600 p-4">No requests yet</div>
        ) : (
          <div className="divide-y divide-gray-200">
            {requestLogs.map((log) => {
              const ar = activeRequests.find(a => a.id === log.id);
              const isSel = selectedRequestId === log.id;
              return (
                <button 
                  key={log.id} 
                  onClick={() => setSelectedRequestId(log.id)}
                  className={`w-full text-left p-3 hover:bg-gray-50 ${isSel ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-mono truncate ${log.status === 'error' ? 'text-red-600' : 'text-gray-900'}`}>
                      {log.method} {log.url}
                    </span>
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      log.status === 'success' ? 'bg-green-500' : 
                      log.status === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                    }`}></span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                  {log.status === 'pending' && (
                    <div className="mt-1 w-full bg-gray-200 h-1.5">
                      <div 
                        className="bg-blue-600 h-1.5 transition-all duration-300" 
                        style={{ width: `${ar?.progress ?? 0}%` }} 
                      />
                    </div>
                  )}
                </button>
              );
            })}
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
              placeholder="Paste your link here..."
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
                  activeTab === 'analysis' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('analysis')}
              >
                Claimify Analysis
              </button>
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
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div className="p-3 bg-gray-50 border border-gray-200 rounded">
                  <div className="text-gray-600 text-xs uppercase font-medium">Total Claims</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">
                    {loadingState.step1 ? '...' : analysisState.totalClaims || 0}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded">
                  <div className="text-gray-600 text-xs uppercase font-medium">Avg. Trust Score</div>
                  <div className="text-2xl font-bold text-blue-600 mt-1">
                    {typeof analysisState.avgTrustScore === 'number' ? 
                      analysisState.avgTrustScore.toFixed(2) : '0.00'}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 border border-green-100 rounded">
                  <div className="text-gray-600 text-xs uppercase font-medium">Support</div>
                  <div className="text-2xl font-bold text-green-600 mt-1">
                    {analysisState.verdicts?.support || 0}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 border border-blue-100 rounded">
                  <div className="text-gray-600 text-xs uppercase font-medium">Partially Support</div>
                  <div className="text-2xl font-bold text-blue-500 mt-1">
                    {analysisState.verdicts?.partially || 0}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 border border-yellow-100 rounded">
                  <div className="text-gray-600 text-xs uppercase font-medium">Unclear</div>
                  <div className="text-2xl font-bold text-yellow-600 mt-1">
                    {analysisState.verdicts?.unclear || 0}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 border border-orange-100 rounded">
                  <div className="text-gray-600 text-xs uppercase font-medium">Contradict</div>
                  <div className="text-2xl font-bold text-orange-600 mt-1">
                    {analysisState.verdicts?.contradict || 0}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 border border-red-100 rounded">
                  <div className="text-gray-600 text-xs uppercase font-medium">Refute</div>
                  <div className="text-2xl font-bold text-red-600 mt-1">
                    {analysisState.verdicts?.refute || 0}
                  </div>
                </div>
              </div>
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
    </div>
  );

  // Right Sidebar Component
  const rightSidebar = (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-bold text-lg">Overview</h2>
      </div>
      <div className="p-4 border-b border-gray-200">
        <div className="text-gray-800 text-sm">Avg. Trust Score</div>
        <div className="text-3xl font-extrabold text-blue-700">
          {typeof analysisState.avgTrustScore === 'number' ? analysisState.avgTrustScore.toFixed(2) : '0.00'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="font-medium text-gray-900 mb-2">Claims</h3>
        <div className="space-y-2">
          {claims ? (
            <ClaimsList claims={claims} searchResults={claims?.searchResults} />
          ) : (
            <div className="text-sm text-gray-500">No claims yet. Analyze a URL to see claims.</div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-black text-white p-4">
        <div className="container mx-auto">
          <h1 className="text-2xl font-bold">LUMOUS</h1>
          <p className="text-sm text-gray-300">Illuminate the truth behind every headline</p>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="flex-1">
        <ThreeColumnLayout 
          leftSidebar={leftSidebar}
          mainContent={mainContent}
          rightSidebar={rightSidebar}
        />
      </main>
      
      {/* Global Components */}
      <InfoDialog />
      <RequestProgressDialog activeRequests={activeRequests} />
      
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