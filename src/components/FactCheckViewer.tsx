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

export default function FactCheckViewer({ claims, factCheckResults, isLoading }: FactCheckViewerProps) {
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
  const avgScore = checkedCount > 0
    ? Math.round(factCheckResults.reduce((sum, r) => sum + (r.trustScore || r.Trust_Score || r.trust_score || 0), 0) / checkedCount)
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
                  {/* Claim text */}
                  <p className="text-gray-900 font-medium leading-relaxed">
                    <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-600 text-white rounded-full text-xs font-bold mr-2">
                      {index + 1}
                    </span>
                    {claimObj.claim}
                  </p>

                  {/* Reason */}
                  {isChecked && reason && (
                    <p className="mt-3 text-sm text-gray-700">
                      <span className="font-medium text-gray-900">Reason: </span>
                      {reason}
                    </p>
                  )}

                  {/* References */}
                  {isChecked && references.length > 0 && (
                    <div className="mt-3 text-sm text-gray-600">
                      <span className="font-medium text-gray-900">References:</span>
                      <ul className="list-disc list-inside mt-2 space-y-2">
                        {references.map((ref, refIndex) => {
                          // Check if reference is a URL
                          const isUrl = typeof ref === 'string' && (ref.startsWith('http://') || ref.startsWith('https://'));
                          
                          return (
                            <li key={refIndex} className="break-words">
                              <div className="inline">
                                {isUrl ? (
                                  <a
                                    href={ref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 hover:underline break-all"
                                  >
                                    {ref.length > 60 ? `${ref.substring(0, 60)}...` : ref}
                                  </a>
                                ) : (
                                  <span>{ref}</span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
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

                {/* Score and Verdict */}
                <div className="ml-4 text-right flex-shrink-0">
                  {isChecked ? (
                    <>
                      <span className={`inline-block px-3 py-1 rounded text-sm font-medium ${getVerdictColor(verdict)}`}>
                        {verdict}
                      </span>
                      <div className={`mt-2 text-2xl font-bold ${getScoreColor(trustScore)}`}>
                        {trustScore}
                      </div>
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
