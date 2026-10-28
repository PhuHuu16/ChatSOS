import { Component, type ReactNode } from 'react'
import { ConfigErrorScreen } from './ConfigErrorScreen'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  crashed: boolean
}

// Shows an error screen with a reload button instead of a blank page when rendering
// throws. React already reports the error in the console; no details are shown to users.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true }
  }

  render() {
    return this.state.crashed ? <ConfigErrorScreen reason="crash" /> : this.props.children
  }
}
