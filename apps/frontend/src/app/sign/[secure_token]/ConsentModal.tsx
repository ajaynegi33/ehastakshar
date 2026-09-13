"use client";

import React, { useState } from 'react';
import { Check } from 'lucide-react';

interface ConsentModalProps {
  recipientEmail: string;
  onProceed: (timestamp: string) => void;
}

export default function ConsentModal({ recipientEmail, onProceed }: ConsentModalProps) {
  const [isIdentityConfirmed, setIsIdentityConfirmed] = useState(false);
  const [isTermsAgreed, setIsTermsAgreed] = useState(false);

  const canProceed = isIdentityConfirmed && isTermsAgreed;

  const handleProceed = () => {
    if (canProceed) {
      onProceed(new Date().toISOString());
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 md:p-8 animate-in zoom-in-95 duration-300 relative overflow-hidden flex flex-col">
      <h3 className="text-2xl font-semibold text-slate-800 mb-6 border-b border-slate-100 pb-4">
        Terms and Conditions
      </h3>

      <div className="space-y-6 mb-8">
        {/* Checkbox 1 */}
        <div className="flex items-start space-x-4 cursor-pointer" onClick={() => setIsIdentityConfirmed(!isIdentityConfirmed)}>
          <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-colors duration-200 ${isIdentityConfirmed ? 'bg-violet-600' : 'bg-slate-200 hover:bg-slate-300'}`}>
            {isIdentityConfirmed && <Check size={16} className="text-white" strokeWidth={3} />}
          </div>
          <p className="text-slate-600 text-sm leading-relaxed">
            I confirm that <span className="font-medium text-slate-800">{recipientEmail}</span> belongs to me and has been verified by Ehastakshar
          </p>
        </div>

        {/* Checkbox 2 */}
        <div className="flex items-start space-x-4 cursor-pointer" onClick={() => setIsTermsAgreed(!isTermsAgreed)}>
          <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-colors duration-200 ${isTermsAgreed ? 'bg-violet-600' : 'bg-slate-200 hover:bg-slate-300'}`}>
            {isTermsAgreed && <Check size={16} className="text-white" strokeWidth={3} />}
          </div>
          <p className="text-slate-600 text-sm leading-relaxed">
            I agree to <strong className="text-violet-600 font-semibold">Terms and Conditions</strong> of Ehastakshar
          </p>
        </div>
      </div>

      <div className="flex justify-center mt-2">
        <button
          onClick={handleProceed}
          disabled={!canProceed}
          className="px-10 py-3 rounded-lg font-semibold transition-all duration-200 bg-violet-600 hover:bg-violet-700 text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
        >
          Proceed
        </button>
      </div>
    </div>
  );
}
