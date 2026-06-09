'use client';

import { useState, useEffect } from 'react';
import Map, { NavigationControl, FullscreenControl, ScaleControl, GeolocateControl } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer, ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import * as turf from '@turf/turf';

// Helper: get property case-insensitive
function getProp(props: any, key: string): string | null {
  if (!props) return null;
  const found = Object.keys(props).find(k => k.toLowerCase() === key.toLowerCase());
  return found ? String(props[found]) : null;
}

import { getPFIColor, getPFICategory } from '@/utils/pfi';

interface MapViewerProps {
  geoData?: any;
  flyToFeature?: any;
  highlightedKec?: string | null;
  highlightedDesa?: string | null;
  // Draw mode props
  drawMode?: boolean;
  drawingPoints?: [number, number][];
  onMapClick?: (lng: number, lat: number) => void;
  onFinishDraw?: () => void;
  onCancelDraw?: () => void;
  onUndoPoint?: () => void;
  drawingForLabel?: string;
  // Party insight props
  selectedParty?: string | null;
  partyFilter?: 'above50' | 'below50' | null;
  partyDesaPercentages?: Record<string, number>;
  onPartyFilterChange?: (filter: 'above50' | 'below50' | null) => void;
  // PFI Mode props
  isPFIMode?: boolean;
  pfiDesaScores?: Record<string, number>;
}

// Helper: Hex to RGBA
function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const c = hex.substring(1).split('');
  if (c.length === 3) {
    c[0] += c[0]; c[1] += c[1]; c[2] += c[2];
  }
  const r = parseInt(c[0] + c[1] || '0', 16);
  const g = parseInt(c[2] + c[3] || '0', 16);
  const b = parseInt(c[4] + c[5] || '0', 16);
  return [r, g, b, alpha];
}

