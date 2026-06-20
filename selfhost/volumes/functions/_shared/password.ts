// Strong random password: 16 chars from a class-diverse alphabet, guaranteed to include at
// least one lower, upper, digit and symbol. Uses crypto + rejection sampling (no modulo bias).
export function generatePassword(): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digit = '23456789'
  const symbol = '!@#$%^&*-_=+?'
  const all = lower + upper + digit + symbol
  const pick = (set: string) => set[randomInt(set.length)]
  const chars = [pick(lower), pick(upper), pick(digit), pick(symbol)]
  while (chars.length < 16) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  let n: number
  do { crypto.getRandomValues(buf); n = buf[0] } while (n >= limit)
  return n % max
}
