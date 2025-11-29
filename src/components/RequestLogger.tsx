import { useEffect, useState } from 'react';

export interface RequestLog {
  id: string;
  method: string;
  url: string;
  status: 'pending' | 'success' | 'error';
  requestBody?: any;
  response?: any;
  error?: string;
  timestamp: Date;
  duration?: number;
}

interface RequestLoggerProps {
  logs: RequestLog[];
  onClear: () => void;
  className?: string;
}

export function RequestLogger({ logs, onClear, className = '' }: RequestLoggerProps) {
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedLogs(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const formatBody = (body: any): string => {
    if (!body) return '';
    try {
      return JSON.stringify(body, null, 2);
    } catch {
      return String(body);
    }
  };

  const getStatusColor = (status: RequestLog['status']) => {
    switch (status) {
      case 'success': return 'bg-green-100 text-green-800';
      case 'error': return 'bg-red-100 text-red-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (logs.length === 0) {
    return (
      <div className={`p-4 bg-gray-50 rounded-lg text-gray-500 text-center ${className}`}>
        No API requests yet
      </div>
    );
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${className}`}>
      <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
        <h3 className="font-medium">API Request Logs</h3>
        <button
          onClick={onClear}
          className="text-sm text-gray-500 hover:text-gray-700"
          aria-label="Clear logs"
        >
          Clear All
        </button>
      </div>
      <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
        {[...logs].reverse().map((log) => (
          <div key={log.id} className="p-3 hover:bg-gray-50">
            <div 
              className="flex items-center justify-between cursor-pointer"
              onClick={() => toggleExpand(log.id)}
            >
              <div className="flex items-center space-x-2">
                <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(log.status)}`}>
                  {log.status.toUpperCase()}
                </span>
                <span className="font-mono text-sm">
                  {log.method} {new URL(log.url).pathname}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {log.duration ? `${log.duration}ms` : ''}
              </div>
            </div>
            
            {expandedLogs[log.id] && (
              <div className="mt-2 pl-4 border-l-2 border-gray-200">
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-1">Request:</div>
                  <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-40">
                    {formatBody(log.requestBody)}
                  </pre>
                </div>
                
                {log.response && (
                  <div className="mt-2">
                    <div className="text-xs text-gray-500 mb-1">Response:</div>
                    <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-60">
                      {formatBody(log.response)}
                    </pre>
                  </div>
                )}
                
                {log.error && (
                  <div className="mt-2">
                    <div className="text-xs text-red-500 mb-1">Error:</div>
                    <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                      {log.error}
                    </div>
                  </div>
                )}
                
                <div className="mt-1 text-xs text-gray-400">
                  {log.timestamp.toLocaleTimeString()}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
