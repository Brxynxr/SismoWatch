import React, { useEffect, useRef, useState } from 'react';
import Globe, { GlobeMethods } from 'react-globe.gl';
import { EarthquakeEvent } from '../types';
import { RotateCcw, ShieldAlert, Waves, ZoomIn, ZoomOut, Compass, Layers } from 'lucide-react';

interface SeismicGlobe3DProps {
  events: EarthquakeEvent[];
  selectedEvent: EarthquakeEvent | null;
  onSelectEvent: (event: EarthquakeEvent) => void;
}

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
      <Globe
        ref={globeRef}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="#020617"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        showAtmosphere={true}
        atmosphereColor="#38bdf8"
        atmosphereAltitude={0.16}
        // Earthquake Epicenters (Surface Buttons + Laser Beam on Click)
        pointsData={events}
        pointLat={(d: any) => d.latitude}
        pointLng={(d: any) => d.longitude}
        pointAltitude={(d: any) => {
          if (d.event_id === selectedEvent?.event_id) return 0.42;
          return showAllBeacons ? Math.max(0.06, (d.magnitude / 10) * 0.35) : 0;
        }}
        pointRadius={(d: any) => {
          if (d.event_id === selectedEvent?.event_id) return 0.25;
          return showAllBeacons ? 0.08 : Math.max(0.4, (d.magnitude / 10) * 0.85);
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
        // 3D Tactical Target HUD Label on selected beacon
        labelsData={selectedEvent ? [selectedEvent] : []}
        labelLat={(d: any) => d.latitude}
        labelLng={(d: any) => d.longitude}
        labelText={(d: any) => `🎯 M${Number(d.magnitude).toFixed(1)} • ${d.place}`}
        labelSize={1.3}
        labelColor={() => '#00f5ff'}
        labelDotRadius={0.3}
        labelAltitude={0.44}
      />

      {/* Cockpit Overlay: Top Controls */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <button
          onClick={resetView}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800/90 text-slate-300 hover:text-white border border-slate-700/80 backdrop-blur text-xs font-medium shadow-lg transition-colors"
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
          title="Alternar entre ver balizas solo al hacer clic o en todos los sismos"
        >
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          {showAllBeacons ? 'Balizas: Todas' : 'Baliza: Al Clic'}
        </button>
      </div>

      {/* Cockpit Overlay: Magnitudes & PGA Legend */}
      <div className="absolute bottom-4 left-4 z-20 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-xl p-3 text-xs shadow-2xl space-y-2 pointer-events-auto">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200 border-b border-slate-800 pb-1.5">
          <Waves className="w-4 h-4 text-cyan-400" />
          <span>Balizas Láser & Telemetría PGA</span>
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
          <span>◎ Clic en sismo proyecta su línea láser vertical</span>
          <span className="text-slate-400">🎯 Focaliza</span>
        </div>
      </div>
    </div>
  );
};
