/**
 * @darkiron/renderer — mat4 utilities
 *
 * Minimal 4x4 matrix math for WebGPU camera and transform operations.
 * Column-major layout matching WebGPU/WGSL conventions.
 *
 * Consider replacing with gl-matrix for production use if more
 * operations are needed (inverse, decompose, slerp, etc.).
 */

/** Create a 4x4 identity matrix. */
export function mat4Identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

/** Multiply two 4x4 matrices: result = a * b. */
export function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      result[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return result;
}

/**
 * Build a look-at view matrix.
 * @param eye    Camera position [x, y, z]
 * @param target Look-at target [x, y, z]
 * @param up     World up vector [x, y, z]
 */
export function lookAt(
  eye: number[],
  target: number[],
  up: number[]
): Float32Array {
  // Forward (z) = normalize(eye - target)
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  const zLen = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
  const z = [zx / zLen, zy / zLen, zz / zLen];

  // Right (x) = normalize(up × z)
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  const xLen = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
  const x = [xx / xLen, xy / xLen, xz / xLen];

  // Up (y) = z × x
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];

  // Column-major view matrix with translation
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

/**
 * Build a perspective projection matrix.
 * @param fovY   Vertical field of view in radians
 * @param aspect Aspect ratio (width / height)
 * @param near   Near clipping plane
 * @param far    Far clipping plane
 */
export function perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number
): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, far * near * nf, 0,
  ]);
}

/**
 * Build a model matrix from translation, rotation (Euler degrees), and scale.
 * Rotation order: X → Y → Z.
 */
export function mat4FromTRS(
  position: number[],
  rotation: number[],
  scale: number[]
): Float32Array {
  const rx = (rotation[0] * Math.PI) / 180;
  const ry = (rotation[1] * Math.PI) / 180;
  const rz = (rotation[2] * Math.PI) / 180;

  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // Combined rotation matrix elements
  const r00 = cy * cz;
  const r01 = cz * sx * sy - cx * sz;
  const r02 = cx * cz * sy + sx * sz;
  const r10 = cy * sz;
  const r11 = cx * cz + sx * sy * sz;
  const r12 = cx * sy * sz - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cx * cy;

  // Column-major with scale applied to rotation columns
  return new Float32Array([
    r00 * scale[0], r10 * scale[0], r20 * scale[0], 0,
    r01 * scale[1], r11 * scale[1], r21 * scale[1], 0,
    r02 * scale[2], r12 * scale[2], r22 * scale[2], 0,
    position[0], position[1], position[2], 1,
  ]);
}

