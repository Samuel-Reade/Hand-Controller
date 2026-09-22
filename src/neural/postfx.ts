// The light pipeline (lighting pass, 2026-09-21). The scene draws into a
// half-float target, so overlapping additive glow ACCUMULATES past 1.0
// instead of clipping to flat white (the brain smear, the white-disc hubs at
// 3x); a bloom pass spreads only what is hot; the output pass tone-maps and
// encodes to sRGB in one step, rolling the highlights off through the body
// colour; grain rides last, after tone mapping, in the darks only.
//
// Tone mapper: Neutral (Khronos PBR Neutral) - the identity below 0.8, so
// every P0 colour, the wash and the trails come out exactly as they did
// straight to the screen, and only the hot accumulations compress and
// desaturate toward white. AgX was tried first: it lifts and greys the wash
// (~17% on the blue channel) and re-renders every colour in the frame.
//
// Target: 4x multisampled. The trails are sub-pixel tubes; without MSAA in
// the target they rasterised as dotted, dim lines (a pixel only counted if
// its centre fell inside the tube) - the screen buffer always had it.
//
// Colour: every material still ends with `#include <colorspace_fragment>`.
// Inside a render target three makes that a no-op (working-space output),
// so nothing converts twice - the prototype's OETF-brightened star colours
// (PORT_LOG C2/C4) come out of the output pass exactly as they came out of
// the screen before.
//
// Draw calls: the passes' own quads would count against the §8 gate (scene
// ≤ 9), so a counting pass records the scene's calls right after the render
// pass; `sceneDrawCalls` is what __neuralInfo reports.

import { HalfFloatType, NeutralToneMapping, NoToneMapping, Vector2, WebGLRenderTarget } from 'three'
import type { Camera, Scene, WebGLRenderer } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Pass } from 'three/addons/postprocessing/Pass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { NCONF } from './config'

/** bloom mip chain size as a fraction of the frame (see setSize) */
const BLOOM_SCALE = 0.5

export interface LightPipeline {
  /** the scene's own draw calls last frame (the passes' quads excluded) */
  sceneDrawCalls: number
  render(delta: number): void
  setSize(width: number, height: number, pixelRatio: number): void
  dispose(): void
}

/** Reads the renderer's call count where it sits in the chain; draws nothing. */
class CountPass extends Pass {
  calls = 0
  constructor() {
    super()
    this.needsSwap = false
  }
  render(renderer: WebGLRenderer): void {
    this.calls = renderer.info.render.calls
  }
}

// Film grain after tone mapping: the same hash noise the in-scene plane
// used, now masked out of the highlights - grain lives in the shadows of a
// photograph, never on a light source.
const GRAIN_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float a = uAmount * (1.0 - smoothstep(0.15, 0.6, lum));
      gl_FragColor = vec4(mix(c.rgb, vec3(n), a), c.a);
    }
  `,
}

export function createLightPipeline(gl: WebGLRenderer, scene: Scene, camera: Camera): LightPipeline {
  // sized by setSize before the first frame; the composer clones it for its
  // second buffer (samples carry over)
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: NCONF.render.msaa })
  const composer = new EffectComposer(gl, target)
  const renderPass = new RenderPass(scene, camera)
  const count = new CountPass()
  // resolution is overwritten by setSize before the first frame
  const bloom = new UnrealBloomPass(
    new Vector2(1, 1),
    NCONF.render.bloomStrength,
    NCONF.render.bloomRadius,
    NCONF.render.bloomThreshold,
  )
  const output = new OutputPass()
  const grain = new ShaderPass(GRAIN_SHADER)
  composer.addPass(renderPass)
  composer.addPass(count)
  composer.addPass(bloom)
  composer.addPass(output)
  composer.addPass(grain)

  // Every pass is its own renderer.render(); count the frame ourselves.
  gl.info.autoReset = false

  const pipeline: LightPipeline = {
    sceneDrawCalls: 0,
    render(delta) {
      // R3F's `flat` puts NoToneMapping back on the renderer whenever the
      // Canvas re-renders; the output pass reads the renderer every frame,
      // so the mapping is asserted here, not in an effect.
      gl.toneMapping = NeutralToneMapping
      gl.toneMappingExposure = NCONF.render.exposure
      bloom.enabled = NCONF.render.bloomEnabled
      bloom.strength = NCONF.render.bloomStrength
      bloom.radius = NCONF.render.bloomRadius
      bloom.threshold = NCONF.render.bloomThreshold
      // a soft knee: a pulsing halo crossing the threshold eases in, never
      // pops (@types/three types the uniform table as {}; it is a plain map)
      const highPass = bloom.highPassUniforms as Record<string, { value: number }>
      highPass['smoothWidth'].value = Math.max(0.01, NCONF.render.bloomKnee)
      grain.enabled = NCONF.render.grainEnabled
      grain.uniforms['uAmount'].value = NCONF.render.grainAmount
      // sample count is read when three sets a target up; dispose forces that
      if (composer.renderTarget1.samples !== NCONF.render.msaa) {
        for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
          rt.samples = NCONF.render.msaa
          rt.dispose()
        }
      }
      gl.info.reset()
      composer.render(delta)
      pipeline.sceneDrawCalls = count.calls
    },
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
      // The bloom chain at half the frame: it is a blur, the difference is
      // invisible, and at retina scale its ten blur passes were the fill.
      bloom.setSize(Math.round((width * pixelRatio) * BLOOM_SCALE), Math.round((height * pixelRatio) * BLOOM_SCALE))
    },
    dispose() {
      gl.info.autoReset = true
      gl.toneMapping = NoToneMapping
      bloom.dispose()
      output.dispose()
      grain.dispose()
      composer.dispose()
    },
  }
  return pipeline
}
