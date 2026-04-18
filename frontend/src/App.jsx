import { useEffect, useMemo, useState, useCallback } from "react";

const apiUrl = "http://localhost:4000/api/dashboard";
const CANVAS = { width: 1400, height: 800 };

function buildSwarmLayout(nodes, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const baseRadius = Math.min(width, height) * 0.28;
  
  const thoughtNodes = nodes.filter(n => n.nodeType === 'thought');
  const eventNodes = nodes.filter(n => n.nodeType === 'event');
  
  let layout = [];
  
  thoughtNodes.forEach((node, i) => {
    const angle = (i / Math.max(thoughtNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = baseRadius * 0.7 + Math.random() * 60;
    layout.push({
      ...node,
      x: centerX + Math.cos(angle) * r + (Math.random() - 0.5) * 80,
      y: centerY + Math.sin(angle) * r * 0.6 + (Math.random() - 0.5) * 60,
      vx: 0,
      vy: 0,
    });
  });
  
  eventNodes.forEach((node, i) => {
    const angle = (i / Math.max(eventNodes.length, 1)) * Math.PI * 2 + Math.PI / 4;
    const r = baseRadius * 1.1 + Math.random() * 40;
    layout.push({
      ...node,
      x: centerX + Math.cos(angle) * r + (Math.random() - 0.5) * 60,
      y: centerY + Math.sin(angle) * r * 0.7 + (Math.random() - 0.5) * 50,
      vx: 0,
      vy: 0,
    });
  });
  
  return layout;
}

function runPhysics(nodes, edges, width, height, iterations = 120) {
  const positions = new Map(nodes.map(n => [n.id, { ...n }]));
  
  for (let iter = 0; iter < iterations; iter++) {
    const items = [...positions.values()];
    
    items.forEach(node => {
      let fx = 0, fy = 0;
      
      items.forEach(other => {
        if (other.id === node.id) return;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 6000 / (dist * dist);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      });
      
      const centerX = width / 2;
      const centerY = height / 2;
      const toCenterX = (centerX - node.x) * 0.008;
      const toCenterY = (centerY - node.y) * 0.008;
      fx += toCenterX;
      fy += toCenterY;
      
      edges.forEach(edge => {
        if (edge.source !== node.id && edge.target !== node.id) return;
        const otherId = edge.source === node.id ? edge.target : edge.source;
        const other = positions.get(otherId);
        if (!other) return;
        const dx = other.x - node.x;
        const dy = other.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const attract = (dist - 200) * 0.012;
        fx += (dx / dist) * attract;
        fy += (dy / dist) * attract;
      });
      
      const pos = positions.get(node.id);
      pos.vx = (pos.vx + fx) * 0.82;
      pos.vy = (pos.vy + fy) * 0.82;
    });
    
    items.forEach(node => {
      const pos = positions.get(node.id);
      pos.x = Math.max(80, Math.min(width - 80, pos.x + pos.vx));
      pos.y = Math.max(80, Math.min(height - 80, pos.y + pos.vy));
    });
  }
  
  return nodes.map(n => {
    const p = positions.get(n.id);
    return { ...n, x: p.x, y: p.y };
  });
}

function InsightCard({ title, value, color }) {
  return (
    <div className="stat-pill">
      <span className="stat-label">{title}</span>
      <span className="stat-value" style={{ color }}>{value}</span>
    </div>
  );
}

function NodePanel({ node, onClose }) {
  if (!node) return null;
  
  return (
    <div className="node-inspector">
      <button className="inspector-close" onClick={onClose}>✕</button>
      <div className="inspector-badge">
        <span className={`badge-pill ${node.nodeType}`}>{node.nodeType}</span>
      </div>
      <h3 className="inspector-title">{node.label}</h3>
      <p className="inspector-category">{node.category}</p>
      
      <div className="inspector-body">
        {node.nodeType === 'thought' && node.details && (
          <>
            <div className="inspector-row">
              <span className="label">Content</span>
              <span className="value">{node.details.content}</span>
            </div>
            <div className="inspector-metrics">
              <div className="metric"><span>Mood</span><strong>{node.details.mood}</strong></div>
              <div className="metric"><span>Energy</span><strong>{node.details.energyLevel}/10</strong></div>
              <div className="metric"><span>Focus</span><strong>{node.details.focusLevel}/10</strong></div>
            </div>
          </>
        )}
        {node.nodeType === 'event' && node.details && (
          <>
            <div className="inspector-row">
              <span className="label">Description</span>
              <span className="value">{node.details.description}</span>
            </div>
            <div className="inspector-row">
              <span className="label">Location</span>
              <span className="value">{node.details.location}</span>
            </div>
          </>
        )}
      </div>
      <p className="inspector-time">
        {node.timestamp ? new Date(node.timestamp).toLocaleString() : 'No timestamp'}
      </p>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [drag, setDrag] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [animating, setAnimating] = useState(true);

  useEffect(() => {
    fetch(apiUrl)
      .then(res => res.ok ? res.json() : Promise.reject('Failed'))
      .then(payload => {
        setData(payload);
        
        const allNodes = [
          ...(payload.thoughts || []).map(t => ({ 
            id: t.id, label: t.title, nodeType: 'thought', 
            category: t.mood, timestamp: t.timestamp, details: t 
          })),
          ...(payload.events || []).map(e => ({ 
            id: e.id, label: e.title, nodeType: 'event', 
            category: e.type, timestamp: e.start, details: e 
          }))
        ];
        
        const unique = allNodes.reduce((acc, n) => {
          if (!acc.find(x => x.id === n.id)) acc.push(n);
          return acc;
        }, []);
        
        const initial = buildSwarmLayout(unique, CANVAS.width, CANVAS.height);
        const positioned = runPhysics(initial, payload.network?.edges || [], CANVAS.width, CANVAS.height);
        
        setNodes(positioned);
        setEdges(payload.network?.edges || []);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const linkedIds = useMemo(() => {
    if (!selected) return new Set();
    const ids = new Set([selected.id]);
    edges.forEach(e => {
      if (e.source === selected.id || e.target === selected.id) {
        ids.add(e.source); ids.add(e.target);
      }
    });
    return ids;
  }, [selected, edges]);

  const handleMouseDown = useCallback((e, node) => {
    e.stopPropagation();
    setDrag(node.id);
    setDragOffset({ x: e.clientX, y: e.clientY });
    setSelected(node);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!drag) return;
    const dx = (e.clientX - dragOffset.x) / zoom;
    const dy = (e.clientY - dragOffset.y) / zoom;
    setNodes(prev => prev.map(n => n.id === drag ? { ...n, x: n.x + dx, y: n.y + dy } : n));
    setDragOffset({ x: e.clientX, y: e.clientY });
  }, [drag, dragOffset, zoom]);

  const handleMouseUp = useCallback(() => setDrag(null), []);

  const handleCanvasClick = (e) => {
    if (e.target.classList.contains('network-canvas') || e.target.tagName === 'svg') {
      setSelected(null);
    }
  };

  const handleZoom = (dir) => setZoom(z => Math.max(0.5, Math.min(2, z + dir * 0.15)));
  const handleReset = () => { setPan({ x: 0, y: 0 }); setZoom(1); };

  if (loading) return <div className="loader"><div className="loader-ring" /><span>Initializing LifeOS...</span></div>;
  if (error) return <div className="loader error">Error: {error}</div>;

  return (
    <div className="lifeos" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      <header className="top-bar">
        <div className="brand">
          <span className="brand-icon">◈</span>
          <h1>LifeOS</h1>
        </div>
        <div className="user-info">
          <span className="user-name">{data?.profile?.name}</span>
          <span className="user-sources">{data?.profile?.connectedSources?.join(' · ')}</span>
        </div>
      </header>

      <section className="metrics-bar">
        <InsightCard title="Energy" value={data?.insights?.averageEnergy || 0} color="#ff8855" />
        <InsightCard title="Focus" value={data?.insights?.averageFocus || 0} color="#4a9eff" />
        <InsightCard title="Thoughts" value={data?.thoughts?.length || 0} color="#a855f7" />
        <InsightCard title="Events" value={data?.events?.length || 0} color="#44dd88" />
      </section>

      <section className="network-section">
        <div className="network-controls">
          <button onClick={() => handleZoom(1)}>+</button>
          <button onClick={() => handleZoom(-1)}>−</button>
          <button onClick={handleReset}>⟲</button>
        </div>
        
        <div className="network-canvas" onClick={handleCanvasClick}>
          <div className="swarm-bg" />
          
          <svg className="edges-layer" width={CANVAS.width} height={CANVAS.height}>
            <defs>
              <linearGradient id="edgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#4a9eff" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#a855f7" stopOpacity="0.15" />
              </linearGradient>
              <filter id="glow"><feGaussianBlur stdDeviation="3" result="colored"/><feMerge><feMergeNode in="colored"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            {edges.map(edge => {
              const src = nodes.find(n => n.id === edge.source);
              const tgt = nodes.find(n => n.id === edge.target);
              if (!src || !tgt) return null;
              const isLinked = selected && linkedIds.has(edge.source) && linkedIds.has(edge.target);
              return (
                <line key={edge.id} x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                  className={`swarm-edge ${isLinked ? 'active' : ''}`} />
              );
            })}
          </svg>

          <div className="nodes-layer" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {nodes.map(node => {
              const isSelected = selected?.id === node.id;
              const isLinked = linkedIds.has(node.id);
              const isDimmed = selected && !isLinked;
              
              return (
                <div key={node.id}
                  className={`swarm-node ${node.nodeType} ${isSelected ? 'selected' : ''} ${isLinked ? 'linked' : ''} ${isDimmed ? 'dimmed' : ''}`}
                  style={{ left: node.x, top: node.y }}
                  onClick={e => { e.stopPropagation(); setSelected(node); }}
                  onMouseDown={e => handleMouseDown(e, node)}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div className="node-glow" />
                  <div className="node-core">
                    <span className="node-type">{node.nodeType}</span>
                    <span className="node-label">{node.label}</span>
                    <span className="node-cat">{node.category}</span>
                  </div>
                  {isSelected && <div className="node-ring" />}
                </div>
              );
            })}
          </div>
        </div>

        {selected && <NodePanel node={selected} onClose={() => setSelected(null)} />}
      </section>

      <section className="insights-bar">
        <div className="insight-block">
          <h4>AI Summary</h4>
          <p>{data?.insights?.headline}</p>
        </div>
        <div className="insight-block">
          <h4>Recommendations</h4>
          <div className="rec-list">
            {(data?.insights?.recommendations || []).slice(0, 3).map((r, i) => (
              <div key={i} className="rec-chip">
                <span className={`rec-tag ${r.type}`}>{r.type}</span>
                <span className="rec-title">{r.title}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}