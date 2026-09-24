import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ApiError } from './lib/apiClient'

// Most pages handle a 409 conflict themselves and rethrow everything else,
// which used to end as a silent unhandled rejection - a Save/Ship/Receive
// button just did nothing on a 403/400/500. Surface the server's message for
// failed writes. (Failed page-load reads stay in the console; 401 is handled
// in apiClient by sending the user back to sign in.)
window.addEventListener('unhandledrejection', (event) => {
  const err = event.reason
  if (err instanceof ApiError && err.status !== 401 && err.method !== 'GET') {
    event.preventDefault()
    alert(err.status === 403 ? `You don't have permission to do that. (${err.message})` : err.message)
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
