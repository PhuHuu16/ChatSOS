import { useEffect } from 'react'
import { LoadingScreen } from './components/LoadingScreen'
import { AppShell } from './components/layout/AppShell'
import { AuthProvider } from './features/auth/AuthProvider'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { useAuth } from './features/auth/useAuth'
import { getAuthRedirect } from './routing/authRedirect'
import { PATHS, navigate } from './routing/navigation'
import { usePathname } from './routing/usePathname'

// Điều hướng trang xác thực
function AuthRoutes() {
  const { status } = useAuth()
  const pathname = usePathname()
  const redirect = getAuthRedirect(status, pathname)

  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true })
  }, [redirect])

  if (status === 'loading' || redirect) return <LoadingScreen />
  if (pathname === PATHS.login) return <LoginPage />
  if (pathname === PATHS.register) return <RegisterPage />
  if (pathname === PATHS.forgotPassword) return <ForgotPasswordPage />
  return <AppShell />
}

// Ứng dụng chính
function App() {
  return (
    <AuthProvider>
      <AuthRoutes />
    </AuthProvider>
  )
}

export default App
