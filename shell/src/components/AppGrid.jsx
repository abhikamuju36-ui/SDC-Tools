import AppCard from './AppCard'

export default function AppGrid({ apps, lastOpened, onOpen, onRetry, onShowLogs, onTriggerUpdate }) {
  return (
    <div className="app-grid" role="list">
      {apps.map(app => (
        <AppCard
          key={app.id}
          app={app}
          lastOpened={lastOpened}
          onOpen={onOpen}
          onRetry={onRetry}
          onShowLogs={onShowLogs}
          onTriggerUpdate={onTriggerUpdate}
        />
      ))}
    </div>
  )
}
