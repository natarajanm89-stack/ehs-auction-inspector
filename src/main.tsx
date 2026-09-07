import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Gate } from './components/Gate'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gate>{profile => <App profile={profile} />}</Gate>
  </React.StrictMode>
)

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => undefined)
    })
  } else {
    // A worker installed by an earlier dev session would keep serving a stale
    // bundle and make edits appear to have no effect.
    navigator.serviceWorker.getRegistrations()
      .then(rs => rs.forEach(r => r.unregister()))
      .catch(() => undefined)
  }
}
