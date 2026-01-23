import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg' | 'icon';
    isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
    className,
    variant = 'primary',
    size = 'md',
    isLoading,
    children,
    disabled,
    ...props
}, ref) => {
    const variants = {
        primary: "bg-white text-black hover:bg-zinc-200 border border-transparent",
        secondary: "bg-white/5 text-white border border-white/10 hover:bg-white/10",
        ghost: "bg-transparent text-zinc-400 hover:text-white hover:bg-white/5",
        danger: "bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20",
    };

    const sizes = {
        sm: "px-3 py-1.5 text-xs rounded-lg",
        md: "px-5 py-2.5 text-sm rounded-xl",
        lg: "px-8 py-4 text-base rounded-2xl",
        icon: "p-2 rounded-xl aspect-square flex items-center justify-center"
    };

    return (
        <button
            ref={ref}
            className={cn(
                "font-semibold transition-colors duration-200 flex items-center gap-2 justify-center disabled:opacity-50",
                variants[variant],
                sizes[size],
                className
            )}
            disabled={isLoading || disabled}
            {...props}
        >
            {isLoading && (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            )}
            <span className={cn("flex items-center gap-2", isLoading && "opacity-0")}>
                {children}
            </span>
        </button>
    );
});
Button.displayName = "Button";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({
    children,
    className,
    ...props
}, ref) => {
    return (
        <div
            ref={ref}
            className={cn(
                "glass-panel rounded-2xl p-6",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
});
Card.displayName = "Card";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
    label,
    error,
    className,
    icon,
    ...props
}, ref) => {
    return (
        <div className="space-y-2">
            {label && <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider ml-1">{label}</label>}
            <div className="relative">
                {icon && (
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
                        {icon}
                    </div>
                )}
                <input
                    ref={ref}
                    className={cn(
                        "w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder:text-zinc-600 transition-colors",
                        "focus:outline-none focus:border-[var(--neon-secondary)] focus:bg-white/10",
                        icon && "pl-11",
                        error && "border-red-500",
                        className
                    )}
                    {...props}
                />
            </div>
            {error && <p className="text-xs text-red-500 ml-1">{error}</p>}
        </div>
    );
});
Input.displayName = "Input";
