import { CanvasTexture, PointLight, Sprite, SpriteMaterial } from 'three';

/** The original bulb mesh and material stay intact; only their emission changes. */
export function createLamp(model) {
  const bulb = model.getObjectByName('Lamp_Glass');
  if (!bulb?.isMesh || Array.isArray(bulb.material)) {
    throw new Error('Expected the separate Lamp_Glass mesh in TARDIS_2005.');
  }
  const originalIntensity = bulb.material.emissiveIntensity;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(218, 243, 255, 0.8)');
  gradient.addColorStop(0.18, 'rgba(165, 220, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(130, 200, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false });
  const glow = new Sprite(material);
  glow.position.set(0, 1.36, 0);
  glow.scale.setScalar(0.48);
  const light = new PointLight(0xb8e5ff, 0, 2.2, 2);
  light.position.copy(glow.position);
  model.add(glow, light);
  return {
    update(pulse) {
      bulb.material.emissiveIntensity = 0.25 + 4.5 * pulse;
      material.opacity = 0.7 * pulse;
      light.intensity = 1.8 * pulse;
    },
    dispose() {
      bulb.material.emissiveIntensity = originalIntensity;
      glow.removeFromParent();
      light.removeFromParent();
      texture.dispose();
      material.dispose();
    },
  };
}
