import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Catches a render error in the page below it (C-01). Without this a thrown
// error unmounted the whole app and left a blank window; now the shell
// stays and the page offers a reload. Keyed by route in Layout, so moving
// to another page clears it.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page failed to render:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="access-denied error-boundary" role="alert">
          <h1>This page hit a problem</h1>
          <p className="muted">{this.state.error.message || "Something went wrong while drawing this page."}</p>
          <div className="button-row">
            <button type="button" className="primary-btn" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button type="button" className="secondary-btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
