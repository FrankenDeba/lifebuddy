import { useEffect, useMemo, useRef, useState } from "react";

const apiUrl = "http://localhost:4000/api/dashboard";
const nodeSize = { width: 180, height: 92 };
const canvasSize = { width: 1000, height: 680 };

function buildForceLayout(nodes, edges, width, height) {
  const positions = new Map(
    nodes.map((node, index) => [
      node.id,
      {
        ...node,
        px: (node.x / 100) * width,
        py: (node.y / 100) * height,
        vx: 0,
        vy: 0,
        angle: (index / Math.max(nodes.length, 1)) * Math.PI * 2,
      },
    ]),
  );

  const centerX = width / 2;
  const centerY = height / 2;

  for (let step = 0; step < 160; step += 1) {
    const items = [...positions.values()];

    items.forEach((node) => {
      let forceX = 0;
      let forceY = 0;

      items.forEach((other) => {
        if (other.id === node.id) {
          return;
        }

        const dx = node.px - other.px;
        const dy = node.py - other.py;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const repulsion = 8200 / (distance * distance);
        forceX += (dx / distance) * repulsion;
        forceY += (dy / distance) * repulsion;
      });

      const orbitRadius = node.nodeType === "thought" ? 170 : 245;
      const orbitX = centerX + Math.cos(node.angle) * orbitRadius;
      const orbitY = centerY + Math.sin(node.angle) * orbitRadius * 0.72;
      forceX += (orbitX - node.px) * 0.018;
      forceY += (orbitY - node.py) * 0.018;

      edges?.forEach((edge) => {
        if (edge.source !== node.id && edge.target !== node.id) {
          return;
        }

        const otherId = edge.source === node.id ? edge.target : edge.source;
        const other = positions.get(otherId);
        if (!other) {
          return;
        }

        const dx = other.px - node.px;
        const dy = other.py - node.py;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const attraction = (distance - 180) * 0.014;
        forceX += (dx / distance) * attraction;
        forceY += (dy / distance) * attraction;
      });

      node.vx = (node.vx + forceX) * 0.84;
      node.vy = (node.vy + forceY) * 0.84;
    });

    items.forEach((node) => {
      node.px = Math.min(
        width - nodeSize.width / 2 - 26,
        Math.max(nodeSize.width / 2 + 26, node.px + node.vx),
      );
      node.py = Math.min(
        height - nodeSize.height / 2 - 26,
        Math.max(nodeSize.height / 2 + 26, node.py + node.vy),
      );
    });
  }

  return nodes.map((node) => {
    const positioned = positions.get(node.id);
    return {
      ...node,
      px: positioned.px,
      py: positioned.py,
    };
  });
}

function InsightCard({ title, subtitle, value }) {
  return (
    <div className="card stat-card">
      <p className="eyebrow">{subtitle}</p>
      <h3>{title}</h3>
      <strong>{value}</strong>
    </div>
  );
}

function MiniMap({ nodes, selectedNodeId, onSelectNode }) {
  return (
    <div className="minimap">
      <div className="minimap-header">
        <p className="eyebrow">Mini map</p>
        <span>Constellation overview</span>
      </div>
      <div className="minimap-canvas">
        <svg viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="none">
          {nodes.map((node) => (
            <circle
              key={node.id}
              cx={node.px}
              cy={node.py}
              r={node.id === selectedNodeId ? 12 : 8}
              className={node.id === selectedNodeId ? `minimap-dot ${node.nodeType} active` : `minimap-dot ${node.nodeType}`}
              onClick={() => onSelectNode(node.id)}
            />
          ))}
        </svg>
      </div>
    </div>
  )
}

