// Cloudflare Turnstile wiring. The sitekey is PUBLIC (ships in the bundle); the matching
// secret lives server-side — GoTrue for login, the register-request edge fn for sign-up.
//
// Kill switch = presence of the sitekey. Unset -> the widget never renders and no token is
// sent. This MUST stay in lockstep with the server: if the sitekey is set here you also have
// to enable captcha server-side (GoTrue GOTRUE_SECURITY_CAPTCHA_ENABLED + a TURNSTILE_SECRET
// for the edge fn), and vice-versa. Half-on breaks login (GoTrue 400s a missing token).
//
// Local dev: use Cloudflare's dummy always-pass sitekey 1x00000000000000000000AA so the
// challenge auto-solves offline and tests never hit the network.
export const CAPTCHA_SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY || ''
export const captchaEnabled = CAPTCHA_SITEKEY.length > 0
