/**
 * @darkiron/transport
 *
 * NATS WebSocket client with FlatBuffers decoding.
 * All browser <-> runtime messaging MUST go through this package.
 * Handles ALL SceneEventPayload types defined in scene.fbs.
 */

import * as flatbuffers from "flatbuffers";
import { type NatsConnection, type Subscription, connect } from "nats.ws";
import { AssetCooked } from "../../../schemas/generated/ts/darkiron/schema/asset-cooked";
import { MaterialData } from "../../../schemas/generated/ts/darkiron/schema/material-data";
import { PrimCreated } from "../../../schemas/generated/ts/darkiron/schema/prim-created";
import { PrimDeleted } from "../../../schemas/generated/ts/darkiron/schema/prim-deleted";
import { SceneEvent } from "../../../schemas/generated/ts/darkiron/schema/scene-event";
import { SceneEventPayload } from "../../../schemas/generated/ts/darkiron/schema/scene-event-payload";
import { SceneLoaded } from "../../../schemas/generated/ts/darkiron/schema/scene-loaded";
import { TransformChanged } from "../../../schemas/generated/ts/darkiron/schema/transform-changed";

// ─── Typed event interfaces ─────────────────────────────────

export interface MaterialInfo {
  name: string | null;
  baseColorPath: string | null;
  normalPath: string | null;
  roughnessPath: string | null;
  metallicPath: string | null;
}

export interface SceneLoadedEvent {
  type: "SceneLoaded";
  sessionId: string;
  meshes: Array<{
    name: string;
    vertices: number[];
    indices: number[];
    uvs: number[];
    baseColorTex: Uint8Array | null;
    material: MaterialInfo | null;
  }>;
}

export interface TransformChangedEvent {
  type: "TransformChanged";
  sessionId: string;
  primPath: string;
  matrix: number[] | null;
}

export interface PrimCreatedEvent {
  type: "PrimCreated";
  sessionId: string;
  primPath: string;
  primType: string;
  parentPath: string;
}

export interface PrimDeletedEvent {
  type: "PrimDeleted";
  sessionId: string;
  primPath: string;
}

export interface AssetCookedEvent {
  type: "AssetCooked";
  sessionId: string;
  assetName: string;
  assetHash: string;
  sizeBytes: number;
}

export type DarkIronEvent =
  | SceneLoadedEvent
  | TransformChangedEvent
  | PrimCreatedEvent
  | PrimDeletedEvent
  | AssetCookedEvent;

// ─── FlatBuffers decoder ────────────────────────────────────

export interface TransportConfig {
  url: string;
}

export type MessageHandler = (subject: string, payload: DarkIronEvent | unknown) => void;

/** Decode a SceneLoaded payload */
function decodeSceneLoaded(event: SceneEvent): SceneLoadedEvent {
  const scene = event.payload(new SceneLoaded()) as SceneLoaded;
  const meshes: SceneLoadedEvent["meshes"] = [];

  for (let i = 0; i < scene.meshesLength(); i++) {
    const mesh = scene.meshes(i);
    if (!mesh) continue;
    const verticesArr = mesh.verticesArray();
    const indicesArr = mesh.indicesArray();
    const uvsArr = mesh.uvsArray();
    const texArr = mesh.baseColorTexArray();
    const matData = mesh.material(new MaterialData());
    const material: MaterialInfo | null = matData
      ? {
          name: matData.name() ?? null,
          baseColorPath: matData.baseColorPath() ?? null,
          normalPath: matData.normalPath() ?? null,
          roughnessPath: matData.roughnessPath() ?? null,
          metallicPath: matData.metallicPath() ?? null,
        }
      : null;
    meshes.push({
      name: mesh.name() || `mesh_${i}`,
      vertices: verticesArr ? Array.from(verticesArr) : [],
      indices: indicesArr ? Array.from(indicesArr) : [],
      uvs: uvsArr ? Array.from(uvsArr) : [],
      baseColorTex: texArr ?? null,
      material,
    });
  }

  return {
    type: "SceneLoaded",
    sessionId: scene.sessionId() || "",
    meshes,
  };
}

/** Decode a TransformChanged payload */
function decodeTransformChanged(event: SceneEvent): TransformChangedEvent {
  const tc = event.payload(new TransformChanged()) as TransformChanged;
  const transform = tc.transform();
  let matrix: number[] | null = null;
  if (transform) {
    const arr = transform.matrixArray();
    matrix = arr ? Array.from(arr) : null;
  }
  return {
    type: "TransformChanged",
    sessionId: tc.sessionId() || "",
    primPath: tc.primPath() || "",
    matrix,
  };
}

