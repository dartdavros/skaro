import {
  Camera,
  CustomBlending,
  Mesh,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  Vector4,
  ZeroFactor,
} from 'three';

/** Convert actual transformed DOM bounds into bottom-up WebGL UV coordinates. */
export function planetBounds(planet, canvas) {
  return [
    (planet.left - canvas.left) / canvas.width,
    (canvas.top + canvas.height - planet.top - planet.height) / canvas.height,
    planet.width / canvas.width,
    planet.height / canvas.height,
  ];
}

/** Cut the existing planet silhouette out of the rear part of the flight only. */
export function createPlanetOcclusion(image, canvas, textureUrl) {
  // file:// DOM images cannot be uploaded to WebGL; the site bundles identical PNG bytes.
  const maskImage = textureUrl ? new Image() : image;
  const texture = new Texture(maskImage);
  function loaded() {
    texture.needsUpdate = true;
  }
  maskImage.addEventListener('load', loaded);
  if (textureUrl) maskImage.src = textureUrl;
  if (maskImage.complete && maskImage.naturalWidth) loaded();
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    uniforms: { planet: { value: texture }, bounds: { value: new Vector4() } },
    vertexShader: `
      varying vec2 screenUV;
      void main() {
        screenUV = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D planet;
      uniform vec4 bounds;
      varying vec2 screenUV;
      void main() {
        vec2 uv = (screenUV - bounds.xy) / bounds.zw;
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
        // The solid disk is almost opaque; ignore its faint atmospheric glow.
        float coverage = smoothstep(0.72, 0.96, texture2D(planet, uv).a);
        gl_FragColor = vec4(0.0, 0.0, 0.0, coverage);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: CustomBlending,
    blendSrc: ZeroFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new Camera();
  return {
    render(renderer, behindPlanet) {
      if (!behindPlanet) return;
      if (!maskImage.complete || !maskImage.naturalWidth) {
        renderer.clear();
        return;
      }
      const canvasRect = canvas.getBoundingClientRect();
      if (!canvasRect.width || !canvasRect.height) return;
      material.uniforms.bounds.value.fromArray(
        planetBounds(image.getBoundingClientRect(), canvasRect),
      );
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
    },
    dispose() {
      maskImage.removeEventListener('load', loaded);
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
