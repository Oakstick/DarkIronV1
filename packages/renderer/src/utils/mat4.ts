/**
 * @darkiron/renderer — mat4 utilities
 *
 * Thin wrappers around gl-matrix for WebGPU camera and transform operations.
 * All matrices are column-major Float32Array (matching WebGPU/WGSL conventions).
 */

import { mat4 as m4, vec3 } from "gl-matrix";

/** Create a 4x4 identity matrix. */
export function mat4Identity(): Float32Array {
  const out = new Float32Array(16);
  m4.identity(out);
  return out;
}

/** Multiply two 4x4 matrices: result = a * b. */
export function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  m4.multiply(out, a, b);
  return out;
}

/**
 * Build a look-at view matrix.
 * @param eye    Camera position [x, y, z]
 * @param target Look-at target [x, y, z]
 * @param up     World up vector [x, y, z]
 */
export function lookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const out = new Float32Array(16);
  m4.lookAt(
    out,
    vec3.fromValues(eye[0], eye[1], eye[2]),
    vec3.fromValues(target[0], target[1], target[2]),
    vec3.fromValues(up[0], up[1], up[2]),
  );
  return out;
}

/**
 * Build a perspective projection matrix.
 * @param fovY   Vertical field of view in radians
 * @param aspect Aspect ratio (width / height)
 * @param near   Near clipping plane
 * @param far    Far clipping plane
 */
export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const out = new Float32Array(16);
  m4.perspective(out, fovY, aspect, near, far);
  return out;
}

/**
 * Build a model matrix from translation, rotation (Euler degrees), and scale.
 * Rotation order: X then Y then Z.
 */
export function mat4FromTRS(position: number[], rotation: number[], scale: number[]): Float32Array {
  const out = new Float32Array(16);
  m4.identity(out);

  // Translate
  m4.translate(out, out, vec3.fromValues(position[0], position[1], position[2]));

  // Rotate X, Y, Z (degrees to radians)
  m4.rotateX(out, out, (rotation[0] * Math.PI) / 180);
  m4.rotateY(out, out, (rotation[1] * Math.PI) / 180);
  m4.rotateZ(out, out, (rotation[2] * Math.PI) / 180);

  // Scale
  m4.scale(out, out, vec3.fromValues(scale[0], scale[1], scale[2]));

  return out;
}

