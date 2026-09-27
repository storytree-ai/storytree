import { DoubleSide, Mesh, Quaternion, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { SHIPPED_ELEVATION_DEG } from '../camera-framing.js';
import { landHeightRange } from '../land-relief.js';
import { SHORE_DIP } from '../shore-fall.js';
import { LIGHT_DIRECTION } from '../shade-ladder.js';

/** Lane A supplies these directions and the fixed globe radius, in ground units. */
export interface PlanetSpot { readonly x: number; readonly y: number; readonly z: number }

const UP = new Vector3(0, 1, 0);
// A tangent shell at y=0 would cut through negative relief. Retain the engine's existing skirt.
export const PLATE_CLEARANCE = Math.max(landHeightRange(), SHORE_DIP) + 0.1;
const flatCamera = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -SHIPPED_ELEVATION_DEG * Math.PI / 180);
const sunInView = new Vector3(LIGHT_DIRECTION.x, LIGHT_DIRECTION.y, LIGHT_DIRECTION.z)
  .normalize().applyQuaternion(flatCamera.invert());

/** A rigid plate: local +y points out of the sphere, with no bend or change to its geometry. */
export function plateTransform(spot: PlanetSpot, radius: number) {
  const normal = new Vector3(spot.x, spot.y, spot.z).normalize();
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(normal.lengthSq()) || normal.lengthSq() === 0) {
    throw new Error('A planet plate needs a positive globe radius and a finite, nonzero spot.');
  }
  return {
    position: normal.clone().multiplyScalar(radius + PLATE_CLEARANCE).toArray(),
    quaternion: new Quaternion().setFromUnitVectors(UP, normal),
  };
}

/** L1: the flat forest's lamp fixed over the viewer's shoulder. Ground and kit share this sun.
 * Baked shadow atlases and skirt colours remain the approved flat island's, as ADR-0646 allows. */
export function lightForCamera(camera: Quaternion, target = new Vector3()): Vector3 {
  return target.copy(sunInView).applyQuaternion(camera);
}

/** The actual surface mounted by the globe. It admits far land and the future core through it,
 * while retaining ray hits for the page's existing near-side selection and label rule. */
export function createPlanetSurface(radius: number) {
  const surface = new Mesh(new SphereGeometry(radius, 96, 64), new ShaderMaterial({
    transparent: true,
    depthWrite: false, side: DoubleSide, forceSinglePass: false,
    uniforms: {
      opacity: { value: 0.012 },
      // L1 is fixed in view space; orbiting updates the normal, not this lamp.
      sunInView: { value: sunInView.clone() },
    },
    vertexShader: `
      varying vec3 shellNormal;
      void main() {
        shellNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float opacity;
      uniform vec3 sunInView;
      varying vec3 shellNormal;
      void main() {
        // The globe's orthographic camera has parallel view rays along +z.
        vec3 normal = normalize(shellNormal);
        float rim = pow(1.0 - abs(normal.z), 4.0);
        vec3 halfLight = normalize(sunInView + vec3(0.0, 0.0, 1.0));
        // Only the near face reflects the lamp: no second highlight through the ball.
        float highlight = gl_FrontFacing ? pow(max(dot(normal, halfLight), 0.0), 96.0) : 0.0;
        float alpha = opacity + 0.5 * rim + 0.16 * highlight;
        vec3 colour = mix(vec3(0.72, 0.75, 0.78), vec3(1.0, 0.98, 0.93), highlight);
        gl_FragColor = vec4(colour, alpha);
      }
    `,
  }));
  surface.name = 'planet:shell';
  return surface;
}
