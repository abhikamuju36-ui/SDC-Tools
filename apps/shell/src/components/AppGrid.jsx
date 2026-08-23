import AppCard from './AppCard'

export default function AppGrid({ apps, lastOpened, onOpen, onRetry, onShowLogs, onTriggerUpdate, viewMode = 'grid' }) {
  return (
    <div className={`app-grid${viewMode === 'list' ? ' is-list' : ''}`} role="list">
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
