import { DarkIronRenderer, type MeshData } from "@darkiron/renderer";
import { type DarkIronTransport, type DarkIronEvent, createTransport } from "@darkiron/transport";
import { useCallback, useEffect, useRef, useState } from "react";
import { MenuBar, type MenuDefinition } from "./components/MenuBar";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DarkIronRenderer | null>(null);
  const transportRef = useRef<DarkIronTransport | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [msgCount, setMsgCount] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [sceneName, setSceneName] = useState("Untitled");

  // ─── Menu actions ──────────────────────────────────────────────

  const handleNewScene = useCallback(() => {
    rendererRef.current?.clearMeshes();
    setMsgCount(0);
    setSceneName("Untitled");
    console.log("[Editor] New scene");
  }, []);

  const handleOpenFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setSceneName(file.name.replace(/\.[^.]+$/, ""));
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.meshes && rendererRef.current) {
          rendererRef.current.clearMeshes();
          for (const mesh of data.meshes) {
            await rendererRef.current.uploadMesh(mesh);
          }
          setMsgCount(rendererRef.current.meshCount);
          console.log(`[Editor] Loaded ${data.meshes.length} meshes from ${file.name}`);
        }
      } catch (err) {
        console.error("[Editor] Failed to load file:", err);
        alert("Failed to load file. Only JSON scene files supported via File > Open.\nFor USD files, place them in assets/ and restart the runtime.");
      }
    };
    input.click();
  }, []);

  const handleExportScene = useCallback(() => {
    console.log("[Editor] Export scene (not yet implemented)");
  }, []);

  const handleUndo = useCallback(() => {
    console.log("[Editor] Undo (not yet implemented)");
  }, []);

  const handleRedo = useCallback(() => {
    console.log("[Editor] Redo (not yet implemented)");
  }, []);

  const handleResetCamera = useCallback(() => {
    console.log("[Editor] Reset camera (not yet implemented)");
  }, []);

  const handleToggleGrid = useCallback(() => {
    setShowGrid((v) => !v);
    console.log("[Editor] Toggle grid");
  }, []);

  const handleToggleWireframe = useCallback(() => {
    setShowWireframe((v) => !v);
    console.log("[Editor] Toggle wireframe");
  }, []);

  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  const handleAbout = useCallback(() => {
    alert(
      "DarkIron Engine v0.1.0\n\nA distributed game engine with WebGPU rendering,\nNATS event bus, and Rust runtime.\n\n© IO Interactive",
    );
  }, []);

  // ─── Menu definitions ─────────────────────────────────────────

  const menus: MenuDefinition[] = [
    {
      label: "File",
      items: [
        { label: "New Scene", shortcut: "Ctrl+N", action: handleNewScene },
        { label: "Open File...", shortcut: "Ctrl+O", action: handleOpenFile },
        "separator",
        { label: "Save", shortcut: "Ctrl+S", disabled: true },
        { label: "Save As...", shortcut: "Ctrl+Shift+S", disabled: true },
        "separator",
        { label: "Export Scene...", action: handleExportScene, disabled: true },
        { label: "Import USD...", action: () => alert("To load USD scenes, place .usda/.usdc files in the assets/ directory.\nThe Rust runtime loads them on startup and hot-reloads on changes.") },
        "separator",
        { label: "Preferences...", disabled: true },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", action: handleUndo, disabled: true },
        { label: "Redo", shortcut: "Ctrl+Shift+Z", action: handleRedo, disabled: true },
        "separator",
        { label: "Cut", shortcut: "Ctrl+X", disabled: true },
        { label: "Copy", shortcut: "Ctrl+C", disabled: true },
        { label: "Paste", shortcut: "Ctrl+V", disabled: true },
        "separator",
        { label: "Select All", shortcut: "Ctrl+A", disabled: true },
        { label: "Deselect All", disabled: true },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Reset Camera", shortcut: "Ctrl+0", action: handleResetCamera },
        "separator",
        { label: "Show Grid", action: handleToggleGrid, checked: showGrid },
        { label: "Wireframe Mode", action: handleToggleWireframe, checked: showWireframe },
        "separator",
        { label: "Toggle Fullscreen", shortcut: "F11", action: handleFullscreen },
        "separator",
        { label: "Scene Hierarchy", disabled: true },
        { label: "Properties Panel", disabled: true },
        { label: "Console", disabled: true },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About DarkIron", action: handleAbout },
        "separator",
        { label: "Documentation", disabled: true },
        { label: "Report Issue...", disabled: true },
      ],
    },
  ];

  // ─── Engine init ──────────────────────────────────────────────

  useEffect(() => {
    let destroyed = false;

    async function init() {
      try {
        if (!canvasRef.current) return;
        const renderer = new DarkIronRenderer({ canvas: canvasRef.current });
        rendererRef.current = renderer;
        const gpuReady = await renderer.initialize();
        if (!gpuReady) {
          setError("WebGPU not available.");
          setStatus("error");
          return;
        }

        console.log("[Editor] Connecting via DarkIronTransport...");
        const transport = await createTransport("ws://localhost:9222");
        transportRef.current = transport;
        if (destroyed) {
          transport.disconnect();
          return;
        }
        setStatus("connected");

        await transport.subscribe("scene.>", (_subject, payload) => {
          const event = payload as DarkIronEvent;
          if (!event || !event.type) return;
          switch (event.type) {
            case "SceneLoaded":
              if (event.meshes && rendererRef.current) {
                for (const mesh of event.meshes) {
                  rendererRef.current.uploadMesh({
                    name: mesh.name,
                    vertices: mesh.vertices,
                    indices: mesh.indices,
                    uvs: mesh.uvs,
                    baseColorTex: mesh.baseColorTex,
                  }).then(() => {
                    setMsgCount(rendererRef.current?.meshCount ?? 0);
                  });
                }
              }
              break;
            case "TransformChanged":
              console.log("[Editor] Transform: " + event.primPath);
              break;
            case "PrimCreated":
              console.log("[Editor] Created: " + event.primPath);
              break;
            case "PrimDeleted":
              console.log("[Editor] Deleted: " + event.primPath);
              break;
            case "AssetCooked":
              console.log("[Editor] Cooked: " + event.assetName);
              break;
          }
        });

        function frame() {
          if (destroyed) return;
          rendererRef.current?.render();
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
      rendererRef.current?.destroy();
      transportRef.current?.disconnect().catch(() => {});
    };
  }, []);

  // ─── Status bar right side ────────────────────────────────────

  const statusRight = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
      {msgCount > 0 && <span style={{ color: "#22c55e" }}>Meshes: {msgCount}</span>}
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background:
            status === "connected" ? "#22c55e" : status === "error" ? "#ef4444" : "#f59e0b",
        }}
      />
      <span style={{ color: "#8a8a8a" }}>
        {status === "connected"
          ? "NATS Connected"
          : status === "error"
            ? "Disconnected"
            : "Connecting..."}
      </span>
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#1e1e1e",
      }}
    >
      {/* Title Bar */}
      <div
        style={{
          height: 30,
          background: "#323233",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid #252526",
        }}
      >
        <span style={{ color: "#E31B23", fontWeight: 700, fontSize: 11, letterSpacing: 2 }}>
          DARKIRON
        </span>
        <span style={{ color: "#555", margin: "0 8px" }}>|</span>
        <span style={{ color: "#9a9a9a", fontSize: 11 }}>{sceneName} — Editor v0.1.0</span>
        <div style={{ flex: 1 }} />
        {statusRight}
      </div>

      {/* Menu Bar */}
      <MenuBar menus={menus} />

      {/* Viewport */}
      <div style={{ flex: 1, position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        {error && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "rgba(0,0,0,0.85)",
              padding: "24px 32px",
              borderRadius: 8,
              border: "1px solid #E31B23",
              maxWidth: 400,
              textAlign: "center",
            }}
          >
            <div style={{ color: "#E31B23", fontWeight: 700, marginBottom: 8 }}>Error</div>
            <div style={{ color: "#b8b8b8", fontSize: 13 }}>{error}</div>
          </div>
        )}
        {status === "connected" && !error && msgCount === 0 && (
          <div
            style={{ position: "absolute", bottom: 16, left: 16, color: "#4a4a4a", fontSize: 11 }}
          >
            Waiting for scene data... (File → Open to load a scene)
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div
        style={{
          height: 22,
          background: "#007acc",
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          fontSize: 11,
          color: "#fff",
        }}
      >
        <span>{sceneName}</span>
        <span style={{ margin: "0 8px", opacity: 0.5 }}>|</span>
        <span>{msgCount} meshes</span>
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.7 }}>WebGPU</span>
        <span style={{ margin: "0 8px", opacity: 0.3 }}>|</span>
        <span style={{ opacity: 0.7 }}>NATS {status === "connected" ? "●" : "○"}</span>
      </div>
    </div>
  );
}
