import React from 'react';

interface VerdictCounts {
  support: number;
  partially: number;
  unclear: number;
  contradict: number;
  refute: number;
  cannotVerify: number;
}

interface AnalysisSummaryProps {
  totalClaims?: number;
  avgTrustScore?: number | null;
  verdicts?: Partial<VerdictCounts>;
  isLoading?: boolean;
}

const defaultVerdicts: VerdictCounts = {
  support: 0,
  partially: 0,
  unclear: 0,
  contradict: 0,
  refute: 0,
  cannotVerify: 0
};

const TrustScoreMeter = ({ score = 0, isLoading = false }) => {
  const percentage = Math.min(100, Math.max(0, score));
  const getColorClass = (score: number) => {
    if (score < 25) return 'from-red-500 to-yellow-500';
    if (score < 75) return 'from-yellow-500 to-green-500';
    return 'from-green-500 to-green-600';
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-white rounded-lg shadow-sm border border-gray-100">
      <div className="text-4xl font-bold text-gray-800 mb-2">
        {isLoading ? '...' : score.toFixed(0)}
      </div>
      <div className="text-sm text-gray-500 mb-6">Trust Score</div>
      
      <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
        <div 
          className={`h-full rounded-full bg-gradient-to-r ${getColorClass(percentage)} transition-all duration-1000 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      
      <div className="w-full flex justify-between text-xs text-gray-500 px-1">
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  );
};

export const AnalysisSummary: React.FC<AnalysisSummaryProps> = ({
  totalClaims = 0,
  avgTrustScore = 0,
  verdicts = {},
  isLoading = false
}) => {
  const safeVerdicts = { ...defaultVerdicts, ...verdicts };
  const score = typeof avgTrustScore === 'number' ? avgTrustScore : 0;
  
  // Calculate unverified claims (total - sum of all verdicts)
  const totalVerified = safeVerdicts.support + safeVerdicts.partially + safeVerdicts.unclear + 
                       safeVerdicts.contradict + safeVerdicts.refute;
  const cannotVerify = Math.max(0, totalClaims - totalVerified);

  const verdictItems = [
    { label: 'Support', count: safeVerdicts.support, color: 'text-green-600 bg-green-50 border-green-100' },
    { label: 'Partially Support', count: safeVerdicts.partially, color: 'text-blue-500 bg-blue-50 border-blue-100' },
    { label: 'Unclear', count: safeVerdicts.unclear, color: 'text-yellow-600 bg-yellow-50 border-yellow-100' },
    { label: 'Contradict', count: safeVerdicts.contradict, color: 'text-orange-600 bg-orange-50 border-orange-100' },
    { label: 'Refute', count: safeVerdicts.refute, color: 'text-red-600 bg-red-50 border-red-100' },
    { label: 'Cannot Verify', count: cannotVerify, color: 'text-gray-600 bg-gray-50 border-gray-200' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Left Column - Trust Score Meter */}
      <div className="h-full">
        <TrustScoreMeter score={score} isLoading={isLoading} />
      </div>
      
      {/* Right Column - Verdicts and Claims */}
      <div className="grid grid-cols-2 gap-3">
        {/* Total Claims */}
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-gray-500 text-xs uppercase font-medium mb-1">Total Claims</div>
          <div className="text-2xl font-bold text-gray-900">
            {isLoading ? '...' : totalClaims}
          </div>
        </div>
        
        {/* Verdicts */}
        {verdictItems.map((item) => (
          <div 
            key={item.label} 
            className={`p-4 border rounded-lg ${item.color} flex flex-col`}
          >
            <div className="text-xs uppercase font-medium mb-1">{item.label}</div>
            <div className="text-xl font-bold mt-auto">
              {isLoading ? '...' : item.count}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnalysisSummary;
