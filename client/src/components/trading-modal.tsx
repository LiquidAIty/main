import React, { useEffect, useState } from 'react';
import TradingUI from '../pages/tradingui';

interface TradingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TradingModal({ isOpen, onClose }: TradingModalProps) {
  const [mounted, setMounted] = useState(false);

  // Handle escape key to close modal
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Handle mounting/unmounting for performance
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
    } else {
      const timer = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!mounted) return null;

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
    >
      <div 
        className={`relative w-full h-full md:w-11/12 md:h-5/6 lg:w-10/12 lg:h-5/6 xl:w-4/5 xl:h-5/6 bg-black rounded-lg shadow-xl overflow-hidden transition-transform duration-300 ${
          isOpen ? 'scale-100' : 'scale-95'
        }`}
      >
        {/* Close button */}
        <button 
          className="absolute top-4 right-4 z-10 p-1 rounded-full bg-black/50 text-white hover:bg-black/70"
          onClick={onClose}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        {/* Trading UI content */}
        <div className="w-full h-full">
          <TradingUI />
        </div>
      </div>
    </div>
  );
}
