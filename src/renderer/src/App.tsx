import { useEffect } from 'react'
import CalibrationView from './components/CalibrationView'
import ScopeWall from './components/ScopeWall'
import Sidebar from './components/Sidebar'
import { useStore } from './state/store'

function App(): React.JSX.Element {
  const mode = useStore((s) => s.mode)
  const setSnapshot = useStore((s) => s.setSnapshot)
  const setAtemStatus = useStore((s) => s.setAtemStatus)

  useEffect(() => {
    if (!window.api.capabilities.atemLink) return
    const offSnapshot = window.api.atem.onSnapshot(setSnapshot)
    const offStatus = window.api.atem.onStatus(setAtemStatus)
    window.api.atem.getSnapshot().then(setSnapshot)
    window.api.atem.getStatus().then(setAtemStatus)
    return () => {
      offSnapshot()
      offStatus()
    }
  }, [setSnapshot, setAtemStatus])

  return (
    <div className="app">
      <Sidebar />
      <main className="app__main">
        {mode === 'calibrate' ? <CalibrationView /> : <ScopeWall />}
      </main>
    </div>
  )
}

export default App
