import { ClaimsListProps, SearchResult } from '@/types';

export default function ClaimsList({ claims, searchResults = [] }: ClaimsListProps) {
  if (!claims?.claims?.length) return null;

  // In ClaimsList.tsx, replace the return statement with:
return (
  <div className="mt-8 p-6 border-2 border-black bg-white">
    
    <div className="space-y-4">
      {claims.claims.map((claim, index) => {
      // Prefer one-to-one alignment with claims order; fallback to heuristic match
      const result = (Array.isArray(searchResults) ? searchResults[index] : undefined) ||
        searchResults.find(sr => 
          sr?.content?.includes?.(claim.claim) || 
          sr?.reference?.includes?.(claim.claim) ||
          sr?.relevantChunks?.some?.(chunk => chunk.text && chunk.text.includes(claim.claim))
        );

      if (!result) return null;

        return (
          <div key={index} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <p className="text-gray-900 font-medium">Claim: {claim.claim}</p>
                {(() => {
                  const reason = result.reason ?? result.Reason;
                  if (!reason) return null;
                  return (
                    <p className="mt-1 text-sm text-gray-700">
                      <span className="font-medium">Reason:</span> {reason}
                    </p>
                  );
                })()}
                {(() => {
                  const ref = result.reference ?? result.Reference;
                  if (!ref) return null;
                  
                  // Get all relevant chunks with source information
                  const relevantChunks = result.relevantChunks || [];
                  
                  // Helper function to find source URL for a reference
                  const findSourceUrl = (referenceText: string, idx?: number): { url: string, title?: string } | null => {
                    const sourceMatch = referenceText.match(/\[Source (\d+)\]/);
                    const fcUrls = result.factCheckSourceUrls || [];

                    // 1) Prefer mapping by [Source N] to factCheckSourceUrls
                    if (sourceMatch && sourceMatch[1]) {
                      const sourceIndex = parseInt(sourceMatch[1]) - 1;
                      if (sourceIndex >= 0) {
                        // Try factCheckSourceUrls
                        if (sourceIndex < fcUrls.length && fcUrls[sourceIndex]) {
                          return { url: fcUrls[sourceIndex] };
                        }
                        // Fallback to relevantChunks order
                        if (sourceIndex < relevantChunks.length) {
                          const chunk = relevantChunks[sourceIndex];
                          if (chunk?.source?.url) return { url: chunk.source.url, title: chunk.source.title };
                        }
                      }
                    }

                    // 2) No explicit source number: try map by current reference index
                    if (typeof idx === 'number' && idx >= 0) {
                      if (idx < fcUrls.length && fcUrls[idx]) return { url: fcUrls[idx] };
                      if (idx < relevantChunks.length) {
                        const chunkAtIdx = relevantChunks[idx];
                        if (chunkAtIdx?.source?.url) return { url: chunkAtIdx.source.url, title: chunkAtIdx.source.title };
                      }
                    }

                    // 2b) Fallback: use first available factCheck URL
                    if (fcUrls.length > 0) return { url: fcUrls[0] };

                    // 3) Fallback to first relevantChunk that has a URL
                    const chunkWithSource = relevantChunks.find(chunk => chunk.source?.url);
                    if (chunkWithSource?.source?.url) {
                      return { url: chunkWithSource.source.url, title: chunkWithSource.source.title };
                    }

                    // 4) Last resort: try to infer from searchResults by matching text
                    const inferred = searchResults.find(sr => sr.content && typeof referenceText === 'string' && sr.content.includes(referenceText));
                    if (inferred?.url) return { url: inferred.url };

                    return null;
                  };
                  
                  if (Array.isArray(ref)) {
                    return (
                      <div className="mt-1 text-sm text-gray-600">
                        <span className="font-medium">References:</span>
                        <ul className="list-disc list-inside mt-1 space-y-2">
                          {ref.map((referenceText: string, i: number) => {
                            const source = findSourceUrl(referenceText, i);
                            
                            return (
                              <li key={i} className="break-words">
                                <div className="inline">
                                  {referenceText.replace(/\[Source \d+\]\s*/, '')}
                                  {source && (
                                    <span className="ml-2 text-xs text-blue-600 break-all">
                                      [<a 
                                        href={source.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="hover:underline"
                                        title={source.title || 'View source'}
                                      >
                                        {source.url}
                                      </a>]
                                    </span>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  }
                  
                  // Single reference case
                  const source = findSourceUrl(String(ref));
                  return (
                    <div className="mt-1 text-sm text-gray-600">
                      <div>
                        <span className="font-medium">Reference:</span> {String(ref).replace(/\[Source \d+\]\s*/, '')}
                        {source && (
                          <span className="ml-2 text-xs text-blue-600 break-all">
                            [<a 
                              href={source.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="hover:underline"
                              title={source.title || 'View source'}
                            >
                              {source.url}
                            </a>]
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
              
              <div className="ml-4 text-right">
                {(result.verdict || result.Verdict) && (
                  <span className={`inline-block px-2 py-1 rounded text-sm font-medium ${
                    (result.verdict || result.Verdict) === 'Support' ? 'bg-green-100 text-green-800' :
                    (result.verdict || result.Verdict) === 'Refute' || (result.verdict || result.Verdict) === 'Contradict' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {result.verdict || result.Verdict}
                  </span>
                )}
                {(() => {
                  const trust = typeof result.trustScore === 'number' ? result.trustScore :
                                 typeof result.Trust_Score === 'number' ? result.Trust_Score : undefined;
                  if (typeof trust === 'number') {
                    return (
                      <div className="mt-1 text-lg font-bold text-black">
                        {trust}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Add this after the existing content in the claim card */}
              {result.relevantChunks && result.relevantChunks.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Sources used for verification:</h4>
                  <div className="space-y-3">
                    {result.relevantChunks.map((chunk, chunkIndex) => {
                      // Try to find the URL that contains this chunk
                      const sourceUrl = searchResults.find(sr => 
                        sr.content && sr.content.includes(chunk.text)
                      )?.url;

                      return (
                        <div key={chunkIndex} className="bg-gray-50 p-3 rounded text-sm">
                          {sourceUrl && (
                            <div className="mb-1">
                              <a 
                                href={sourceUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline break-all"
                              >
                                {new URL(sourceUrl).hostname}
                              </a>
                              <span className="text-xs text-gray-500 ml-2">
                                (Relevance: {(chunk.similarity * 100).toFixed(1)}%)
                              </span>
                            </div>
                          )}
                          <p className="text-gray-700 line-clamp-3">
                            {chunk.text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
}
