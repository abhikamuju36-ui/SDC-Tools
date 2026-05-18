import AppCard from './AppCard'

export default function AppGrid({ apps, onOpen, onRetry, onShowLogs }) {
  return (
    <div className="app-grid" role="list">
      {apps.map(app => (
        <AppCard
          key={app.id}
          app={app}
          onOpen={onOpen}
          onRetry={onRetry}
          onShowLogs={onShowLogs}
        />
      ))}
    </div>
  )
}
