import { useState } from 'react'

// Password input with a show/hide toggle. Blind entry of an 8+ char password is the
// main source of typo-lockouts; letting the user reveal what they typed is the cheapest
// prevention (and the toggle button is keyboard-reachable and announced to screen readers).
export default function PasswordInput({ id, value, onChange, placeholder, autoComplete, ariaInvalid, ariaDescribedby, ...rest }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        className="input pr-14"
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={onChange}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 grid place-items-center rounded-r-lg px-3 text-xs font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 focus-visible:text-accent"
        aria-pressed={show}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
