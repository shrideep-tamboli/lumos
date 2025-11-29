'use client';

import React from 'react';

interface WebSearchViewerProps {
  claims: Array<{ claim: string; search_date: string }>;
  urlsPerClaim: string[][];
  isLoading?: boolean;
}

export default function WebSearchViewer({ claims, urlsPerClaim, isLoading }: WebSearchViewerProps) {
  if (!claims || claims.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        <div className="text-4xl mb-4">🌐</div>
        <p>No claims available for web search.</p>
        <p className="text-sm mt-2">Run the analysis first to see search results.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900">Web Search Results</h3>
        <span className="text-sm text-gray-500">
          {claims.length} claims • {urlsPerClaim.flat().length} sources found
        </span>
      </div>

      {claims.map((claimObj, index) => {
        const urls = urlsPerClaim[index] || [];
        const hasUrls = urls.length > 0;
        const isPending = isLoading && !hasUrls;

        return (
          <div
            key={index}
            className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden"
          >
            {/* Claim Header */}
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                  {index + 1}
                </span>
                <p className="text-gray-900 font-medium leading-relaxed flex-1">
                  {claimObj.claim}
                </p>
              </div>
            </div>

            {/* URLs Section */}
            <div className="px-4 py-3">
              {isPending ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                  <span className="text-sm">Searching for sources...</span>
                </div>
              ) : hasUrls ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-gray-700">
                      Sources ({urls.length})
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      ✓ Found
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {urls.map((url, urlIndex) => (
                      <li key={urlIndex} className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-800 hover:underline break-all"
                          title={url}
                        >
                          {url.length > 80 ? `${url.substring(0, 80)}...` : url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <span className="text-yellow-500">⚠</span>
                  No sources found for this claim
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