/** Decode a PrimCreated payload */
function decodePrimCreated(event: SceneEvent): PrimCreatedEvent {
  const pc = event.payload(new PrimCreated()) as PrimCreated;
  return {
    type: "PrimCreated",
    sessionId: pc.sessionId() || "",
    primPath: pc.primPath() || "",
    primType: pc.primType() || "",
    parentPath: pc.parentPath() || "",
  };
}

/** Decode a PrimDeleted payload */
function decodePrimDeleted(event: SceneEvent): PrimDeletedEvent {
  const pd = event.payload(new PrimDeleted()) as PrimDeleted;
  return {
    type: "PrimDeleted",
    sessionId: pd.sessionId() || "",
    primPath: pd.primPath() || "",
  };
}

/** Decode an AssetCooked payload */
function decodeAssetCooked(event: SceneEvent): AssetCookedEvent {
  const ac = event.payload(new AssetCooked()) as AssetCooked;
  return {
    type: "AssetCooked",
    sessionId: ac.sessionId() || "",
    assetName: ac.assetName() || "",
    assetHash: ac.assetHash() || "",
    sizeBytes: Number(ac.sizeBytes()),
  };
}

/** Decode any FlatBuffers SceneEvent into a typed DarkIronEvent */
function decodeFlatBuffers(data: Uint8Array): DarkIronEvent | null {
  try {
    const buf = new flatbuffers.ByteBuffer(data);
    const event = SceneEvent.getRootAsSceneEvent(buf);
    const payloadType = event.payloadType();

    switch (payloadType) {
      case SceneEventPayload.SceneLoaded:
        return decodeSceneLoaded(event);
      case SceneEventPayload.TransformChanged:
        return decodeTransformChanged(event);
      case SceneEventPayload.PrimCreated:
        return decodePrimCreated(event);
      case SceneEventPayload.PrimDeleted:
        return decodePrimDeleted(event);
      case SceneEventPayload.AssetCooked:
        return decodeAssetCooked(event);
      case SceneEventPayload.NONE:
        console.debug("[Transport] FlatBuffers: NONE payload type");
        return null;
      default:
        console.debug(`[Transport] FlatBuffers: unknown payload type ${payloadType}`);
        return null;
    }
  } catch (err) {
    console.debug(`[Transport] FlatBuffers decode error (${data.length} bytes):`, err);
    return null;
  }
}

// ─── Transport client ───────────────────────────────────────

/**
 * DarkIron browser transport client.
 * Decodes FlatBuffers for all SceneEventPayload types, with JSON fallback.
 */
export class DarkIronTransport {
  private connection: NatsConnection | null = null;
  private subscriptions: Subscription[] = [];

  constructor(private config: TransportConfig) {}

  async connect(): Promise<void> {
    console.log(`[DarkIron Transport] Connecting to ${this.config.url}...`);
    this.connection = await connect({ servers: this.config.url });
    console.log("[DarkIron Transport] Connected");
  }

  async publish(subject: string, payload: Uint8Array): Promise<void> {
    if (!this.connection) throw new Error("Not connected to NATS");
    this.connection.publish(subject, payload);
  }

  async subscribe(subject: string, handler: MessageHandler): Promise<void> {
    if (!this.connection) throw new Error("Not connected to NATS");
    const sub = this.connection.subscribe(subject);
    this.subscriptions.push(sub);

    (async () => {
      for await (const msg of sub) {
        try {
          const raw = msg.data;
          // Try FlatBuffers first, fall back to JSON
          let payload: DarkIronEvent | unknown = decodeFlatBuffers(raw);
          if (!payload) {
            try {
              const text = new TextDecoder().decode(raw);
              payload = JSON.parse(text);
            } catch {
              console.warn(`[Transport] Failed to decode message on ${msg.subject}`);
              continue;
            }
          }
          handler(msg.subject, payload);
        } catch (err) {
          console.error(`[Transport] Error processing ${msg.subject}:`, err);
        }
      }
    })();
  }

  async disconnect(): Promise<void> {
    for (const sub of this.subscriptions) sub.unsubscribe();
    this.subscriptions = [];
    if (this.connection) {
      await this.connection.drain();
      this.connection = null;
    }
    console.log("[DarkIron Transport] Disconnected");
  }
}

export async function createTransport(url = "ws://localhost:9222"): Promise<DarkIronTransport> {
  const transport = new DarkIronTransport({ url });
  await transport.connect();
  return transport;
}
