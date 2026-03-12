/**
 * @darkiron/renderer — mat4 utilities
 *
 * Thin wrappers around gl-matrix for WebGPU camera and transform operations.
 * All matrices are column-major Float32Array (matching WebGPU/WGSL conventions).
 *
 * Functions accept an `out` parameter to avoid per-frame allocations.
 * Use `create*` variants when you need a new allocation.
 */

import { mat4 as m4, vec3 } from "gl-matrix";

/** Create a new 4x4 identity matrix. */
export function createMat4(): Float32Array {
  const out = new Float32Array(16);
  m4.identity(out);
  return out;
}

/** Set `out` to identity. Returns `out`. */
export function mat4Identity(out: Float32Array): Float32Array {
  return m4.identity(out) as Float32Array;
}

/** Multiply two 4x4 matrices: out = a * b. Returns `out`. */
export function mat4Mul(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
  return m4.multiply(out, a, b) as Float32Array;
}

/**
 * Build a look-at view matrix into `out`. Returns `out`.
 */
export function lookAt(out: Float32Array, eye: number[], target: number[], up: number[]): Float32Array {
  return m4.lookAt(
    out,
    vec3.fromValues(eye[0] ?? 0, eye[1] ?? 0, eye[2] ?? 0),
    vec3.fromValues(target[0] ?? 0, target[1] ?? 0, target[2] ?? 0),
    vec3.fromValues(up[0] ?? 0, up[1] ?? 0, up[2] ?? 0),
  ) as Float32Array;
}

/**
 * Build a perspective projection matrix into `out`. Returns `out`.
 */
export function perspective(out: Float32Array, fovY: number, aspect: number, near: number, far: number): Float32Array {
  return m4.perspective(out, fovY, aspect, near, far) as Float32Array;
}

/**
 * Build a model matrix from TRS into `out`. Returns `out`.
 * Rotation order: X then Y then Z (Euler degrees).
 */
export function mat4FromTRS(out: Float32Array, position: number[], rotation: number[], scale: number[]): Float32Array {
  m4.identity(out);
  m4.translate(out, out, vec3.fromValues(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0));
  m4.rotateX(out, out, ((rotation[0] ?? 0) * Math.PI) / 180);
  m4.rotateY(out, out, ((rotation[1] ?? 0) * Math.PI) / 180);
  m4.rotateZ(out, out, ((rotation[2] ?? 0) * Math.PI) / 180);
  m4.scale(out, out, vec3.fromValues(scale[0] ?? 0, scale[1] ?? 0, scale[2] ?? 0));
  return out;
}