export default function MapViewer({
  geoData,
  flyToFeature,
  highlightedKec,
  highlightedDesa,
  drawMode = false,
  drawingPoints = [],
  onMapClick,
  onFinishDraw,
  onCancelDraw,
  onUndoPoint,
  drawingForLabel,
  selectedParty,
  partyFilter,
  partyDesaPercentages = {},
  onPartyFilterChange,
  isPFIMode = false,
  pfiDesaScores = {},
}: MapViewerProps) {
  const [viewState, setViewState] = useState({
    longitude: 118.0149,
    latitude: -2.5489,
    zoom: 4.5,
    pitch: 0,
    bearing: 0,
    transitionDuration: 0,
  });

  // Mock data for initial empty state
  const mockGeoJson = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Jakarta' }, geometry: { type: 'Point', coordinates: [106.8456, -6.2088] } },
      { type: 'Feature', properties: { name: 'Bali' }, geometry: { type: 'Point', coordinates: [115.1889, -8.4095] } }
    ]
  };

  const dataToRender = geoData || mockGeoJson;

  // Auto-center when new geoData is loaded
  useEffect(() => {
    if (geoData?.features?.length > 0) {
      try {
        const validFeatures = geoData.features.filter((f: any) => f.geometry);
        if (validFeatures.length === 0) return;
        const fc = { ...geoData, features: validFeatures };
        const center = turf.center(fc);
        if (center.geometry?.coordinates) {
          setViewState(prev => ({
            ...prev,
            longitude: center.geometry.coordinates[0],
            latitude: center.geometry.coordinates[1],
            zoom: 10,
            transitionDuration: 800,
          }));
        }
      } catch (err) {
        console.error('Error calculating center', err);
      }
    }
  }, [geoData]);

  // Fly to feature when triggered from sidebar
  useEffect(() => {
    if (!flyToFeature) return;

    if (flyToFeature.type === 'bbox') {
      try {
        const [minLng, minLat, maxLng, maxLat] = flyToFeature.bbox;
        const centerLng = (minLng + maxLng) / 2;
        const centerLat = (minLat + maxLat) / 2;
        const lngSpan = maxLng - minLng;
        const latSpan = maxLat - minLat;
        const span = Math.max(lngSpan, latSpan);
        const zoom = Math.max(8, Math.min(14, Math.log2(360 / span) - 1));
        setViewState(prev => ({
          ...prev,
          longitude: centerLng,
          latitude: centerLat,
          zoom,
          transitionDuration: 800,
        }));
      } catch {}
    } else if (flyToFeature.type === 'center') {
      setViewState(prev => ({
        ...prev,
        longitude: flyToFeature.longitude,
        latitude: flyToFeature.latitude,
        zoom: flyToFeature.zoom || 13,
        transitionDuration: 600,
      }));
    }
  }, [flyToFeature]);

  // ─── Draw Mode Layers ──────────────────────────────────────────────────────
  const drawVerticesLayer = drawMode && drawingPoints.length > 0
    ? new ScatterplotLayer({
        id: 'draw-vertices',
        data: drawingPoints.map((p, i) => ({ position: p, index: i })),
        getPosition: (d: any) => d.position,
        getRadius: 6,
        getFillColor: (d: any) => d.index === 0 ? [255, 200, 0, 255] : [255, 80, 80, 255],
        getLineColor: [255, 255, 255, 255],
        stroked: true,
        lineWidthMinPixels: 2,
        radiusUnits: 'pixels',
        pickable: false,
      })
    : null;

  const drawPathPoints = drawingPoints.length >= 2
    ? [...drawingPoints, drawingPoints[0]]
    : drawingPoints;

  const drawPathLayer = drawMode && drawingPoints.length >= 2
    ? new PathLayer({
        id: 'draw-path',
        data: [{ path: drawPathPoints }],
        getPath: (d: any) => d.path,
        getColor: [255, 220, 50, 200],
        getWidth: 2,
        widthUnits: 'pixels',
        pickable: false,
      })
    : null;

  const drawPolygonLayer = drawMode && drawingPoints.length >= 3
    ? new GeoJsonLayer({
        id: 'draw-polygon-preview',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[...drawingPoints, drawingPoints[0]]],
            },
          }],
        },
        filled: true,
        stroked: false,
        getFillColor: [255, 200, 50, 60],
        pickable: false,
      })
    : null;

  // ─── Party-mode color helper ───────────────────────────────────────────────
  const getPartyFillColor = (f: any): [number, number, number, number] => {
    const desa = getProp(f.properties, 'desa');
    const kec = getProp(f.properties, 'kecamatan');
    const key = `${desa}__${kec}`;
    const pct = partyDesaPercentages[key];

    if (pct === undefined) return [60, 60, 80, 80]; // no data — dim

    const isAbove = pct >= 50;

    // Filter mode: fade-out non-matching
    if (partyFilter === 'above50' && !isAbove) return [60, 60, 80, 30];
    if (partyFilter === 'below50' && isAbove) return [60, 60, 80, 30];

    if (isAbove) return [34, 197, 94, 210];   // green-500
    return [249, 115, 22, 210];               // orange-500
  };

  const getPartyLineColor = (f: any): [number, number, number, number] => {
    const desa = getProp(f.properties, 'desa');
    const kec = getProp(f.properties, 'kecamatan');
    const key = `${desa}__${kec}`;
    const pct = partyDesaPercentages[key];
    if (pct === undefined) return [80, 80, 100, 100];
    if (partyFilter === 'above50' && pct < 50) return [80, 80, 100, 50];
    if (partyFilter === 'below50' && pct >= 50) return [80, 80, 100, 50];
    return pct >= 50 ? [34, 197, 94, 255] : [249, 115, 22, 255];
  };


  // ─── PFI-mode color helper ───────────────────────────────────────────────
  const getPfiLayerFillColor = (f: any): [number, number, number, number] => {
    const desa = getProp(f.properties, 'desa');
    const kec = getProp(f.properties, 'kecamatan');
    const key = `${desa}__${kec}`;
    const score = pfiDesaScores[key];

    if (score === undefined || score < 0) return [60, 60, 80, 80]; // no data — dim

    const hex = getPFIColor(score);
    return hexToRgba(hex, 210);
  };

  const getPfiLayerLineColor = (f: any): [number, number, number, number] => {
    const desa = getProp(f.properties, 'desa');
    const kec = getProp(f.properties, 'kecamatan');
    const key = `${desa}__${kec}`;
    const score = pfiDesaScores[key];

    if (score === undefined || score < 0) return [80, 80, 100, 100];
    
    const hex = getPFIColor(score);
    return hexToRgba(hex, 255);
  };

  // ─── Normal GeoJSON Layer ──────────────────────────────────────────────────
  const normalLayer = new GeoJsonLayer({
    id: 'geojson-layer',
    data: dataToRender,
    pickable: !drawMode,
    stroked: true,
    filled: true,
    extruded: false,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    getFillColor: (f: any) => {
      if (!f.geometry) return [0, 0, 0, 0];

      // PFI insight mode
      if (isPFIMode && Object.keys(pfiDesaScores).length > 0) {
        return getPfiLayerFillColor(f);
      }

      // Party insight mode
      if (selectedParty && Object.keys(partyDesaPercentages).length > 0) {
        return getPartyFillColor(f);
      }

      // Normal highlight
      if (highlightedDesa && getProp(f.properties, 'desa') === highlightedDesa && getProp(f.properties, 'kecamatan') === highlightedKec) {
        return [50, 255, 150, 200];
      }
      if (highlightedKec === 'ALL') return [100, 200, 255, 160];
      if (highlightedKec && getProp(f.properties, 'kecamatan') === highlightedKec) return [100, 200, 255, 160];
      return [160, 160, 180, 130];
    },
    getLineColor: (f: any) => {
      if (!f.geometry) return [0, 0, 0, 0];

      if (isPFIMode && Object.keys(pfiDesaScores).length > 0) {
        return getPfiLayerLineColor(f);
      }

      if (selectedParty && Object.keys(partyDesaPercentages).length > 0) {
        return getPartyLineColor(f);
      }

      if (highlightedDesa && getProp(f.properties, 'desa') === highlightedDesa && getProp(f.properties, 'kecamatan') === highlightedKec) {
        return [100, 255, 150, 255];
      }
      if (highlightedKec === 'ALL') return [100, 220, 255, 255];
      if (highlightedKec && getProp(f.properties, 'kecamatan') === highlightedKec) return [100, 220, 255, 255];
      return [255, 255, 255, 200];
    },
    getLineWidth: (f: any) => {
      if (!f.geometry) return 0;
      if (selectedParty && Object.keys(partyDesaPercentages).length > 0) {
        const desa = getProp(f.properties, 'desa');
        const kec = getProp(f.properties, 'kecamatan');
        const pct = partyDesaPercentages[`${desa}__${kec}`];
        if (pct !== undefined) return 2;
        return 1;
      }
      if (highlightedDesa && getProp(f.properties, 'desa') === highlightedDesa && getProp(f.properties, 'kecamatan') === highlightedKec) return 3;
      if (highlightedKec === 'ALL') return 2.5;
      if (highlightedKec && getProp(f.properties, 'kecamatan') === highlightedKec) return 2.5;
      return 1.5;
    },
    updateTriggers: {
      getFillColor: [highlightedKec, highlightedDesa, selectedParty, partyFilter, partyDesaPercentages, isPFIMode, pfiDesaScores],
      getLineColor: [highlightedKec, highlightedDesa, selectedParty, partyFilter, partyDesaPercentages, isPFIMode, pfiDesaScores],
      getLineWidth: [highlightedKec, highlightedDesa, selectedParty, partyDesaPercentages, isPFIMode, pfiDesaScores],
    },
    autoHighlight: !drawMode && !selectedParty && !isPFIMode,
    highlightColor: [255, 255, 0, 255],
  });

  // ─── Tooltip ──────────────────────────────────────────────────────────────
  const handleTooltip = ({ object }: any) => {
    if (drawMode || !object) return null;
    const props = object.properties;
    if (!props) return null;

    let html = '';

    // PFI mode tooltip
    if (isPFIMode && Object.keys(pfiDesaScores).length > 0) {
      const desa = getProp(props, 'desa') || '-';
      const kec = getProp(props, 'kecamatan') || '-';
      const score = pfiDesaScores[`${desa}__${kec}`];
      html = `
        <div style="margin-bottom:6px"><b>Desa:</b> ${desa}</div>
        <div style="margin-bottom:4px"><b>Kecamatan:</b> ${kec}</div>
        <div style="margin-top:6px;border-top:1px solid #334155;padding-top:6px">
          <b>Fragmentasi Politik:</b> 
          ${score !== undefined && score >= 0 ? `
            <br/><span style="color:${getPFIColor(score)};font-size:16px;font-weight:bold">${score.toFixed(1)}</span>
            <br/><span style="color:#cbd5e1;font-size:11px">${getPFICategory(score)}</span>
          ` : '<br/><span style="color:#94a3b8">Data tidak cukup</span>'}
        </div>
      `;
    }
    // Party mode tooltip
    else if (selectedParty && Object.keys(partyDesaPercentages).length > 0) {
      const desa = getProp(props, 'desa') || '-';
      const kec = getProp(props, 'kecamatan') || '-';
      const pct = partyDesaPercentages[`${desa}__${kec}`];
      html = `
        <div style="margin-bottom:6px"><b>Desa:</b> ${desa}</div>
        <div style="margin-bottom:4px"><b>Kecamatan:</b> ${kec}</div>
        <div style="margin-top:6px;border-top:1px solid #334155;padding-top:6px">
          <b>${selectedParty}:</b> 
          <span style="color:${pct !== undefined && pct >= 50 ? '#4ade80' : '#fb923c'}">
            ${pct !== undefined ? pct.toFixed(1) + '%' : 'Tidak ada data'}
          </span>
        </div>
      `;
    } else {
      const priorityKeys = ['Kabupaten', 'Kecamatan', 'Desa', 'name', 'KABUPATEN', 'KECAMATAN', 'DESA'];
      const foundKeys = Object.keys(props).filter(k =>
        priorityKeys.some(pk => pk.toLowerCase() === k.toLowerCase())
      );
      if (foundKeys.length > 0) {
        foundKeys.forEach(k => { html += `<div style="margin-bottom:4px"><b>${k}:</b> ${props[k]}</div>`; });
      } else {
        Object.keys(props).slice(0, 5).forEach(k => { html += `<div style="margin-bottom:4px"><b>${k}:</b> ${props[k]}</div>`; });
      }
    }

    return {
      html,
      style: {
        backgroundColor: '#1e293b', color: '#f8fafc', padding: '12px',
        borderRadius: '8px', fontSize: '13px',
        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)', border: '1px solid #334155',
      }
    };
  };

  const layers = [
    normalLayer,
    drawPolygonLayer,
    drawPathLayer,
    drawVerticesLayer,
  ].filter(Boolean);

  const handleDeckClick = (info: any) => {
    if (!drawMode || !onMapClick) return;
    const { coordinate } = info;
    if (coordinate) onMapClick(coordinate[0], coordinate[1]);
  };

  // ─── Counts for above/below filter ────────────────────────────────────────
  const aboveCount = Object.values(partyDesaPercentages).filter(p => p >= 50).length;
  const belowCount = Object.values(partyDesaPercentages).filter(p => p < 50).length;

  return (
    <div className="relative w-full h-full bg-slate-900 rounded-lg overflow-hidden border border-slate-800 shadow-xl">
      <DeckGL
        viewState={viewState}
        controller={drawMode ? { doubleClickZoom: false } : true}
        layers={layers as any}
        onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
        getTooltip={handleTooltip}
        onClick={handleDeckClick}
        style={{ cursor: drawMode ? 'crosshair' : 'default' }}
      >
        <Map
          mapLib={maplibregl as any}
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        >
          <NavigationControl position="bottom-right" />
          <FullscreenControl position="top-right" />
          <GeolocateControl position="bottom-right" />
          <ScaleControl position="bottom-left" />
        </Map>
      </DeckGL>

      {/* Brand overlay — becomes party insight panel when party is selected */}
      <div className={`absolute top-4 left-4 bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border shadow-xl text-white transition-all duration-300 ${
        selectedParty ? 'border-blue-500/40 w-64' : isPFIMode ? 'border-purple-500/40 w-64' : 'border-slate-700 pointer-events-none'
      }`}>
        <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400">
          GEO SmartMap
        </h2>

        {isPFIMode ? (
          /* ── PFI Legend Panel ── */
          <div className="mt-2">
            <p className="text-xs text-slate-400 mb-1">Index Fragmentasi Politik</p>
            <p className="text-sm font-bold text-purple-300 mb-3 truncate">Skala (0-100)</p>

            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getPFIColor(20) }} />
                <span className="text-slate-300">0-30: Dominan</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getPFIColor(40) }} />
                <span className="text-slate-300">31-50: Stabil</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getPFIColor(60) }} />
                <span className="text-slate-300">51-70: Kompetitif</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getPFIColor(80) }} />
                <span className="text-slate-300">71-100: Sangat Cair</span>
              </div>
            </div>
          </div>
        ) : !selectedParty ? (
          <>
            <p className="text-sm text-slate-400 mt-1">Interactive GeoJSON Platform</p>
            {(highlightedKec || highlightedDesa) && !drawMode && (
              <div className="mt-2 border-t border-slate-700 pt-2 flex flex-col gap-1">
                {highlightedKec === 'ALL' ? (
                  <p className="text-xs text-blue-400">📍 Seluruh Kabupaten</p>
                ) : (
                  <>
                    {highlightedKec && <p className="text-xs text-cyan-400">📍 Kec. {highlightedKec}</p>}
                    {highlightedDesa && <p className="text-xs text-green-400">📍 Desa {highlightedDesa}</p>}
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          /* ── Party Insight Panel ── */
          <div className="mt-2">
            <p className="text-xs text-slate-400 mb-1">Insight Suara</p>
            <p className="text-sm font-bold text-blue-300 mb-3 truncate">{selectedParty}</p>

            {/* Legend */}
            <div className="flex gap-2 mb-3 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-slate-300">≥ 50%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-orange-500" />
                <span className="text-slate-300">&lt; 50%</span>
              </div>
            </div>

            {/* Filter buttons */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => onPartyFilterChange?.(partyFilter === 'above50' ? null : 'above50')}
                className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${
                  partyFilter === 'above50'
                    ? 'bg-green-600 text-white border-green-400 shadow-lg shadow-green-900/40'
                    : 'bg-green-500/10 text-green-300 border-green-500/30 hover:bg-green-500/20'
                }`}
              >
                <span>▲ Di atas 50%</span>
                <span className="bg-green-900/60 px-2 py-0.5 rounded-full">{aboveCount} desa</span>
              </button>
              <button
                onClick={() => onPartyFilterChange?.(partyFilter === 'below50' ? null : 'below50')}
                className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${
                  partyFilter === 'below50'
                    ? 'bg-orange-600 text-white border-orange-400 shadow-lg shadow-orange-900/40'
                    : 'bg-orange-500/10 text-orange-300 border-orange-500/30 hover:bg-orange-500/20'
                }`}
              >
                <span>▼ Di bawah 50%</span>
                <span className="bg-orange-900/60 px-2 py-0.5 rounded-full">{belowCount} desa</span>
              </button>
            </div>

            {partyFilter && (
              <button
                onClick={() => onPartyFilterChange?.(null)}
                className="mt-2 w-full text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                ✕ Reset filter
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── Draw Mode Overlay ─────────────────────────────────────────────── */}
      {drawMode && (
        <>
          <div className="absolute top-0 left-0 right-0 bg-amber-500/90 backdrop-blur-sm text-slate-900 px-4 py-2.5 flex items-center justify-between z-20 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="text-lg">✏️</span>
              <div>
                <p className="font-bold text-sm">Mode Menggambar Aktif</p>
                <p className="text-xs opacity-80">
                  {drawingForLabel && <span className="font-semibold">{drawingForLabel}</span>}
                  {' — '}Klik pada peta untuk menambah titik. {drawingPoints.length} titik ditambahkan.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onUndoPoint}
                disabled={drawingPoints.length === 0}
                className="px-3 py-1 bg-slate-800/80 text-white text-xs rounded-lg hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                ↩ Undo
              </button>
              <button
                onClick={onFinishDraw}
                disabled={drawingPoints.length < 3}
                className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                ✓ Selesai ({drawingPoints.length >= 3 ? 'Simpan Polygon' : `Min. 3 titik`})
              </button>
              <button
                onClick={onCancelDraw}
                className="px-3 py-1 bg-red-600 text-white text-xs rounded-lg hover:bg-red-500 transition-all"
              >
                ✕ Batal
              </button>
            </div>
          </div>
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-slate-900/80 text-slate-300 text-xs px-4 py-2 rounded-full backdrop-blur-sm pointer-events-none z-20">
            🖱️ Klik untuk tambah titik sudut polygon desa
          </div>
        </>
      )}
    </div>
  );
}
