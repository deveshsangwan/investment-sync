import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function Button({
  children,
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      {...props}
      style={{
        alignItems: "center",
        border: 0,
        borderRadius: 7,
        cursor: props.disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        fontWeight: 750,
        minHeight: 40,
        padding: "0 14px",
        ...(props.style ?? {}),
      }}
    >
      {children}
    </button>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #d9dee7",
        borderRadius: 8,
        padding: 18,
      }}
    >
      {children}
    </section>
  );
}
