'use client';

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactElement;
    className?: string;
    delay?: number;
}

export function Tooltip({ content, children, className, delay = 200 }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [coords, setCoords] = useState({ x: 0, y: 0 });
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const triggerRef = useRef<HTMLElement | null>(null);

    const handleMouseEnter = (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setCoords({
            x: rect.left + rect.width / 2,
            y: rect.top
        });

        timeoutRef.current = setTimeout(() => {
            setIsVisible(true);
        }, delay);
    };

    const handleMouseLeave = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setIsVisible(false);
    };

    // Use effect to handle potential scroll/resize while visible
    useEffect(() => {
        if (isVisible && triggerRef.current) {
            const updatePos = () => {
                const rect = triggerRef.current?.getBoundingClientRect();
                if (rect) {
                    setCoords({
                        x: rect.left + rect.width / 2,
                        y: rect.top
                    });
                }
            };
            window.addEventListener('scroll', updatePos, true);
            window.addEventListener('resize', updatePos);
            return () => {
                window.removeEventListener('scroll', updatePos, true);
                window.removeEventListener('resize', updatePos);
            };
        }
    }, [isVisible]);

    return (
        <>
            {React.cloneElement(children, {
                ref: triggerRef,
                onMouseEnter: handleMouseEnter,
                onMouseLeave: handleMouseLeave,
            })}
            {isVisible && (
                <div
                    className={cn(
                        "fixed z-[100] px-2.5 py-1.5 text-[11px] font-medium rounded-lg shadow-xl border pointer-events-none whitespace-nowrap",
                        "bg-[var(--sidebar-bg)] border-[var(--card-border)] text-[var(--foreground)]",
                        // Improved vertical slide animation — ONLY from bottom up
                        "animate-in fade-in slide-in-from-bottom-2 duration-300 origin-bottom",
                        // Use translate instead of manual style for centering to avoid conflict with animations
                        "-translate-x-1/2 -translate-y-[calc(100%+8px)]",
                        className
                    )}
                    style={{
                        left: `${coords.x}px`,
                        top: `${coords.y}px`
                    }}
                >
                    {content}
                    {/* Tiny arrow */}
                    <div 
                        className="absolute bottom-[-4.5px] left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-[var(--sidebar-bg)] border-b border-r border-[var(--card-border)]"
                    />
                </div>
            )}
        </>
    );
}