function NodeDetails({ selectedNode }) {
  if (!selectedNode) {
    return (
      <div className="node-empty">
        <p className="eyebrow">Inspector</p>
        <h2>Select a node</h2>
        <p>
          Click a thought or schedule node in the network to inspect its
          connected memory.
        </p>
      </div>
    );
  }

  return (
    <div className="node-details">
      <p className="eyebrow">Node inspector</p>
      <h2>{selectedNode.label}</h2>
      <div className="chip-row">
        <span className="chip">{selectedNode.nodeType}</span>
        <span className="chip">{selectedNode.category}</span>
      </div>
      <p className="node-timestamp">
        {new Date(selectedNode.timestamp).toLocaleString()}
      </p>
      <div className="stack">
        {Object.entries(selectedNode.details || {}).map(([key, value]) => {
          if (
            value === null ||
            value === undefined ||
            value === "" ||
            (Array.isArray(value) && value.length === 0)
          ) {
            return null;
          }

          return (
            <div className="detail-row" key={key}>
              <span>{key.replace(/([A-Z])/g, " $1")}</span>
              <strong>
                {Array.isArray(value) ? value.join(", ") : String(value)}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [draggedNodeId, setDraggedNodeId] = useState("");
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [layoutNodes, setLayoutNodes] = useState([]);
  const canvasRef = useRef(null);

  useEffect(() => {
    fetch(apiUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load dashboard data");
        }
        return response.json();
      })
      .then((payload) => {
        setData(payload);
        setLayoutNodes(
          buildForceLayout(
            payload.network?.nodes || [],
            payload.network?.edges || [],
            canvasSize.width,
            canvasSize.height,
          ),
        );
        setSelectedNodeId(payload.network?.nodes?.[0]?.id || "");
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const moodEntries = useMemo(() => {
    if (!data?.insights?.moodBreakdown) {
      return [];
    }

    return Object.entries(data.insights.moodBreakdown);
  }, [data]);

  const selectedNode = useMemo(() => {
    return layoutNodes.find((node) => node.id === selectedNodeId) || null;
  }, [layoutNodes, selectedNodeId]);

  const selectedConnections = useMemo(() => {
    if (!data?.network?.edges || !selectedNodeId) {
      return [];
    }

    return data.network?.edges.filter(
      (edge) =>
        edge.source === selectedNodeId || edge.target === selectedNodeId,
    );
  }, [data, selectedNodeId]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!draggedNodeId || !canvasRef.current) {
        return;
      }

      const rect = canvasRef.current.getBoundingClientRect();
      const nextX = (event.clientX - rect.left - pan.x - dragOffset.x) / zoom;
      const nextY = (event.clientY - rect.top - pan.y - dragOffset.y) / zoom;

      setLayoutNodes((current) =>
        current.map((node) =>
          node.id === draggedNodeId
            ? {
                ...node,
                px: Math.min(
                  canvasSize.width - nodeSize.width / 2 - 20,
                  Math.max(nodeSize.width / 2 + 20, nextX),
                ),
                py: Math.min(
                  canvasSize.height - nodeSize.height / 2 - 20,
                  Math.max(nodeSize.height / 2 + 20, nextY),
                ),
              }
            : node,
        ),
      );
    };

    const handlePointerUp = () => {
      setDraggedNodeId("");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragOffset.x, dragOffset.y, draggedNodeId, pan.x, pan.y, zoom]);

  const connectedNodeIds = useMemo(() => {
    const ids = new Set([selectedNodeId]);
    selectedConnections.forEach((edge) => {
      ids.add(edge.source);
      ids.add(edge.target);
    });
    return ids;
  }, [selectedConnections, selectedNodeId]);

  useEffect(() => {
    if (!layoutNodes.length || draggedNodeId) {
      return undefined;
    }

    const animate = window.setInterval(() => {
      setLayoutNodes((currentNodes) => {
        if (!currentNodes.length) {
          return currentNodes;
        }

        const jittered = currentNodes.map((node, index) => {
          const waveX = Math.sin(Date.now() / 1200 + index) * 0.55;
          const waveY = Math.cos(Date.now() / 1500 + index * 1.2) * 0.45;
          return {
            ...node,
            px: Math.min(
              canvasSize.width - nodeSize.width / 2 - 20,
              Math.max(nodeSize.width / 2 + 20, node.px + waveX),
            ),
            py: Math.min(
              canvasSize.height - nodeSize.height / 2 - 20,
              Math.max(nodeSize.height / 2 + 20, node.py + waveY),
            ),
          };
        });

        if (data?.network?.edges?.length) {
          return buildForceLayout(jittered, data.network.edges, canvasSize.width, canvasSize.height);
        }

        return jittered;
      });
    }, 1800);

    return () => window.clearInterval(animate);
  }, [data, draggedNodeId, layoutNodes.length]);

  const clusterGroups = useMemo(() => {
    const groups = new Map();

    layoutNodes.forEach((node) => {
      const key = node.nodeType === 'thought' ? `Mood: ${node.category}` : `Schedule: ${node.category}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(node.id);
    });

    return [...groups.entries()];
  }, [layoutNodes]);

  if (loading) {
    return (
      <div className="screen-state">Booting your life operating system…</div>
    );
  }

  if (error) {
    return <div className="screen-state error">{error}</div>;
  }

  return (
    <main className="app-shell">
      <section className="hero card">
        <p className="eyebrow">Orbit Control</p>
        <h1>Welcome back, {data.profile.name}.</h1>
        <p className="hero-copy">
          Explore your day as an interactive thought network where journal
          entries and calendar schedules become connected nodes in your life
          operating system.
        </p>
        <div className="chip-row">
          {data.profile.connectedSources.map((source) => (
            <span key={source} className="chip">
              {source}
            </span>
          ))}
          <span className="chip">Timezone: {data.profile.timezone}</span>
        </div>
      </section>

      <section className="stats-grid">
        <InsightCard
          title="Average Energy"
          subtitle="Daily rhythm"
          value={data.insights.averageEnergy}
        />
        <InsightCard
          title="Average Focus"
          subtitle="Work quality"
          value={data.insights.averageFocus}
        />
        <InsightCard
          title="Thought Nodes"
          subtitle="Journal graph"
          value={data.thoughts.length}
        />
        <InsightCard
          title="Schedule Nodes"
          subtitle="Calendar graph"
          value={data.events.length}
        />
      </section>

      <section className="network-layout">
        <div className="card network-panel">
          <div className="network-header">
            <div>
              <p className="eyebrow">Interactive network</p>
              <h2>Thought and schedule constellation</h2>
            </div>
            <p className="network-copy">
              Select a node to reveal the details and connected memories.
            </p>
          </div>

          <div className="network-toolbar">
            <div className="chip-row toolbar-chips">
              <button
                type="button"
                className="toolbar-button"
                onClick={() =>
                  setZoom((current) =>
                    Math.min(1.8, Number((current + 0.1).toFixed(2))),
                  )
                }
              >
                Zoom in
              </button>
              <button
                type="button"
                className="toolbar-button"
                onClick={() =>
                  setZoom((current) =>
                    Math.max(0.7, Number((current - 0.1).toFixed(2))),
                  )
                }
              >
                Zoom out
              </button>
              <button
                type="button"
                className="toolbar-button"
                onClick={() => {
                  setPan({ x: 0, y: 0 });
                  setZoom(1);
                }}
              >
                Reset view
              </button>
            </div>
            <p className="muted-copy">
              Drag nodes to rearrange the constellation. Shift the view with the
              orbit controls.
            </p>
          </div>

          <div className="orbit-controls">
            <button
              type="button"
              className="orbit-button"
              onClick={() =>
                setPan((current) => ({ ...current, y: current.y + 28 }))
              }
            >
              ↑
            </button>
            <div className="orbit-row">
              <button
                type="button"
                className="orbit-button"
                onClick={() =>
                  setPan((current) => ({ ...current, x: current.x + 28 }))
                }
              >
                ←
              </button>
              <button
                type="button"
                className="orbit-button"
                onClick={() =>
                  setPan((current) => ({ ...current, x: current.x - 28 }))
                }
              >
                →
              </button>
            </div>
            <button
              type="button"
              className="orbit-button"
              onClick={() =>
                setPan((current) => ({ ...current, y: current.y - 28 }))
              }
            >
              ↓
            </button>
          </div>

          <div className="network-canvas" ref={canvasRef}>
            <div className="network-stars" />
            <div
              className="network-stage"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                width: `${canvasSize.width}px`,
                height: `${canvasSize.height}px`,
              }}
            >
              <svg
                className="network-lines"
                viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
                preserveAspectRatio="none"
              >
                {data.network?.edges.map((edge) => {
                  const source = layoutNodes.find(
                    (node) => node.id === edge.source,
                  );
                  const target = layoutNodes.find(
                    (node) => node.id === edge.target,
                  );

                  if (!source || !target) {
                    return null;
                  }

                  const isActive = selectedConnections.some(
                    (connection) => connection.id === edge.id,
                  );

                  return (
                    <line
                      key={edge.id}
                      x1={source.px}
                      y1={source.py}
                      x2={target.px}
                      y2={target.py}
                      className={
                        isActive ? "network-edge active" : "network-edge"
                      }
                    />
                  );
                })}
              </svg>

              {layoutNodes.map((node) => {
                const isSelected = node.id === selectedNodeId;
                const isConnected = connectedNodeIds.has(node.id);

                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`network-node ${node.nodeType} ${isSelected ? "selected" : ""} ${isConnected ? "connected" : ""}`}
                    style={{ left: `${node.px}px`, top: `${node.py}px` }}
                    onClick={() => setSelectedNodeId(node.id)}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      setSelectedNodeId(node.id);
                      const rect = event.currentTarget.getBoundingClientRect();
                      setDraggedNodeId(node.id);
                      setDragOffset({
                        x: event.clientX - rect.left - rect.width / 2,
                        y: event.clientY - rect.top - rect.height / 2,
                      });
                    }}
                  >
                    <span className="network-node-type">{node.nodeType}</span>
                    <strong>{node.label}</strong>
                    <small>{node.category}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="card inspector-panel">
          <MiniMap
            nodes={layoutNodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />

          <div className="cluster-panel">
            <p className="eyebrow">Clusters</p>
            <h3>Grouped by mood and schedule type</h3>
            <div className="stack">
              {clusterGroups.map(([label, ids]) => (
                <button
                  key={label}
                  type="button"
                  className="connection-card"
                  onClick={() => ids[0] && setSelectedNodeId(ids[0])}
                >
                  <span>{label}</span>
                  <strong>{ids.length} nodes</strong>
                </button>
              ))}
            </div>
          </div>

          <NodeDetails selectedNode={selectedNode} />

          <div className="connection-panel">
            <p className="eyebrow">Connections</p>
            <h3>Linked memories</h3>
            <div className="stack">
              {selectedConnections.length ? (
                selectedConnections.map((edge) => {
                  const relatedNode = layoutNodes.find(
                    (node) =>
                      node.id !== selectedNodeId &&
                      (node.id === edge.source || node.id === edge.target),
                  );
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      className="connection-card"
                      onClick={() =>
                        relatedNode && setSelectedNodeId(relatedNode.id)
                      }
                    >
                      <span>{edge.relationship}</span>
                      <strong>{relatedNode?.label || "Unknown node"}</strong>
                    </button>
                  );
                })
              ) : (
                <p className="muted-copy">This node has no direct links yet.</p>
              )}
            </div>
          </div>
        </aside>
      </section>

      <section className="content-grid compact">
        <div className="card panel span-2">
          <p className="eyebrow">Daily narrative</p>
          <h2>AI Summary</h2>
          <p>{data.insights.headline}</p>
        </div>

        <div className="card panel">
          <p className="eyebrow">Mood signals</p>
          <h2>Mood breakdown</h2>
          <ul className="list">
            {moodEntries.map(([mood, count]) => (
              <li key={mood}>
                <span>{mood}</span>
                <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div className="card panel span-3">
          <p className="eyebrow">Recommendations</p>
          <h2>Next best actions</h2>
          <div className="stack recommendation-grid">
            {data.insights.recommendations.map((item) => (
              <article key={item.title} className="recommendation">
                <span className="pill">{item.type}</span>
                <h3>{item.title}</h3>
                <p>{item.reason}</p>
                <strong>{item.action}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
