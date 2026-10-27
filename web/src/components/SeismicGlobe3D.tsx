import React, { useEffect, useRef, useState } from 'react';
import Globe, { GlobeMethods } from 'react-globe.gl';
import { EarthquakeEvent } from '../types';
import { Waves, ZoomIn, ZoomOut, Compass, RotateCcw, Layers } from 'lucide-react';

interface SeismicGlobe3DProps {
  events: EarthquakeEvent[];
  selectedEvent: EarthquakeEvent | null;
  onSelectEvent: (event: EarthquakeEvent) => void;
}

const CosmicStarfield: React.FC<{ width: number; height: number }> = ({ width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    // Twinkling stars
    const starCount = 200;
    const stars: Array<{
      x: number;
      y: number;
      radius: number;
      alpha: number;
      baseAlpha: number;
      speed: number;
    }> = [];

    for (let i = 0; i < starCount; i++) {
      const baseAlpha = Math.random() * 0.7 + 0.2;
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.3 + 0.4,
        alpha: baseAlpha,
        baseAlpha,
        speed: Math.random() * 0.02 + 0.005,
      });
    }

    // Shooting stars (Estrellas fugaces)
    interface ShootingStar {
      x: number;
      y: number;
      length: number;
      speed: number;
      angle: number;
      opacity: number;
      life: number;
      maxLife: number;
    }
    const shootingStars: ShootingStar[] = [];

    let lastSpawnTime = Date.now();
    let nextSpawnDelay = Math.random() * 2500 + 1500;

    const spawnShootingStar = () => {
      const angle = (Math.random() * 20 + 30) * (Math.PI / 180);
      shootingStars.push({
        x: Math.random() * width * 0.85,
        y: Math.random() * height * 0.35,
        length: Math.random() * 90 + 65,
        speed: Math.random() * 6 + 10,
        angle,
        opacity: 1,
        life: 0,
        maxLife: Math.random() * 35 + 30,
      });
    };

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Deep space radial gradient
      const bgGrad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        80,
        width * 0.5,
        height * 0.5,
        Math.max(width, height)
      );
      bgGrad.addColorStop(0, '#030816');
      bgGrad.addColorStop(0.6, '#020510');
      bgGrad.addColorStop(1, '#000206');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Draw and twinkle stars
      for (const s of stars) {
        s.alpha = s.baseAlpha + Math.sin(Date.now() * s.speed) * 0.25;
        const finalAlpha = Math.max(0.15, Math.min(1, s.alpha));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${finalAlpha})`;
        ctx.shadowBlur = s.radius > 1.1 ? 4 : 0;
        ctx.shadowColor = '#38bdf8';
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Spawn shooting stars periodically
      const now = Date.now();
      if (now - lastSpawnTime > nextSpawnDelay) {
        spawnShootingStar();
        lastSpawnTime = now;
        nextSpawnDelay = Math.random() * 3500 + 2500;
      }

      // Draw and update shooting stars
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const ss = shootingStars[i];
        ss.life++;
        const tailX = ss.x - Math.cos(ss.angle) * ss.length;
        const tailY = ss.y - Math.sin(ss.angle) * ss.length;

        const currentOpacity = Math.max(0, 1 - ss.life / ss.maxLife);

        const grad = ctx.createLinearGradient(tailX, tailY, ss.x, ss.y);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
        grad.addColorStop(0.7, `rgba(56, 189, 248, ${currentOpacity * 0.6})`);
        grad.addColorStop(1, `rgba(255, 255, 255, ${currentOpacity})`);

        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(ss.x, ss.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Star head bright nucleus
        ctx.beginPath();
        ctx.arc(ss.x, ss.y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${currentOpacity})`;
        ctx.fill();

        ss.x += Math.cos(ss.angle) * ss.speed;
        ss.y += Math.sin(ss.angle) * ss.speed;

        if (ss.life >= ss.maxLife || ss.x > width + 100 || ss.y > height + 100) {
          shootingStars.splice(i, 1);
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none z-0"
    />
  );
};

