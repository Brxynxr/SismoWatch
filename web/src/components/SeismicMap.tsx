import React, { useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Popup } from 'react-leaflet';
import { EarthquakeEvent } from '../types';
import { ShieldAlert, Compass, Layers } from 'lucide-react';

interface SeismicMapProps {
  events: EarthquakeEvent[];
}

export const SeismicMap: React.FC<SeismicMapProps> = ({ events }) => {
  const [selectedEvent, setSelectedEvent] = useState<EarthquakeEvent | null>(null);

  const getMarkerColor = (mag: number) => {
    if (mag >= 5.0) return '#f43f5e'; // Rose
    if (mag >= 4.0) return '#fbbf24'; // Amber
    if (mag >= 2.5) return '#34d399'; // Emerald
    return '#38bdf8'; // Sky
  };

  return (
    <div className="relative w-full h-[500px] rounded-xl overflow-hidden border border-slate-800 bg-slate-900/60 shadow-lg">
      {/* Legend Overlay */}
      <div className="absolute top-4 right-4 z-[1000] bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg p-3 text-xs shadow-md space-y-1.5">
        <span className="font-semibold text-slate-300 block mb-1">Escala de Magnitud & Radio PGA</span>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-rose-500 inline-block"></span>
          <span className="text-slate-400">Mag ≥ 5.0 (Fuerte / Destructivo)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-400 inline-block"></span>
          <span className="text-slate-400">Mag 4.0 - 4.9 (Moderado / Sentido)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-400 inline-block"></span>
          <span className="text-slate-400">Mag 2.5 - 3.9 (Leve / Perceptible)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-sky-400 inline-block"></span>
          <span className="text-slate-400">Mag &lt; 2.5 (Micro / Instrumental)</span>
        </div>
        <div className="pt-1.5 border-t border-slate-800 text-[10px] text-sky-400 font-mono">
          🔘 Círculo translúcido: Radio superficial PGA (km)
        </div>
      </div>

      <MapContainer
        center={[20.0, 0.0]}
        zoom={2}
        minZoom={2}
        maxZoom={12}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {events.map((ev) => {
          const color = getMarkerColor(ev.magnitude);
          const radiusPixels = Math.max(5, Math.min(22, ev.magnitude * 4.5));
          const impactRadiusMeters = (ev.impact_radius_km || 1.0) * 1000;

          return (
            <React.Fragment key={ev.event_id}>
              {/* Outer Physical PGA Impact Radius Circle (Differentiator #1) */}
              <Circle
                center={[ev.latitude, ev.longitude]}
                radius={impactRadiusMeters}
                pathOptions={{
                  color: color,
                  fillColor: color,
                  fillOpacity: 0.12,
                  weight: 1,
                  dashArray: '4, 4'
                }}
              />

              {/* Epicenter Marker */}
              <CircleMarker
                center={[ev.latitude, ev.longitude]}
                radius={radiusPixels}
                pathOptions={{
                  color: '#ffffff',
                  weight: 1.5,
                  fillColor: color,
                  fillOpacity: 0.85
                }}
                eventHandlers={{
                  click: () => setSelectedEvent(ev)
                }}
              >
                <Popup>
                  <div className="space-y-1.5 font-sans">
                    <div className="flex items-center justify-between border-b border-slate-700 pb-1 gap-4">
                      <span className="text-xs font-mono font-bold text-sky-400">{ev.event_id}</span>
                      <span className="text-xs font-extrabold px-1.5 py-0.5 rounded bg-slate-800 text-white border border-slate-600">
                        M {Number(ev.magnitude).toFixed(1)} ({ev.magnitude_class})
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-200">{ev.place}</p>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                      <span>Región: <strong className="text-slate-300">{ev.region}</strong></span>
                      <span>Prof: <strong className="text-slate-300">{Number(ev.depth_km).toFixed(1)} km</strong></span>
                      <span>Radio PGA: <strong className="text-emerald-400">{ev.impact_radius_km} km</strong></span>
                      <span>Alerta Tsunami: <strong className={ev.tsunami_alert ? 'text-rose-400' : 'text-slate-400'}>{ev.tsunami_alert ? 'SÍ' : 'No'}</strong></span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono pt-1">
                      {new Date(ev.event_time).toUTCString()}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
};
