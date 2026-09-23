// Feature flags. Each is resolved once at module load, in this order:
//   1. the URL: ?feature=eye turns one on, ?feature=-eye turns it off
//      (comma-separate several: ?feature=eye,-other) - for demos on a build;
//   2. the build: VITE_FEATURE_EYE=1 / =0 in the environment at build time;
//   3. the default: on in dev, off in production builds.

export type FeatureName = 'eye'

/** The rule above, pure: `search` is location.search ('' outside a browser). */
export function resolveFlag(name: FeatureName, search: string, env: string | undefined, dev: boolean): boolean {
  const asked = new URLSearchParams(search)
    .getAll('feature')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
  if (asked.includes(name)) return true
  if (asked.includes(`-${name}`)) return false
  if (env === '1' || env === 'true') return true
  if (env === '0' || env === 'false') return false
  return dev
}

const search = typeof window !== 'undefined' ? window.location.search : ''

export const FLAGS: Record<FeatureName, boolean> = {
  /**
   * Eye control and voice commands, together (Sam 2026-09-22): the EYE
   * button, the gaze ring, eyes-closed select, re-centre, and the voice
   * words open / leave / centre. Off: the app is mouse, keyboard and hand
   * only - the face model never loads and the microphone is never asked for.
   */
  eye: resolveFlag('eye', search, import.meta.env.VITE_FEATURE_EYE, import.meta.env.DEV),
}
