import React from 'react';

interface RequestProgressDialogProps {
  activeRequests: Array<{
    id: string;
    method: string;
    url: string;
    status: 'pending' | 'success' | 'error';
    progress?: number;
  }>;
}

export function RequestProgressDialog({ activeRequests }: RequestProgressDialogProps) {
  if (activeRequests.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-full bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-medium text-gray-900 dark:text-white">Active Requests</h3>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
        {activeRequests.map((request) => (
          <div key={request.id} className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {request.method} {request.url}
              </div>
              <span className={`px-2 py-0.5 text-xs rounded-full ${
                request.status === 'pending' 
                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' 
                  : request.status === 'success'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
              }`}>
                {request.status}
              </span>
            </div>
            {request.status === 'pending' && (
              <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-in-out"
                  style={{
                    width: `${request.progress || 0}%`,
                    backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.15) 50%, rgba(255,255,255,.15) 75%, transparent 75%, transparent)'
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
