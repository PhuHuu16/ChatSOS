import { Component, type ReactNode } from 'react'
import { ConfigErrorScreen } from './ConfigErrorScreen'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  crashed: boolean
}

// Bắt lỗi giao diện
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true }
  }

  render() {
    return this.state.crashed ? <ConfigErrorScreen reason="crash" /> : this.props.children
  }
}
