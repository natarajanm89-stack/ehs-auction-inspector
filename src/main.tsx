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
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined))
}
