'use client';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

interface FlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
}

export const FlowButton = forwardRef<HTMLButtonElement, FlowButtonProps>(
  ({ text = 'Modern Button', className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "group relative flex items-center gap-1 overflow-hidden rounded-[100px] border-[1.5px] border-accent bg-accent px-8 py-3 text-sm font-semibold text-accent-foreground cursor-pointer transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:rounded-[12px] hover:bg-transparent hover:text-primary active:scale-[0.95]",
          className
        )}
        {...props}
      >
        <ArrowRight className="absolute w-4 h-4 left-[-25%] stroke-current fill-none z-[9] group-hover:left-4 transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
        <span className="relative z-[1] -translate-x-3 group-hover:translate-x-3 transition-all duration-[800ms] ease-out">
          {text}
        </span>
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-primary-foreground rounded-full opacity-0 group-hover:w-[220px] group-hover:h-[220px] group-hover:opacity-100 transition-all duration-[800ms] ease-[cubic-bezier(0.19,1,0.22,1)]" />
        <ArrowRight className="absolute w-4 h-4 right-4 stroke-current fill-none z-[9] group-hover:right-[-25%] transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
      </button>
    );
  }
);
FlowButton.displayName = 'FlowButton';
