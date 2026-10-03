"use client";

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "@/components/portfolio-ui";

interface ConvexQueryBoundaryProps {
  children: ReactNode;
  title: string;
  description: string;
  fallbackClassName?: string;
  renderFallback?: (fallback: ReactNode, retry: () => void) => ReactNode;
}

interface ConvexQueryBoundaryState {
  attempt: number;
  error: Error | null;
}

export class ConvexQueryBoundary extends Component<
  ConvexQueryBoundaryProps,
  ConvexQueryBoundaryState
> {
  override state: ConvexQueryBoundaryState = { attempt: 0, error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Convex query failed", error, info.componentStack);
  }

  private retry = () => {
    this.setState(({ attempt }) => ({ attempt: attempt + 1, error: null }));
  };

  override render() {
    if (this.state.error) {
      const errorState = (
        <ErrorState
          title={this.props.title}
          description={this.props.description}
          onRetry={this.retry}
        />
      );
      const fallback = this.props.renderFallback
        ? this.props.renderFallback(errorState, this.retry)
        : errorState;
      return this.props.fallbackClassName ? (
        <div className={this.props.fallbackClassName}>{fallback}</div>
      ) : (
        fallback
      );
    }

    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
