/**
 * @darkiron/transport
 *
 * NATS WebSocket client for browser-side communication.
 * All browser <-> runtime messaging MUST go through this package.
 *
 * Current implementation: NATS with JSON payloads.
 * Future: NATS with FlatBuffers payloads.
 */

import { connect, type NatsConnection, type Subscription, type Msg, StringCodec } from "nats.ws";

const sc = StringCodec();

export interface TransportConfig {
  /** NATS WebSocket URL (default: ws://localhost:9222) */
  url: string;
}

export type MessageHandler = (subject: string, payload: unknown) => void;

/**
 * DarkIron browser transport client.
 *
 * Wraps the NATS WebSocket connection and provides a typed interface
 * for publishing/subscribing to engine events.
 */
export class DarkIronTransport {
  private connection: NatsConnection | null = null;
  private subscriptions: Subscription[] = [];

  constructor(private config: TransportConfig) {}

  /**
   * Connect to the NATS server via WebSocket.
   */
  async connect(): Promise<void> {
    console.log(`[DarkIron Transport] Connecting to ${this.config.url}...`);
    this.connection = await connect({ servers: this.config.url });
    console.log("[DarkIron Transport] Connected");
  }

  /**
   * Publish a message to a NATS subject.
   */
  async publish(subject: string, payload: unknown): Promise<void> {
    if (!this.connection) {
      throw new Error("Not connected to NATS");
    }
    const data = sc.encode(JSON.stringify(payload));
    this.connection.publish(subject, data);
  }

  /**
   * Subscribe to a NATS subject pattern and invoke handler for each message.
   *
   * Supports wildcards:
   * - `*` matches a single token: `scene.*.loaded`
   * - `>` matches one or more tokens: `scene.abc123.edit.>`
   */
  async subscribe(subject: string, handler: MessageHandler): Promise<void> {
    if (!this.connection) {
      throw new Error("Not connected to NATS");
    }

    const sub = this.connection.subscribe(subject);
    this.subscriptions.push(sub);

    // Process messages asynchronously
    (async () => {
      for await (const msg of sub) {
        try {
          const payload: unknown = JSON.parse(sc.decode(msg.data));
          handler(msg.subject, payload);
        } catch (err) {
          console.error(`[DarkIron Transport] Failed to parse message on ${msg.subject}:`, err);
        }
      }
    })();
  }

  /**
   * Disconnect and clean up all subscriptions.
   */
  async disconnect(): Promise<void> {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    if (this.connection) {
      await this.connection.drain();
      this.connection = null;
    }
    console.log("[DarkIron Transport] Disconnected");
  }
}

/**
 * Create and connect a transport instance with default config.
 */
export async function createTransport(
  url = "ws://localhost:9222"
): Promise<DarkIronTransport> {
  const transport = new DarkIronTransport({ url });
  await transport.connect();
  return transport;
}
