import React, { useState } from 'react';
import { LucideIcon } from 'lucide-react';

interface AuthInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
  rightIcon?: React.ReactNode;
  onRightIconClick?: () => void;
  label?: string;
  error?: string;
}

export const AuthInput: React.FC<AuthInputProps> = ({ 
  icon: Icon, 
  rightIcon, 
  onRightIconClick, 
  label, 
  error, 
  ...props 
}) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="w-full space-y-1.5 mb-4 text-left">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div 
        className={`relative flex items-center w-full transition-all duration-300 border rounded-xl bg-white/50 backdrop-blur-sm
          ${isFocused 
            ? 'border-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.1)]' 
            : error ? 'border-red-300' : 'border-gray-200 hover:border-gray-300'
          }`}
      >
        {Icon && (
          <Icon 
            className={`absolute left-3.5 transition-colors duration-300 ${isFocused ? 'text-indigo-500' : 'text-gray-400'}`} 
            size={18} 
          />
        )}
        <input
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className={`w-full py-2.5 bg-transparent outline-none text-gray-800 placeholder-gray-400 text-sm transition-all
            ${Icon ? 'pl-10' : 'pl-4'} 
            ${rightIcon ? 'pr-10' : 'pr-4'}
          `}
          {...props}
        />
        {rightIcon && (
          <button 
            type="button" 
            onClick={onRightIconClick} 
            className="absolute right-3.5 text-gray-400 hover:text-gray-600 transition-colors focus:outline-none"
          >
            {rightIcon}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-1 animate-in fade-in slide-in-from-top-1">{error}</p>}
    </div>
  );
};
