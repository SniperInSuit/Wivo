import type { ReactNode } from 'react'
import { useAuth } from '../../context/AuthContext'
import { LoginPage } from './LoginPage'
import { ClinicSetupWizard } from './ClinicSetupWizard'
import { Loader2 } from 'lucide-react'
import wivoLogo from '../../assets/Wivo Logo.png'

interface AuthGuardProps {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { status, needsClinicSetup } = useAuth()

  if (status === 'loading') {
    return (
      <div className="fixed inset-0 bg-nav-bg flex flex-col items-center justify-center gap-4">
        <img src={wivoLogo} alt="Wivo" className="w-16 h-16 rounded-xl" />
        <Loader2 size={24} className="text-accent animate-spin" />
      </div>
    )
  }

  if (status === 'none') {
    return <LoginPage />
  }

  if (needsClinicSetup) {
    return <ClinicSetupWizard />
  }

  return <>{children}</>
}
