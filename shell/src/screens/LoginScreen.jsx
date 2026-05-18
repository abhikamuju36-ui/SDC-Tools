import { useState } from 'react'
import sdcLogo from '../assets/sdc-logo.png'

function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
      <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
      <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
  )
}

export default function LoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const api = window.shellAPI ?? { authLogin: async () => ({ success: false, error: 'API not available' }) }

  const handleSignIn = async () => {
    setLoading(true)
    setError('')
    const result = await api.authLogin()
    if (result.success) {
      onLogin(result.user)
    } else {
      setError(result.error || 'Sign-in failed.')
    }
    setLoading(false)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <img src={sdcLogo} alt="Steven Douglas Corp." style={{ height: 96, width: 'auto', mixBlendMode: 'screen' }} />
        </div>

        <p className="login-tagline">Engineering Excellence. Trusted Partnerships.</p>

        <div className="login-divider" />

        <p className="login-prompt">Sign in with your SDC Microsoft account to continue.</p>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button
          className="btn-ms-signin"
          onClick={handleSignIn}
          disabled={loading}
        >
          <MicrosoftIcon />
          {loading ? 'Opening sign-in…' : 'Sign in with Microsoft'}
        </button>

        <p className="login-hint">
          Access restricted to <strong>@sdcautomation.com</strong> accounts.
        </p>
      </div>

      <div className="login-footer">
        SDC Tools · Internal Engineering Platform
      </div>
    </div>
  )
}
