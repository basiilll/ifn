// App logo = the ICFAI Founders Network lockup (monogram + wordmark + tagline).
// Two transparent PNG variants so it sits cleanly on any background:
//   - ifn-logo.png      dark text, for light mode
//   - ifn-logo-dark.png white/red text, for dark mode
// Swapped via Tailwind's `dark` class (darkMode: 'class'). Size with className (height).
import logoLight from '../assets/ifn-logo.png'
import logoDark from '../assets/ifn-logo-dark.png'

export default function Logo({ className = '' }) {
  return (
    <>
      <img src={logoLight} className={`${className} dark:hidden`} alt="ICFAI Founders Network" />
      <img src={logoDark} className={`hidden dark:block ${className}`} alt="ICFAI Founders Network" />
    </>
  )
}
