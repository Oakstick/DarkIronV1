/**
 * @darkiron/shared-types
 *
 * Generated TypeScript types from FlatBuffers schemas.
 * DO NOT EDIT MANUALLY — run `task schemas` to regenerate.
 *
 * Placeholder until FlatBuffers codegen is configured.
 */

export interface SceneLoadedEvent {
  type: "SceneLoaded";
  session_id: string;
  meshes: MeshData[];
}

export interface TransformChangedEvent {
  type: "TransformChanged";
  session_id: string;
  prim_path: string;
  matrix: number[];
}

export interface MeshData {
  name: string;
  vertices: number[];
  indices: number[];
}

export interface UserPresence {
  user_id: string;
  display_name: string;
  camera_position: [number, number, number];
  camera_target: [number, number, number];
  selected_prims: string[];
  timestamp: number;
}
