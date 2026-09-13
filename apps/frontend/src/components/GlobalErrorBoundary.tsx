'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { toast } from 'sonner';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.sendAlertToBackend(error.message, error.stack || errorInfo.componentStack || '');
  }

  private sendAlertToBackend(message: string, stack: string) {
    try {
      const payload = {
        message,
        stack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        os: this.getOS(),
        browser: this.getBrowser(),
        device: /Mobile|Android|iP(ad|hone)/.test(navigator.userAgent) ? 'Mobile' : 'Desktop'
      };

      // Ship the crash context to the backend without blocking the thread
      fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/alerts/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.error("Failed to send crash report", err));

    } catch (err) {
      console.error("Crash reporter itself failed", err);
    }
  }

  private getOS(): string {
    const ua = navigator.userAgent;
    if (ua.indexOf("Win") !== -1) return "Windows";
    if (ua.indexOf("Mac") !== -1) return "MacOS";
    if (ua.indexOf("Linux") !== -1) return "Linux";
    if (ua.indexOf("Android") !== -1) return "Android";
    if (ua.indexOf("like Mac") !== -1) return "iOS";
    return "Unknown OS";
  }

  private getBrowser(): string {
    const ua = navigator.userAgent;
    if (ua.indexOf("Firefox") > -1) return "Firefox";
    if (ua.indexOf("SamsungBrowser") > -1) return "Samsung Internet";
    if (ua.indexOf("Opera") > -1 || ua.indexOf("OPR") > -1) return "Opera";
    if (ua.indexOf("Trident") > -1) return "Internet Explorer";
    if (ua.indexOf("Edge") > -1) return "Edge";
    if (ua.indexOf("Chrome") > -1) return "Chrome";
    if (ua.indexOf("Safari") > -1) return "Safari";
    return "Unknown Browser";
  }

  public componentDidMount() {
    // Catch rogue unhandled promises (e.g. failed fetch requests that aren't caught)
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason;
      const message = error?.message || 'Unhandled Promise Rejection';
      const stack = error?.stack || JSON.stringify(error);
      this.sendAlertToBackend(message, stack);
    });

    // Catch rogue JS syntax/runtime errors outside of React
    window.addEventListener('error', (event) => {
      this.sendAlertToBackend(event.message, event.error?.stack || 'No stack trace');
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-red-100 dark:border-red-900/30">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Something went wrong</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              A critical error occurred in the application. The engineering team has been automatically notified.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
