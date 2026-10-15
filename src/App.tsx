import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './components/LanguageSwitcher'

function App() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
      <LanguageSwitcher />
    </div>
  )
}

export default App