export const SeismicGlobe3D: React.FC<SeismicGlobe3DProps> = ({
  events,
  selectedEvent,
  onSelectEvent,
}) => {
  const globeRef = useRef<GlobeMethods>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isRotating, setIsRotating] = useState<boolean>(true);
  const [showAllBeacons, setShowAllBeacons] = useState<boolean>(false);

  // Resize handler for responsive WebGL canvas
  useEffect(() => {
    if (!containerRef.current) return;

    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // Configure auto-rotation and initial view
  useEffect(() => {
    if (!globeRef.current) return;
    const controls = globeRef.current.controls();
    if (controls) {
      controls.autoRotate = isRotating;
      controls.autoRotateSpeed = 0.6;
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
    }
  }, [isRotating]);

  // Smoothly orbit camera to selected event
  useEffect(() => {
    if (selectedEvent && globeRef.current) {
      setIsRotating(false);
      globeRef.current.pointOfView(
        {
          lat: selectedEvent.latitude,
          lng: selectedEvent.longitude,
          altitude: 1.6,
        },
        1200
      );
    }
  }, [selectedEvent]);

  const getMarkerColor = (mag: number): string => {
    if (mag >= 5.0) return '#ff0055'; // Neon Hyper Red
    if (mag >= 4.0) return '#ff9900'; // Neon Electric Amber
    if (mag >= 2.5) return '#00ff66'; // Neon Matrix Green
    return '#00d4ff'; // Neon Laser Cyan
  };

  const getRingColor = (mag: number): string => {
    if (mag >= 5.0) return 'rgba(255, 0, 85, 0.7)';
    if (mag >= 4.0) return 'rgba(255, 153, 0, 0.6)';
    if (mag >= 2.5) return 'rgba(0, 255, 102, 0.5)';
    return 'rgba(0, 212, 255, 0.4)';
  };

  const ringsData = React.useMemo(() => {
    const list: any[] = events.map((ev) => ({
      lat: ev.latitude,
      lng: ev.longitude,
      color: getRingColor(ev.magnitude),
      maxR: Math.max(2.0, Math.min(10, (ev.impact_radius_km || 10) / 18)),
      propagationSpeed: Math.max(1.0, ev.magnitude * 0.4),
      repeatPeriod: 1200,
      isTargetPulse: false,
    }));

    if (selectedEvent) {
      list.push({
        lat: selectedEvent.latitude,
        lng: selectedEvent.longitude,
        color: 'rgba(0, 245, 255, 0.95)',
        maxR: 15,
        propagationSpeed: 4.5,
        repeatPeriod: 600,
        isTargetPulse: true,
      });
    }

    return list;
  }, [events, selectedEvent]);

  const resetView = () => {
    if (globeRef.current) {
      globeRef.current.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 1000);
      setIsRotating(true);
    }
  };

  const handlePointClick = (event: any) => {
    const matched = events.find((e) => e.event_id === event.event_id);
    if (matched) {
      onSelectEvent(matched);
    }
  };

  const renderTooltip = (ev: EarthquakeEvent): string => {
    const color = getMarkerColor(ev.magnitude);
    return `
      <div style="background: rgba(15, 23, 42, 0.95); border: 1px solid #334155; border-radius: 8px; padding: 10px 14px; font-family: sans-serif; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); min-width: 220px; color: #f8fafc;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 6px; margin-bottom: 6px;">
          <span style="font-family: monospace; font-size: 11px; font-weight: bold; color: #38bdf8;">${ev.event_id}</span>
          <span style="background: ${color}; color: #0f172a; font-weight: 800; font-size: 11px; padding: 2px 6px; border-radius: 4px;">
            M ${Number(ev.magnitude).toFixed(1)} (${ev.magnitude_class})
          </span>
        </div>
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px; color: #e2e8f0;">${ev.place}</div>
        <div style="font-size: 11px; color: #94a3b8; display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
          <div>Profundidad: <b style="color: #cbd5e1;">${ev.depth_km !== undefined && ev.depth_km !== null && !isNaN(Number(ev.depth_km)) ? `${Number(ev.depth_km).toFixed(1)} km` : '--'}</b></div>
          <div>Radio PGA: <b style="color: #38bdf8;">${Number(ev.impact_radius_km || 0).toFixed(0)} km</b></div>
        </div>
        ${
          ev.tsunami_alert
            ? '<div style="margin-top: 6px; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #fca5a5; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px; text-align: center;">⚠️ ALERTA DE TSUNAMI EMITIDA</div>'
            : ''
        }
      </div>
    `;
  };

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[550px] overflow-hidden bg-slate-950 select-none">
      {/* Dynamic Cosmic Starfield & Shooting Stars Canvas */}
      <CosmicStarfield width={dimensions.width} height={dimensions.height} />

      <Globe
        ref={globeRef}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        showAtmosphere={true}
        atmosphereColor="#38bdf8"
        atmosphereAltitude={0.16}
        // Earthquake Epicenters (Surface Nodes + Laser Beacons when toggled)
        pointsData={events}
        pointLat={(d: any) => d.latitude}
        pointLng={(d: any) => d.longitude}
        pointAltitude={(d: any) => {
          return showAllBeacons ? Math.max(0.08, (d.magnitude / 10) * 0.38) : 0;
        }}
        pointRadius={(d: any) => {
          if (d.event_id === selectedEvent?.event_id) return 0.55;
          return showAllBeacons ? 0.12 : Math.max(0.35, (d.magnitude / 10) * 0.8);
        }}
        pointColor={(d: any) =>
          d.event_id === selectedEvent?.event_id
            ? '#00f5ff'
            : getMarkerColor(d.magnitude)
        }
        pointLabel={(d: any) => renderTooltip(d)}
        onPointClick={handlePointClick}
        // Concentric Rings Layer: Physical PGA Impact Wave + Target Tactical Pulse
        ringsData={ringsData}
        ringLat={(d: any) => d.lat}
        ringLng={(d: any) => d.lng}
        ringColor={(d: any) => () => d.color}
        ringMaxRadius={(d: any) => d.maxR}
        ringPropagationSpeed={(d: any) => d.propagationSpeed}
        ringRepeatPeriod={(d: any) => d.repeatPeriod}
        labelsData={[]}
      />

      {/* Cockpit Overlay: Top Controls */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <button
          onClick={resetView}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 backdrop-blur text-xs font-medium shadow-lg transition-colors cursor-pointer"
          title="Restablecer vista global"
        >
          <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
          Vista Global
        </button>

        <button
          onClick={() => setIsRotating(!isRotating)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border backdrop-blur text-xs font-medium shadow-lg transition-colors cursor-pointer ${
            isRotating
              ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
              : 'bg-slate-900/80 text-slate-400 border-slate-700/80 hover:text-white'
          }`}
          title="Alternar rotación automática"
        >
          <Compass className={`w-3.5 h-3.5 ${isRotating ? 'animate-spin' : ''}`} />
          {isRotating ? 'Auto-Rotación: ON' : 'Auto-Rotación: OFF'}
        </button>

        <button
          onClick={() => setShowAllBeacons(!showAllBeacons)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border backdrop-blur text-xs font-medium shadow-lg transition-colors cursor-pointer ${
            showAllBeacons
              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
              : 'bg-slate-900/80 text-slate-400 border-slate-700/80 hover:text-white'
          }`}
          title="Proyectar líneas láser verticales en los epicentros"
        >
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          {showAllBeacons ? 'Balizas Láser: ON' : 'Balizas Láser: OFF'}
        </button>
      </div>

      {/* Cockpit Overlay: Magnitudes & PGA Legend */}
      <div className="absolute bottom-4 left-4 z-20 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-xl p-3 text-xs shadow-2xl space-y-2 pointer-events-auto">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200 border-b border-slate-800 pb-1.5">
          <Waves className="w-4 h-4 text-cyan-400" />
          <span>Intensidad Sísmica & Magnitudes</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff0055] shadow-sm shadow-[#ff0055]/50"></span>
            <span className="text-slate-300">M ≥ 5.0 (Crítico)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff9900] shadow-sm shadow-[#ff9900]/50"></span>
            <span className="text-slate-300">M 4.0 - 4.9</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00ff66] shadow-sm shadow-[#00ff66]/50"></span>
            <span className="text-slate-300">M 2.5 - 3.9</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00d4ff] shadow-sm shadow-[#00d4ff]/50"></span>
            <span className="text-slate-300">M &lt; 2.5</span>
          </div>
        </div>
        <div className="text-[10px] text-cyan-400 font-mono border-t border-slate-800 pt-1 flex items-center justify-between">
          <span>◎ Clic en sismo focaliza la cámara 3D</span>
        </div>
      </div>
    </div>
  );
};
