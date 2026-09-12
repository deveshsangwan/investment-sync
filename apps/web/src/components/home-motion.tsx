"use client";

import { useEffect, useRef, useState } from "react";

/** Start a visual sequence once, when its section enters the viewport. */
export function HomeMotion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = container.current;

    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;

        setIsVisible(true);
        observer.disconnect();
      },
      { threshold: 0.15 },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={container}
      className={className}
      data-home-motion={isVisible ? "visible" : "pending"}
    >
      {children}
    </div>
  );
}
