// App logo = the ICFAI Founders Network wordmark (src/assets/icfai-founders.svg). The big
// "ICFAI" letters use currentColor, so they're tinted with the brand accent; the red bar
// and the reversed "FOUNDERS NETWORK" carry their own fixed colors. Size via className.
import LogoSvg from '../assets/icfai-founders.svg?react'

export default function Logo({ className = '' }) {
  return (
    <LogoSvg
      className={`text-accent ${className}`}
      role="img"
      aria-label="ICFAI Founders Network"
    />
  )
}
