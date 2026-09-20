import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from '../icons'

// A password field with a show/hide (eye) toggle. Drop-in for
// <input type="password">: every prop (value, onChange, minLength,
// autoComplete, ref...) goes straight through to the input.
export default function PasswordInput(props) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="password-field">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button" className="password-toggle" onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
      >
        {visible ? <EyeOffIcon width={18} height={18} /> : <EyeIcon width={18} height={18} />}
      </button>
    </span>
  )
}
