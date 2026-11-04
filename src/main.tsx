import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import './i18n'
import './lib/theme'
import { ConfigErrorScreen } from './components/ConfigErrorScreen'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SupabaseConfigError, validateSupabaseConfig } from './lib/supabaseConfig'

const root = createRoot(document.getElementById('root')!)

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
