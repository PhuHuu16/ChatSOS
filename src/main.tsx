import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import { ConfigErrorScreen } from './components/ConfigErrorScreen'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SupabaseConfigError, validateSupabaseConfig } from './lib/supabaseConfig'

const root = createRoot(document.getElementById('root')!)

// The same check src/lib/supabase.ts runs when it loads. Only a SupabaseConfigError means
// "misconfigured"; any other exception is a bug and is rethrown, not shown as a config problem.
// The error message is never displayed or logged.
function hasValidSupabaseConfig(): boolean {
  try {
    validateSupabaseConfig(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    )
    return true
  } catch (error) {
    if (error instanceof SupabaseConfigError) return false
    throw error
  }
}

if (!hasValidSupabaseConfig()) {
  root.render(
    <StrictMode>
      <ConfigErrorScreen reason="config" />
    </StrictMode>,
  )
} else {
  // App, and everything that may import src/lib/supabase.ts, is loaded only after the
  // check. The rejection handler covers failures to fetch or evaluate the app modules only.
  void import('./App.tsx').then(
    ({ default: App }) => {
      root.render(
        <StrictMode>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </StrictMode>,
      )
    },
    () => {
      root.render(
        <StrictMode>
          <ConfigErrorScreen reason="load" />
        </StrictMode>,
      )
    },
  )
}
