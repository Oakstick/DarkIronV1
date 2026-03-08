import { useEffect, useRef, useState } from "react";
import { DarkIronRenderer, type MeshData } from "@darkiron/renderer";
import { createTransport, type DarkIronTransport } from "@darkiron/transport";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [msgCount, setMsgCount] = useState(0);

  useEffect(() => {
    let renderer: DarkIronRenderer | null = null;
    let transport: DarkIronTransport | null = null;
    let destroyed = false;

    async function init() {
      try {
        if (!canvasRef.current) return;
        renderer = new DarkIronRenderer({ canvas: canvasRef.current });
        const gpuReady = await renderer.initialize();
        if (!gpuReady) {
          setError("WebGPU not available.");
          setStatus("error");
          return;
        }

        console.log("[Editor] Connecting via DarkIronTransport...");
        transport = await createTransport("ws://localhost:9222");
        if (destroyed) { transport.disconnect(); return; }
        setStatus("connected");

        // Subscribe to scene events via the transport wrapper
        await transport.subscribe("scene.*.loaded", (_subject, payload) => {
          const data = payload as { meshes?: MeshData[] };
          if (data.meshes && renderer) {
            for (const mesh of data.meshes) {
              console.log("[Editor] Uploading:", mesh.name);
              renderer.uploadMesh(mesh);
              setMsgCount(renderer.meshCount);
            }
          }
        });

        // Render loop
        function frame() {
          if (destroyed) return;
          renderer?.render();
          requestAnimationFrame(frame);
        }
        frame();
      } catch (err) {
        if (destroyed) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Editor] Init failed:", msg);
        setError(msg);
        setStatus("error");
      }
    }

    init();
    return () => {
      destroyed = true;
      renderer?.destroy();
      transport?.disconnect().catch(() => {});
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 40, background: "#2d2d2d", display: "flex", alignItems: "center", padding: "0 16px", borderBottom: "1px solid #4a4a4a", gap: 12 }}>
        <span style={{ color: "#E31B23", fontWeight: 700, fontSize: 13, letterSpacing: 2 }}>DARKIRON</span>
        <span style={{ color: "#4a4a4a" }}>|</span>
        <span style={{ color: "#b8b8b8", fontSize: 12 }}>Editor v0.1.0</span>
        <div style={{ flex: 1 }} />
        {msgCount > 0 && <span style={{ color: "#22c55e", fontSize: 11 }}>Meshes: {msgCount}</span>}
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: status === "connected" ? "#22c55e" : status === "error" ? "#ef4444" : "#f59e0b" }} />
        <span style={{ color: "#b8b8b8", fontSize: 11 }}>
          {status === "connected" ? "NATS Connected" : status === "error" ? "Disconnected" : "Connecting..."}
        </span>
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <canvas ref={canvasRef} width={1280} height={720} style={{ width: "100%", height: "100%", display: "block" }} />
        {error && (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "rgba(0,0,0,0.8)", padding: "24px 32px", borderRadius: 8, border: "1px solid #E31B23", maxWidth: 400, textAlign: "center" }}>
            <div style={{ color: "#E31B23", fontWeight: 700, marginBottom: 8 }}>Error</div>
            <div style={{ color: "#b8b8b8", fontSize: 13 }}>{error}</div>
          </div>
        )}
        {status === "connected" && !error && msgCount === 0 && (
          <div style={{ position: "absolute", bottom: 16, left: 16, color: "#4a4a4a", fontSize: 11 }}>
            Waiting for scene data...
          </div>
        )}
      </div>
    </div>
  );
}
