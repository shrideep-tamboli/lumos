'use client';

import React from 'react';

interface FactCheckResult {
  claim: string;
  verdict?: string;
  Verdict?: string;
  reason?: string;
  Reason?: string;
  reference?: string | string[];
  Reference?: string | string[];
  trustScore?: number;
  Trust_Score?: number;
  trust_score?: number;
}

interface FactCheckViewerProps {
  claims: Array<{ claim: string; search_date: string }>;
  factCheckResults: FactCheckResult[];
  isLoading?: boolean;
  // Optional: pass searchResults so we can infer source URLs for references
  // Each item may include: relevantChunks, factCheckSourceUrls, url, content, Reason/Reference, etc.
  // We keep it as any to remain flexible with upstream shapes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchResults?: any[];
}

const getVerdictColor = (verdict: string) => {
  switch (verdict?.toLowerCase()) {
    case 'support':
      return 'bg-green-100 text-green-800';
    case 'partially support':
      return 'bg-lime-100 text-lime-800';
    case 'unclear':
      return 'bg-yellow-100 text-yellow-800';
    case 'contradict':
      return 'bg-orange-100 text-orange-800';
    case 'refute':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const getScoreColor = (score: number) => {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-lime-600';
  if (score >= 40) return 'text-yellow-600';
  if (score >= 20) return 'text-orange-600';
  return 'text-red-600';
};

export default function FactCheckViewer({ claims, factCheckResults, isLoading, searchResults = [] }: FactCheckViewerProps) {
  if (!claims || claims.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        <div className="text-4xl mb-4">✓</div>
        <p>No claims available for fact-checking.</p>
        <p className="text-sm mt-2">Run the analysis first to see fact-check results.</p>
      </div>
    );
  }

  // Calculate stats
  const checkedCount = factCheckResults.length;
  const totalCount = claims.length;
  
  // Only include valid numerical scores (exclude null/undefined/NaN)
  const validScores = factCheckResults
    .map(r => r.trustScore ?? r.Trust_Score ?? r.trust_score)
    .filter((score): score is number => typeof score === 'number' && !isNaN(score));
    
  const avgScore = validScores.length > 0
    ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
    : 0;

  return (
    <div className="space-y-4">
      {/* Header with progress */}
      <div className="flex items-center justify-between mb-4">
        <h3>
          {checkedCount > 0 && (
            <span className={`text-lg font-bold ${getScoreColor(avgScore)}`}>
              Trust Score: {avgScore}%
            </span>
          )}
        </h3>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {checkedCount}/{totalCount} claims verified
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-500"
          style={{ width: `${(checkedCount / totalCount) * 100}%` }}
        ></div>
      </div>

      {/* Claims list */}
      {claims.map((claimObj, index) => {
        const result = factCheckResults.find(r => r.claim === claimObj.claim);
        const isPending = !result && (isLoading || index >= checkedCount);
        const isChecked = !!result;

        // Normalize fields (handle both camelCase and PascalCase)
        const verdict = result?.verdict || result?.Verdict || 'Pending';
        const reason = result?.reason || result?.Reason || '';
        const reference = result?.reference || result?.Reference || [];
        const trustScore = result?.trustScore || result?.Trust_Score || result?.trust_score || 0;

        // Normalize reference to array
        const references = Array.isArray(reference) ? reference : (reference ? [reference] : []);

        // Try to align a searchResult for this claim to infer source URLs
        const srCandidate = (Array.isArray(searchResults) ? searchResults[index] : undefined) ||
          searchResults.find((sr) =>
            (typeof sr?.content === 'string' && sr.content.includes(claimObj.claim)) ||
            (Array.isArray(sr?.Reference) && sr.Reference.some((t: string) => t && t.includes && t.includes(claimObj.claim)))
          );

        const relevantChunks = srCandidate?.relevantChunks || [];
        const fcUrls: string[] = (srCandidate?.factCheckSourceUrls || []).filter((u: unknown): u is string => typeof u === 'string');

        // Helper: find a source URL for a reference text using [Source N], index, or fallbacks
        const findSourceUrl = (referenceText: string, idx?: number): { url: string; title?: string } | null => {
          if (typeof referenceText !== 'string') return null;
          const sourceMatch = referenceText.match(/\[Source (\d+)\]/);

          if (sourceMatch && sourceMatch[1]) {
            const sourceIndex = parseInt(sourceMatch[1], 10) - 1;
            if (sourceIndex >= 0) {
              if (sourceIndex < fcUrls.length && fcUrls[sourceIndex]) {
                return { url: fcUrls[sourceIndex] };
              }
              if (sourceIndex < relevantChunks.length) {
                const chunk = relevantChunks[sourceIndex];
                if (chunk?.source?.url) return { url: chunk.source.url, title: chunk.source.title };
              }
            }
          }

          if (typeof idx === 'number' && idx >= 0) {
            if (idx < fcUrls.length && fcUrls[idx]) return { url: fcUrls[idx] };
            if (idx < relevantChunks.length) {
              const chunkAtIdx = relevantChunks[idx];
              if (chunkAtIdx?.source?.url) return { url: chunkAtIdx.source.url, title: chunkAtIdx.source.title };
            }
          }

          if (fcUrls.length > 0) return { url: fcUrls[0] };

          const chunkWithSource = relevantChunks.find((c: any) => c?.source?.url);
          if (chunkWithSource?.source?.url) return { url: chunkWithSource.source.url, title: chunkWithSource.source.title };

          return null;
        };

        return (
          <div
            key={index}
            className={`bg-white border-2 rounded-lg overflow-hidden transition-all duration-300 ${
              isChecked ? 'border-gray-200' : 'border-gray-100 opacity-75'
            }`}
          >
            <div className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1 pr-4">
                  {/* Claim */}
                  <div className="text-gray-900 font-semibold leading-relaxed">
                    <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-600 text-white rounded-full text-xs font-bold mr-2">
                      {index + 1}
                    </span>
                    <span className="align-middle">{claimObj.claim}</span>
                  </div>

                  {/* Reason */}
                  {isChecked && reason && (
                    <div className="mt-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Reason</div>
                      <div className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded p-3">
                        {reason}
                      </div>
                    </div>
                  )}

                  {/* References with source URLs */}
                  {isChecked && references.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">References</div>
                      <div className="space-y-2">
                        {references.map((ref, refIndex) => {
                          const refText = String(ref ?? '');
                          const src = findSourceUrl(refText, refIndex);
                          const cleaned = refText.replace(/\[Source \d+\]\s*/, '');
                          const inlineUrlMatch = refText.match(/https?:\/\/\S+/);
                          const directUrl = inlineUrlMatch ? inlineUrlMatch[0] : undefined;

                          return (
                            <div key={refIndex} className="border border-gray-200 rounded p-3 bg-white">
                              <div className="text-sm text-gray-800 break-words">{cleaned}</div>
                              {(src?.url || directUrl) && (
                                <div className="mt-2 flex items-center gap-2 text-xs">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                    Source
                                  </span>
                                  <a
                                    href={(src?.url || directUrl) as string}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline break-all"
                                    title={src?.title || 'View source'}
                                  >
                                    {(src?.url || directUrl) as string}
                                  </a>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Loading state */}
                  {isPending && (
                    <div className="mt-3 flex items-center gap-2 text-gray-500">
                      <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      <span className="text-sm">Verifying claim...</span>
                    </div>
                  )}
                </div>

                {/* Verdict and Score */}
                <div className="ml-4 text-right flex-shrink-0">
                  {isChecked ? (
                    <>
                      <span className={`inline-block px-3 py-1 rounded text-sm font-medium ${getVerdictColor(verdict)}`}>
                        {verdict}
                      </span>
                      {typeof trustScore === 'number' && (
                        <div className={`mt-2 text-2xl font-bold ${getScoreColor(trustScore)}`}>
                          {trustScore}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="inline-block px-3 py-1 rounded text-sm font-medium bg-gray-100 text-gray-500">
                        Pending
                      </span>
                      <div className="mt-2 text-2xl font-bold text-gray-300">
                        --
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
