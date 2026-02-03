import { useState, KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchInputProps {
    placeholder?: string;
    onSearch: (value: string) => void;
    className?: string;
    defaultValue?: string;
    value?: string;
    onChange?: (value: string) => void;
}

export function SearchInput({
    placeholder,
    onSearch,
    className,
    defaultValue = '',
    value: controlledValue,
    onChange
}: SearchInputProps) {
    const isControlled = controlledValue !== undefined;
    const [internalValue, setInternalValue] = useState(defaultValue);

    const value = isControlled ? controlledValue : internalValue;
    const isSearchActive = defaultValue && value === defaultValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        if (!isControlled) {
            setInternalValue(newValue);
        }
        onChange?.(newValue);

        // Auto-reset when cleared
        if (newValue === '') {
            onSearch('');
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            onSearch(value);
        }
    };

    const handleIconClick = () => {
        if (isSearchActive) {
            // Clear search
            if (!isControlled) setInternalValue('');
            onChange?.('');
            onSearch('');
        } else {
            // Initiate search
            onSearch(value);
        }
    };

    return (
        <div className={cn("relative", className)}>
            <button
                onClick={handleIconClick}
                className={cn(
                    "absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-all duration-200 z-10",
                    value
                        ? "bg-white text-black hover:bg-gray-200 cursor-pointer shadow-sm"
                        : "text-[var(--muted)] cursor-default bg-transparent"
                )}
                disabled={!value && !isSearchActive}
                title={isSearchActive ? "Clear search" : "Search"}
            >
                {isSearchActive ? <X size={16} /> : <Search size={16} />}
            </button>
            <input
                type="text"
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="pl-10 pr-16 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] w-full transition-all"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <span className="text-[10px] text-[var(--muted)] font-mono border border-[var(--card-border)] bg-[var(--card-bg)] px-1.5 py-0.5 rounded opacity-70">
                    ENTER
                </span>
            </div>
        </div>
    );
}
