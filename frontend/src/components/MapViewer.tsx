'use client';

import { useState, useEffect } from 'react';
import Map, { NavigationControl, FullscreenControl, ScaleControl, GeolocateControl } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import * as turf from '@turf/turf';

// Helper: get property case-insensitive
function getProp(props: any, key: string): string | null {
  if (!props) return null;
  const found = Object.keys(props).find(k => k.toLowerCase() === key.toLowerCase());
  return found ? String(props[found]) : null;
}

interface MapViewerProps {
  geoData?: any;
  flyToFeature?: any;     // { type: 'bbox', bbox: [...] } | { type: 'center', longitude, latitude, zoom }
  highlightedKec?: string | null;
  highlightedDesa?: string | null;
}

export default function MapViewer({ geoData, flyToFeature, highlightedKec, highlightedDesa }: MapViewerProps) {
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
        const center = turf.center(geoData);
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
        // Estimate zoom from bbox span
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

  // Layer: normal features
  const normalLayer = new GeoJsonLayer({
    id: 'geojson-layer',
    data: dataToRender,
    pickable: true,
    stroked: true,
    filled: true,
    extruded: false,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    getFillColor: (f: any) => {
      if (highlightedDesa && getProp(f.properties, 'desa') === highlightedDesa && getProp(f.properties, 'kecamatan') === highlightedKec) {
        return [50, 255, 150, 200]; // green highlight for desa
      }
      if (highlightedKec && getProp(f.properties, 'kecamatan') === highlightedKec) {
        return [100, 200, 255, 160]; // cyan highlight for kecamatan
      }
      return [160, 160, 180, 130];
    },
    getLineColor: (f: any) => {
      if (highlightedDesa && getProp(f.properties, 'desa') === highlightedDesa && getProp(f.properties, 'kecamatan') === highlightedKec) {
        return [100, 255, 150, 255];
      }
      if (highlightedKec && getProp(f.properties, 'kecamatan') === highlightedKec) {
        return [100, 220, 255, 255];
      }
      return [255, 255, 255, 200];
    },
    getLineWidth: (f: any) => {
      if (highlightedDesa && getProp(f.properties, 'desa') === highlightedDesa && getProp(f.properties, 'kecamatan') === highlightedKec) {
        return 3;
      }
      if (highlightedKec && getProp(f.properties, 'kecamatan') === highlightedKec) {
        return 2.5;
      }
      return 1.5;
    },
    updateTriggers: {
      getFillColor: [highlightedKec, highlightedDesa],
      getLineColor: [highlightedKec, highlightedDesa],
      getLineWidth: [highlightedKec, highlightedDesa],
    },
    autoHighlight: true,
    highlightColor: [255, 255, 0, 255],
  });

  const handleTooltip = ({ object }: any) => {
    if (!object) return null;
    const props = object.properties;
    if (!props) return null;

    let html = '';
    const priorityKeys = ['Kabupaten', 'Kecamatan', 'Desa', 'name', 'KABUPATEN', 'KECAMATAN', 'DESA'];
    const foundKeys = Object.keys(props).filter(k =>
      priorityKeys.some(pk => pk.toLowerCase() === k.toLowerCase())
    );

    if (foundKeys.length > 0) {
      foundKeys.forEach(k => {
        html += `<div style="margin-bottom:4px"><b>${k}:</b> ${props[k]}</div>`;
      });
    } else {
      Object.keys(props).slice(0, 5).forEach(k => {
        html += `<div style="margin-bottom:4px"><b>${k}:</b> ${props[k]}</div>`;
      });
    }

    return {
      html,
      style: {
        backgroundColor: '#1e293b',
        color: '#f8fafc',
        padding: '12px',
        borderRadius: '8px',
        fontSize: '13px',
        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)',
        border: '1px solid #334155',
      }
    };
  };

  return (
    <div className="relative w-full h-full bg-slate-900 rounded-lg overflow-hidden border border-slate-800 shadow-xl">
      <DeckGL
        viewState={viewState}
        controller={true}
        layers={[normalLayer]}
        onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
        getTooltip={handleTooltip}
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

      {/* Brand overlay */}
      <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-md p-4 rounded-lg border border-slate-700 text-white shadow-lg pointer-events-none">
        <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400">GEO SmartMap</h2>
        <p className="text-sm text-slate-400 mt-1">Interactive GeoJSON Platform</p>
        {(highlightedKec || highlightedDesa) && (
          <div className="mt-2 border-t border-slate-700 pt-2 flex flex-col gap-1">
            {highlightedKec && <p className="text-xs text-cyan-400">📍 Kec. {highlightedKec}</p>}
            {highlightedDesa && <p className="text-xs text-green-400">📍 Desa {highlightedDesa}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
