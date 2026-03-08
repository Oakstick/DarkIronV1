/**
 * @darkiron/transport
 *
 * NATS WebSocket client with FlatBuffers decoding.
 * All browser <-> runtime messaging MUST go through this package.
 */

import { connect, type NatsConnection, type Subscription } from "nats.ws";
import * as flatbuffers from "flatbuffers";
import { SceneEvent } from "../../../schemas/generated/ts/darkiron/schema/scene-event";
import { SceneLoaded } from "../../../schemas/generated/ts/darkiron/schema/scene-loaded";
import { SceneEventPayload } from "../../../schemas/generated/ts/darkiron/schema/scene-event-payload";

export interface TransportConfig {
  url: string;
}

export type MessageHandler = (subject: string, payload: unknown) => void;

/** Convert a FlatBuffers SceneLoaded message to a plain JS object */
function decodeFlatBuffers(data: Uint8Array): unknown | null {
  try {
    const buf = new flatbuffers.ByteBuffer(data);
    const event = SceneEvent.getRootAsSceneEvent(buf);

    if (event.payloadType() === SceneEventPayload.SceneLoaded) {
      const scene = event.payload(new SceneLoaded()) as SceneLoaded;
      const meshes: Array<{name: string; vertices: number[]; indices: number[]}> = [];

      for (let i = 0; i < scene.meshesLength(); i++) {
        const mesh = scene.meshes(i);
        if (!mesh) continue;

        // Get typed arrays from FlatBuffers (zero-copy when possible)
        const verticesArr = mesh.verticesArray();
        const indicesArr = mesh.indicesArray();

        meshes.push({
          name: mesh.name() || `mesh_${i}`,
          vertices: verticesArr ? Array.from(verticesArr) : [],
          indices: indicesArr ? Array.from(indicesArr) : [],
        });
      }

      return { meshes };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * DarkIron browser transport client.
 * Supports both FlatBuffers (binary) and JSON payloads.
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
          let payload = decodeFlatBuffers(raw);
          if (!payload) {
            // Fallback: try JSON (for Python loader backward compat)
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

