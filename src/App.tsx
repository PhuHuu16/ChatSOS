import { useEffect } from 'react'
import { LoadingScreen } from './components/LoadingScreen'
import { AppShell } from './components/layout/AppShell'
import { AuthProvider } from './features/auth/AuthProvider'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { useAuth } from './features/auth/useAuth'
import { getAuthRedirect } from './routing/authRedirect'
import { PATHS, navigate } from './routing/navigation'
import { usePathname } from './routing/usePathname'

function AuthRoutes() {
  const { status } = useAuth()
  const pathname = usePathname()
  const redirect = getAuthRedirect(status, pathname)

  // Navigating is a side effect, so it runs after render. replace: Back must not return
  // to a page that would immediately redirect again. Running twice (StrictMode) replaces
  // the same entry with the same path, which changes nothing.
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true })
  }, [redirect])

  if (status === 'loading' || redirect) return <LoadingScreen />
  if (pathname === PATHS.login) return <LoginPage />
  if (pathname === PATHS.register) return <RegisterPage />
  return <AppShell />
}

function App() {
  return (
    <AuthProvider>
      <AuthRoutes />
    </AuthProvider>
  )
}

export default App
