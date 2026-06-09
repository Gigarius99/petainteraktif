'use client';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MapViewer from '@/components/MapViewer';
import {
  Layers, Database, Activity, Share2, UploadCloud,
  LogOut, ChevronDown, ChevronRight, MapPin, Map, Download, PenLine, AlertTriangle
} from 'lucide-react';
import * as turf from '@turf/turf';

// ─── Helper: temukan key property case-insensitive ─────────────────────────
function getProp(props: any, key: string): string | null {
  if (!props) return null;
  const found = Object.keys(props).find(k => k.toLowerCase() === key.toLowerCase());
  return found ? String(props[found]) : null;
}

import { calculatePFI, calculateHHI, getPFICategory, getPFIColor } from '@/utils/pfi';

export default function Dashboard() {
  const [geoData, setGeoData] = useState<any>(null);
  const [flyToFeature, setFlyToFeature] = useState<any>(null);
  const [highlightedKec, setHighlightedKec] = useState<string | null>(null);
  const [highlightedDesa, setHighlightedDesa] = useState<string | null>(null);
  const [layerOpen, setLayerOpen] = useState(true);
  const [kecOpen, setKecOpen] = useState(false);
  const [desaOpen, setDesaOpen] = useState(false);
  const [selectedKec, setSelectedKec] = useState<string | null>(null);

  // New states for Spatial Analysis
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [pemilu2024Open, setPemilu2024Open] = useState(false);
  const [pemilu2019Open, setPemilu2019Open] = useState(false);
  
  const [selectedPemilu, setSelectedPemilu] = useState<'pemilu_2024' | 'pemilu_2019' | null>(null);
  const [selectedElection, setSelectedElection] = useState<'PPWP' | 'DPD' | 'DPR RI' | 'DPRD PROVINSI' | 'DPRD KABUPATEN' | null>(null);

  // ─── Draw Mode States ───────────────────────────────────────────────────
  const [drawMode, setDrawMode] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [drawingForDesa, setDrawingForDesa] = useState<string | null>(null);
  const [drawingForKec, setDrawingForKec] = useState<string | null>(null);
  const [missingGeoOpen, setMissingGeoOpen] = useState(false);
  const [hasUnsavedDraw, setHasUnsavedDraw] = useState(false);

  // ─── Party Insight States ──────────────────────────────────────────────
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [partyFilter, setPartyFilter] = useState<'above50' | 'below50' | null>(null);

  // ─── PFI States ────────────────────────────────────────────────────────
  const [pfiOpen, setPfiOpen] = useState(false);
  const [isPFIMode, setIsPFIMode] = useState(false);
  const [pfiClickedDesa, setPfiClickedDesa] = useState<{ desa: string; kec: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ─── Load last active layer on mount ───────────────────────────────────
  useEffect(() => {
    const layerId = localStorage.getItem('active_layer_id');
    if (layerId) fetchLayer(layerId);
  }, []);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const fetchLayer = async (layerId: string) => {
    try {
      const res = await fetch(`${API_URL}/geojson/layer/${layerId}`);
      if (res.ok) {
        const json = await res.json();
        setGeoData(json);
      }
    } catch (e) {
      console.error('Gagal mengambil layer', e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Sesi Anda sudah berakhir. Silakan login kembali.');
      router.push('/login');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_URL}/geojson/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      // Jika token expired / tidak valid → paksa login ulang
      if (res.status === 401) {
        document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        localStorage.removeItem('token');
        localStorage.removeItem('active_layer_id');
        alert('Sesi login Anda telah habis. Silakan login kembali.');
        router.push('/login');
        return;
      }

      // Baca body response untuk mendapatkan pesan error yang detail
      const data = await res.json();

      if (!res.ok) {
        const msg = data?.message || 'Gagal menyimpan ke database';
        throw new Error(msg);
      }

      // Sukses — simpan layer ID dan tampilkan di peta
      localStorage.setItem('active_layer_id', data.layerId);
      // Reset state kecamatan/desa lama sebelum load data baru
      setSelectedKec(null);
      setHighlightedKec(null);
      setHighlightedDesa(null);
      fetchLayer(data.layerId);

    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }

    e.target.value = '';
  };

  const handleLogout = () => {
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    localStorage.removeItem('token');
    localStorage.removeItem('active_layer_id');
    router.push('/login');
  };

  // ─── Derive daftar Kecamatan & Desa dari geoData ───────────────────────
  const { kecamatanList, desaByKec } = useMemo(() => {
    if (!geoData?.features) return { kecamatanList: [], desaByKec: {} };
    const kecSet = new Set<string>();
    const desaMap: Record<string, any[]> = {};

    geoData.features.forEach((f: any) => {
      const kec = getProp(f.properties, 'kecamatan');
      const desa = getProp(f.properties, 'desa');
      if (kec) {
        kecSet.add(kec);
        if (!desaMap[kec]) desaMap[kec] = [];
        if (desa) desaMap[kec].push(f);
      }
    });

    return {
      kecamatanList: Array.from(kecSet).sort(),
      desaByKec: desaMap,
    };
  }, [geoData]);

  // List desa yang sedang tampil (berdasarkan kecamatan yang dipilih)
  const desaList = useMemo(() => {
    if (!selectedKec || !desaByKec[selectedKec]) return [];
    return desaByKec[selectedKec].sort((a: any, b: any) => {
      const na = getProp(a.properties, 'desa') || '';
      const nb = getProp(b.properties, 'desa') || '';
      return na.localeCompare(nb);
    });
  }, [selectedKec, desaByKec]);

  // ─── Handler klik Kecamatan: fly ke kecamatan ──────────────────────────
  const handleKecClick = (kecName: string) => {
    setSelectedKec(kecName);
    setHighlightedKec(kecName);
    setHighlightedDesa(null);
    // Buat koleksi semua feature dalam kecamatan ini (atau semua jika ALL)
    let features: any[] = [];
    if (kecName === 'ALL') {
      features = geoData?.features || [];
    } else {
      features = desaByKec[kecName] || [];
    }
    
    if (features.length === 0) return;
    const fc = turf.featureCollection(features as any[]);
    try {
      const bbox = turf.bbox(fc);
      setFlyToFeature({ type: 'bbox', bbox });
    } catch {}
  };

  // ─── Aggregation Logic for Spatial Analysis ─────────────────────────────
  const aggregatedData = useMemo(() => {
    if (!selectedPemilu || !selectedElection || !geoData?.features) return null;

    let targetFeatures: any[] = [];
    if (highlightedDesa && selectedKec && selectedKec !== 'ALL') {
      targetFeatures = geoData.features.filter((f: any) => 
        getProp(f.properties, 'desa') === highlightedDesa && 
        getProp(f.properties, 'kecamatan') === selectedKec
      );
    } else if (selectedKec && selectedKec !== 'ALL') {
      targetFeatures = desaByKec[selectedKec] || [];
    } else if (selectedKec === 'ALL') {
      targetFeatures = geoData.features;
    } else {
      return null;
    }

    if (targetFeatures.length === 0) return null;

    const result = {
      total_tps: 0,
      total_suara_sah: 0,
      calon: {} as Record<string, number>
    };

    targetFeatures.forEach(f => {
      const props = f.properties;
      if (!props) return;
      
      const tps = parseInt(getProp(props, 'jumlah_tps') || '0', 10);
      if (!isNaN(tps)) result.total_tps += tps;

      const pemiluData = props[selectedPemilu] || props[selectedPemilu.toUpperCase()];
      if (pemiluData) {
        const electionData = pemiluData[selectedElection] || pemiluData[selectedElection.toUpperCase()];
        if (electionData) {
          result.total_suara_sah += (electionData.total_suara_sah || 0);
          
          if (electionData.calon) {
            Object.entries(electionData.calon).forEach(([nama, suara]) => {
              const val = Number(suara) || 0;
              if (!result.calon[nama]) result.calon[nama] = 0;
              result.calon[nama] += val;
            });
          }
        }
      }
    });

    const sortedCalon = Object.entries(result.calon).sort((a, b) => b[1] - a[1]);

    let regionName = 'Pilih Wilayah';
    if (highlightedDesa) regionName = `Desa ${highlightedDesa}, Kec. ${selectedKec}`;
    else if (selectedKec === 'ALL') regionName = 'Kabupaten Wonogiri (Seluruh Desa)';
    else if (selectedKec) regionName = `Kecamatan ${selectedKec}`;

    return { ...result, sortedCalon, regionName };
  }, [geoData, selectedKec, highlightedDesa, selectedPemilu, selectedElection, desaByKec]);

  // ─── Per-Desa Party Percentages for map highlight ───────────────────────
  const partyDesaPercentages = useMemo(() => {
    if (!selectedParty || !selectedPemilu || !selectedElection || !geoData?.features) return {};

    const result: Record<string, number> = {};
    geoData.features.forEach((f: any) => {
      const desa = getProp(f.properties, 'desa');
      const kec = getProp(f.properties, 'kecamatan');
      if (!desa || !kec) return;

      // ── Scope filter: hanya hitung desa sesuai pilihan aktif ──────────────
      if (highlightedDesa && selectedKec && selectedKec !== 'ALL') {
        // Mode desa: hanya highlight 1 desa spesifik
        if (desa !== highlightedDesa || kec !== selectedKec) return;
      } else if (selectedKec && selectedKec !== 'ALL') {
        // Mode kecamatan: hanya highlight desa-desa dalam kecamatan tersebut
        if (kec !== selectedKec) return;
      }
      // Mode ALL / Kabupaten → semua desa diikutsertakan

      const pemiluData = f.properties[selectedPemilu];
      if (!pemiluData) return;
      const electionData = pemiluData[selectedElection] || pemiluData[selectedElection?.toUpperCase?.()];
      if (!electionData) return;

      const totalSuaraSah = electionData.total_suara_sah || 0;
      const partyVotes = electionData.calon?.[selectedParty] || 0;
      if (totalSuaraSah > 0) {
        result[`${desa}__${kec}`] = (partyVotes / totalSuaraSah) * 100;
      }
    });
    return result;
  }, [selectedParty, selectedPemilu, selectedElection, geoData, selectedKec, highlightedDesa]);

  // ─── Per-Desa PFI Scores for map heatmap ──────────────────────────────────
  const pfiDesaScores = useMemo(() => {
    if (!isPFIMode || !selectedPemilu || !selectedElection || !geoData?.features) return {};

    const result: Record<string, number> = {};
    geoData.features.forEach((f: any) => {
      const desa = getProp(f.properties, 'desa');
      const kec = getProp(f.properties, 'kecamatan');
      if (!desa || !kec) return;

      // Scope filter: hanya hitung desa sesuai pilihan aktif
      if (highlightedDesa && selectedKec && selectedKec !== 'ALL') {
        if (desa !== highlightedDesa || kec !== selectedKec) return;
      } else if (selectedKec && selectedKec !== 'ALL') {
        if (kec !== selectedKec) return;
      }

      const pemiluData = f.properties[selectedPemilu];
      if (!pemiluData) return;
      const electionData = pemiluData[selectedElection] || pemiluData[selectedElection?.toUpperCase?.()];
      if (!electionData || !electionData.calon) return;

      const votes = Object.values(electionData.calon).map(v => Number(v) || 0);
      result[`${desa}__${kec}`] = calculatePFI(votes);
    });
    return result;
  }, [isPFIMode, selectedPemilu, selectedElection, geoData, selectedKec, highlightedDesa]);

  // ─── Overall PFI for currently selected region ───────────────────────────
  const aggregatedPfi = useMemo(() => {
    if (!isPFIMode || !aggregatedData) return null;
    const votes = aggregatedData.sortedCalon.map(c => c[1]);
    const score = calculatePFI(votes);
    const hhi = calculateHHI(votes);
    
    // Sort desas by PFI for ranking if we have multiple desas
    let sortedDesas: [string, number][] = [];
    if (!highlightedDesa) {
       sortedDesas = Object.entries(pfiDesaScores)
        .filter(([, s]) => s >= 0)
        .sort((a, b) => b[1] - a[1]);
    }

    return {
      score,
      hhi,
      category: getPFICategory(score),
      color: getPFIColor(score),
      topFragmented: sortedDesas.slice(0, 10),
      topDominant: [...sortedDesas].reverse().slice(0, 10)
    };
  }, [isPFIMode, aggregatedData, pfiDesaScores, highlightedDesa]);

  // ─── PFI Clicked Desa Detail ──────────────────────────────────────────────
  const pfiClickedDesaDetail = useMemo(() => {
    if (!isPFIMode || !pfiClickedDesa || !geoData?.features || !selectedPemilu || !selectedElection) return null;

    const feature = geoData.features.find((f: any) => {
      const d = getProp(f.properties, 'desa');
      const k = getProp(f.properties, 'kecamatan');
      return d === pfiClickedDesa.desa && k === pfiClickedDesa.kec;
    });
    if (!feature) return null;

    const props = feature.properties;
    const pemiluData = props[selectedPemilu];
    if (!pemiluData) return null;
    const electionData = pemiluData[selectedElection] || pemiluData[selectedElection?.toUpperCase?.()];
    if (!electionData || !electionData.calon) return null;

    const totalSuaraSah: number = electionData.total_suara_sah || 0;
    const sortedCalon: [string, number][] = Object.entries(electionData.calon)
      .map(([n, v]) => [n, Number(v) || 0] as [string, number])
      .sort((a, b) => b[1] - a[1]);

    const votes = sortedCalon.map(c => c[1]);
    const pfiScore = calculatePFI(votes);
    const hhi = calculateHHI(votes);

    return {
      desa: pfiClickedDesa.desa,
      kec: pfiClickedDesa.kec,
      pfiScore,
      hhi,
      category: getPFICategory(pfiScore),
      color: getPFIColor(pfiScore),
      totalSuaraSah,
      sortedCalon,
    };
  }, [isPFIMode, pfiClickedDesa, geoData, selectedPemilu, selectedElection]);

  // Toggle party selection; reset filter when switching party
  const handlePartyClick = useCallback((partyName: string) => {
    setSelectedParty(prev => {
      if (prev === partyName) {
        setPartyFilter(null);
        return null;
      }
      setPartyFilter(null);
      return partyName;
    });
  }, []);

  // ─── Handler klik Desa: fly ke desa spesifik ────────────────────────────
  const handleDesaClick = (feature: any) => {
    try {
      const desaName = getProp(feature.properties, 'desa');
      if (desaName) setHighlightedDesa(desaName);
      if (feature.geometry) {
        const center = turf.center(feature);
        setFlyToFeature({
          type: 'center',
          longitude: center.geometry.coordinates[0],
          latitude: center.geometry.coordinates[1],
          zoom: 13,
        });
      }
    } catch {}
  };

  // ─── Detect features without geometry ───────────────────────────────────
  const missingGeoFeatures = useMemo(() => {
    if (!geoData?.features) return [];
    return geoData.features.filter((f: any) => {
      if (!f.geometry) return true;
      if (!f.geometry.coordinates && f.geometry.type !== 'GeometryCollection') return true;
      if (f.geometry.type === 'GeometryCollection' && (!f.geometry.geometries || f.geometry.geometries.length === 0)) return true;
      return false;
    });
  }, [geoData]);

  // ─── Draw Mode Handlers ──────────────────────────────────────────────────
  const startDrawForDesa = useCallback((feature: any) => {
    const desaName = getProp(feature.properties, 'desa');
    const kecName = getProp(feature.properties, 'kecamatan');
    setDrawingForDesa(desaName);
    setDrawingForKec(kecName);
    setDrawingPoints([]);
    setDrawMode(true);
  }, []);

  const handleMapClick = useCallback((lng: number, lat: number) => {
    setDrawingPoints(prev => [...prev, [lng, lat]]);
  }, []);

  const handleUndoPoint = useCallback(() => {
    setDrawingPoints(prev => prev.slice(0, -1));
  }, []);

  const handleCancelDraw = useCallback(() => {
    setDrawMode(false);
    setDrawingPoints([]);
    setDrawingForDesa(null);
    setDrawingForKec(null);
  }, []);

  const handleFinishDraw = useCallback(() => {
    if (drawingPoints.length < 3 || !drawingForDesa || !drawingForKec) return;

    // Close the polygon (first point = last point)
    const closedRing = [...drawingPoints, drawingPoints[0]];
    const newGeometry = {
      type: 'Polygon',
      coordinates: [closedRing],
    };

    // Update geoData: find the matching feature and set its geometry
    setGeoData((prev: any) => {
      if (!prev?.features) return prev;
      const updated = prev.features.map((f: any) => {
        const fDesa = getProp(f.properties, 'desa');
        const fKec = getProp(f.properties, 'kecamatan');
        
        // Remove the !f.geometry check so it can override empty GeometryCollection
        if (fDesa === drawingForDesa && fKec === drawingForKec) {
          return { ...f, geometry: newGeometry };
        }
        return f;
      });
      return { ...prev, features: updated };
    });

    // Fly to the new polygon
    try {
      const fc = turf.featureCollection([{
        type: 'Feature' as const,
        properties: {},
        geometry: newGeometry as any,
      }]);
      const bbox = turf.bbox(fc);
      setFlyToFeature({ type: 'bbox', bbox });
    } catch {}

    setHasUnsavedDraw(true);
    setDrawMode(false);
    setDrawingPoints([]);
    setDrawingForDesa(null);
    setDrawingForKec(null);
  }, [drawingPoints, drawingForDesa, drawingForKec]);

  // ─── Export updated GeoJSON ──────────────────────────────────────────────
  const handleDownloadGeoJSON = useCallback(() => {
    if (!geoData) return;
    const json = JSON.stringify(geoData, null, 2);
    const blob = new Blob([json], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'updated_geojson.geojson';
    a.click();
    URL.revokeObjectURL(url);
    setHasUnsavedDraw(false);
  }, [geoData]);

  return (
    <div className="flex h-screen w-full bg-slate-950 overflow-hidden text-slate-100">
      {/* ── Sidebar ── */}
      <aside className="w-72 border-r border-slate-800 bg-slate-900/60 flex flex-col pt-5 overflow-hidden">
        {/* Logo */}
        <div className="px-5 mb-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-gradient-to-tr from-blue-500 to-cyan-400 shadow-lg shadow-blue-500/20 flex items-center justify-center shrink-0">
            <span className="font-bold text-white tracking-tighter">G</span>
          </div>
          <span className="font-bold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-100 to-slate-300">SmartMap</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 w-full px-3 space-y-1 overflow-y-auto scrollbar-thin scrollbar-track-slate-900 scrollbar-thumb-slate-700">
          <input type="file" accept=".geojson,.json" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />

          {/* ── Layer Manager (collapsible) ── */}
          <button
            onClick={() => setLayerOpen(!layerOpen)}
            className="w-full flex items-center gap-3 p-3 px-4 rounded-lg transition-all duration-200 group bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-inner"
          >
            <Layers size={20} className="shrink-0" />
            <span className="font-medium text-sm flex-1 text-left">Layer Manager</span>
            {layerOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {/* ── Submenu Layer Manager ── */}
          {layerOpen && geoData && (
            <div className="ml-3 border-l border-slate-700 pl-2 space-y-1">

              {/* ── Kecamatan ── */}
              <button
                onClick={() => setKecOpen(!kecOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-all text-sm"
              >
                <Map size={15} className="text-cyan-400 shrink-0" />
                <span className="flex-1 text-left font-medium">Kecamatan</span>
                <span className="text-xs text-slate-500 mr-1">{kecamatanList.length}</span>
                {kecOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {kecOpen && (
                <div className="ml-2 space-y-0.5 max-h-48 overflow-y-auto pr-1">
                  <button
                    onClick={() => handleKecClick('ALL')}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                      selectedKec === 'ALL'
                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30 font-bold'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-slate-200 font-bold'
                    }`}
                  >
                    🌟 Kab. Wonogiri (Semua)
                  </button>
                  <div className="h-px bg-slate-700/50 my-1 mx-2" />
                  {kecamatanList.map(kec => (
                    <button
                      key={kec}
                      onClick={() => handleKecClick(kec)}
                      className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                        selectedKec === kec
                          ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {kec}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Desa ── */}
              <button
                onClick={() => setDesaOpen(!desaOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-all text-sm"
              >
                <MapPin size={15} className="text-green-400 shrink-0" />
                <span className="flex-1 text-left font-medium">Desa</span>
                {selectedKec === 'ALL'
                  ? <span className="text-xs text-slate-500 mr-1 italic">Semua Desa</span>
                  : selectedKec
                  ? <span className="text-xs text-slate-500 mr-1">{desaList.length} di {selectedKec}</span>
                  : <span className="text-xs text-slate-500 mr-1 italic">Pilih Kecamatan dulu</span>
                }
                {desaOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {desaOpen && (
                <div className="ml-2 space-y-0.5">
                  {selectedKec === 'ALL' ? (
                    <p className="text-xs text-slate-500 italic px-3 py-2">
                      Semua desa di Kabupaten dipilih.
                    </p>
                  ) : desaList.length === 0 ? (
                    <p className="text-xs text-slate-500 italic px-3 py-2">
                      {selectedKec ? 'Tidak ada desa ditemukan.' : 'Klik salah satu Kecamatan terlebih dahulu.'}
                    </p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto pr-1 space-y-0.5">
                      {desaList.map((f: any, i: number) => {
                        const desaName = getProp(f.properties, 'desa') || `Desa ${i + 1}`;
                        return (
                          <button
                            key={i}
                            onClick={() => handleDesaClick(f)}
                            className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                              highlightedDesa === desaName
                                ? 'bg-green-600/20 text-green-300 border border-green-500/30'
                                : 'text-slate-400 hover:bg-slate-800 hover:text-green-300'
                            }`}
                          >
                            {desaName}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {layerOpen && !geoData && (
            <div className="ml-3 border-l border-slate-700 pl-4 py-2">
              <p className="text-xs text-slate-500 italic">Belum ada data. Import GeoJSON terlebih dahulu.</p>
            </div>
          )}

          {/* ── Missing Geometry Section ── */}
          {geoData && missingGeoFeatures.length > 0 && (
            <>
              <button
                onClick={() => setMissingGeoOpen(!missingGeoOpen)}
                className="w-full flex items-center gap-3 p-3 px-4 rounded-lg transition-all duration-200 group bg-amber-500/10 text-amber-400 border border-amber-500/20"
              >
                <AlertTriangle size={18} className="shrink-0" />
                <span className="font-medium text-sm flex-1 text-left">Desa Tanpa Peta</span>
                <span className="text-xs bg-amber-500/20 px-1.5 py-0.5 rounded-full">{missingGeoFeatures.length}</span>
                {missingGeoOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {missingGeoOpen && (
                <div className="ml-3 border-l border-amber-500/20 pl-2 space-y-1">
                  <p className="text-xs text-slate-500 italic px-2 py-1">Klik ✏️ untuk menggambar batas desa di peta</p>
                  {missingGeoFeatures.map((f: any, i: number) => {
                    const desaName = getProp(f.properties, 'desa') || `Desa ${i + 1}`;
                    const kecName = getProp(f.properties, 'kecamatan') || '';
                    return (
                      <div key={i} className="flex items-center gap-1 pr-1">
                        <span className="flex-1 text-xs text-amber-300 px-2 py-1 truncate">
                          {desaName}
                          <span className="text-slate-500 ml-1 text-xs">{kecName}</span>
                        </span>
                        <button
                          onClick={() => startDrawForDesa(f)}
                          title={`Gambar batas ${desaName}`}
                          className="shrink-0 p-1.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/40 hover:text-amber-100 transition-all"
                        >
                          <PenLine size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Menu lain ── */}
          <SidebarItem icon={<UploadCloud size={20} />} label="Import Data" onClick={() => fileInputRef.current?.click()} />
          
          {/* ── Spatial Analysis (collapsible) ── */}
          <button
            onClick={() => setAnalysisOpen(!analysisOpen)}
            className={`w-full flex items-center gap-3 p-3 px-4 rounded-lg transition-all duration-200 group ${
              analysisOpen
                ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-inner'
                : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
            }`}
          >
            <Activity size={20} className="shrink-0 transition-transform group-hover:scale-110" />
            <span className="font-medium text-sm flex-1 text-left">Spatial Analysis</span>
            {analysisOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {analysisOpen && (
            <div className="ml-3 border-l border-slate-700 pl-2 space-y-1">
              {/* Pemilu 2024 */}
              <button
                onClick={() => setPemilu2024Open(!pemilu2024Open)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-all text-sm"
              >
                <span className="flex-1 text-left font-medium">Pemilu 2024</span>
                {pemilu2024Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {pemilu2024Open && (
                <div className="ml-2 space-y-0.5">
                  {['PPWP', 'DPD', 'DPR RI', 'DPRD PROVINSI', 'DPRD KABUPATEN'].map(election => (
                    <button
                      key={election}
                      onClick={() => { setSelectedPemilu('pemilu_2024'); setSelectedElection(election as any); setIsPFIMode(false); }}
                      className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                        selectedPemilu === 'pemilu_2024' && selectedElection === election && !isPFIMode
                          ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-blue-300'
                      }`}
                    >
                      {election}
                    </button>
                  ))}
                </div>
              )}
              {/* Political Fragmentation Index (PFI) */}
              <button
                onClick={() => setPfiOpen(!pfiOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-all text-sm"
              >
                <span className="flex-1 text-left font-medium">Political Fragmentation Index</span>
                {pfiOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {pfiOpen && (
                <div className="ml-2 space-y-0.5">
                  {['PPWP', 'DPD', 'DPR RI', 'DPRD PROVINSI', 'DPRD KABUPATEN'].map(election => (
                    <button
                      key={election}
                      onClick={() => { 
                        setSelectedPemilu('pemilu_2024'); 
                        setSelectedElection(election as any); 
                        setIsPFIMode(true);
                        setSelectedParty(null);
                        setPartyFilter(null);
                      }}
                      className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                        selectedPemilu === 'pemilu_2024' && selectedElection === election && isPFIMode
                          ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-purple-300'
                      }`}
                    >
                      {election}
                    </button>
                  ))}
                </div>
              )}
              {/* Pemilu 2019 */}
              <button
                onClick={() => setPemilu2019Open(!pemilu2019Open)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-all text-sm"
              >
                <span className="flex-1 text-left font-medium">Pemilu 2019</span>
                {pemilu2019Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {pemilu2019Open && (
                <div className="ml-2 space-y-0.5">
                  {['PPWP', 'DPD', 'DPR RI', 'DPRD PROVINSI', 'DPRD KABUPATEN'].map(election => (
                    <button
                      key={election}
                      onClick={() => { setSelectedPemilu('pemilu_2019'); setSelectedElection(election as any); setIsPFIMode(false); }}
                      className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                        selectedPemilu === 'pemilu_2019' && selectedElection === election
                          ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-blue-300'
                      }`}
                    >
                      {election}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <SidebarItem icon={<Database size={20} />} label="Data Store" />
          <SidebarItem icon={<Share2 size={20} />} label="Collaboration" />
        </nav>

        <div className="w-full px-3 pb-4 space-y-1">
          {hasUnsavedDraw && (
            <button
              onClick={handleDownloadGeoJSON}
              className="w-full flex items-center gap-2 p-2.5 px-4 rounded-lg bg-green-600/20 text-green-300 border border-green-500/30 hover:bg-green-600/30 transition-all text-sm font-medium animate-pulse"
            >
              <Download size={16} className="shrink-0" />
              <span className="text-xs">Download GeoJSON Terbaru</span>
            </button>
          )}
          <SidebarItem icon={<LogOut size={20} />} label="Logout" onClick={handleLogout} />
        </div>
      </aside>

      {/* ── Main Map ── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden p-2 lg:p-4 relative">
        <div className="flex-1 rounded-xl overflow-hidden shadow-2xl relative border border-slate-800/60 ring-1 ring-white/5">
          <MapViewer
            geoData={geoData}
            flyToFeature={flyToFeature}
            highlightedKec={highlightedKec}
            highlightedDesa={highlightedDesa}
            drawMode={drawMode}
            drawingPoints={drawingPoints}
            onMapClick={handleMapClick}
            onFinishDraw={handleFinishDraw}
            onCancelDraw={handleCancelDraw}
            onUndoPoint={handleUndoPoint}
            drawingForLabel={drawingForDesa ? `Desa ${drawingForDesa}, Kec. ${drawingForKec}` : undefined}
            selectedParty={selectedParty}
            partyFilter={partyFilter}
            partyDesaPercentages={partyDesaPercentages}
            onPartyFilterChange={setPartyFilter}
            isPFIMode={isPFIMode}
            pfiDesaScores={pfiDesaScores}
            onPfiDesaClick={(desa, kec) => setPfiClickedDesa({ desa, kec })}
          />
          
          {/* ── Floating Spatial Analysis Panel ── */}
          {aggregatedData && (
            <div className="absolute top-4 right-4 w-80 bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-700 shadow-2xl p-4 flex flex-col max-h-[85vh] overflow-hidden text-slate-200 z-10">
              <div className="flex items-center justify-between mb-3 border-b border-slate-700 pb-2">
                <h3 className="font-bold text-lg text-blue-400">
                  {isPFIMode ? 'Fragmentasi (PFI)' : 'Analisis'} - {selectedElection}
                </h3>
                <button onClick={() => { setSelectedElection(null); setSelectedParty(null); setPartyFilter(null); setIsPFIMode(false); setPfiClickedDesa(null); }} className="text-slate-400 hover:text-white transition-colors">&times;</button>
              </div>
              
              <div className="text-sm mb-4">
                <p className="text-cyan-300 font-semibold mb-2">📍 {aggregatedData.regionName}</p>
                <div className="flex justify-between items-center bg-slate-800/60 p-2.5 rounded-t border border-slate-700/50">
                  <span className="text-slate-400">Total TPS</span>
                  <span className="font-bold text-slate-200">{aggregatedData.total_tps.toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-800/60 p-2.5 rounded-b border border-slate-700/50 border-t-0">
                  <span className="text-slate-400">Total Suara Sah</span>
                  <span className="font-bold text-slate-200">{aggregatedData.total_suara_sah.toLocaleString('id-ID')}</span>
                </div>
              </div>
              
              {isPFIMode && aggregatedPfi ? (
                <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">

                  {/* ── Clicked Desa Detail View ── */}
                  {pfiClickedDesaDetail ? (
                    <>
                      {/* Back button */}
                      <button
                        onClick={() => setPfiClickedDesa(null)}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 mb-3 transition-colors"
                      >
                        ← Kembali ke Ringkasan
                      </button>

                      {/* Desa header */}
                      <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 mb-4 shadow-inner">
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Desa</p>
                        <p className="text-base font-bold text-white">{pfiClickedDesaDetail.desa}</p>
                        <p className="text-xs text-slate-400">Kec. {pfiClickedDesaDetail.kec}</p>

                        <div className="mt-3 pt-3 border-t border-slate-700/50 text-center">
                          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Skor PFI</p>
                          <p className="text-3xl font-bold" style={{ color: pfiClickedDesaDetail.color }}>
                            {pfiClickedDesaDetail.pfiScore.toFixed(1)}
                          </p>
                          <div
                            className="text-xs font-semibold px-2 py-1 rounded-full inline-block mt-1"
                            style={{ backgroundColor: `${pfiClickedDesaDetail.color}20`, color: pfiClickedDesaDetail.color, border: `1px solid ${pfiClickedDesaDetail.color}40` }}
                          >
                            {pfiClickedDesaDetail.category}
                          </div>
                          <p className="text-xs text-slate-500 mt-2">
                            HHI: {pfiClickedDesaDetail.hhi.toFixed(4)} &bull; Total Suara: {pfiClickedDesaDetail.totalSuaraSah.toLocaleString('id-ID')}
                          </p>
                        </div>
                      </div>

                      {/* Vote breakdown per candidate */}
                      <h4 className="font-semibold text-xs text-slate-300 mb-2 uppercase tracking-wide">Persebaran Suara Calon</h4>
                      <div className="space-y-2">
                        {pfiClickedDesaDetail.sortedCalon.map(([nama, suara], idx) => {
                          const pct = pfiClickedDesaDetail.totalSuaraSah > 0
                            ? (suara / pfiClickedDesaDetail.totalSuaraSah) * 100
                            : 0;
                          // Color bar based on vote share
                          const barColor = pct >= 50 ? '#22c55e' : pct >= 25 ? '#eab308' : pct >= 10 ? '#f97316' : '#64748b';
                          return (
                            <div key={idx} className="bg-slate-800/30 border border-slate-700/30 rounded p-2">
                              <div className="flex justify-between items-baseline text-xs mb-1.5">
                                <span className="font-medium text-slate-200 pr-2 truncate max-w-[60%]">{idx + 1}. {nama}</span>
                                <span className="font-bold text-slate-100 shrink-0">
                                  {suara.toLocaleString('id-ID')}
                                  <span className="text-slate-400 font-normal ml-1">({pct.toFixed(1)}%)</span>
                                </span>
                              </div>
                              <div className="w-full bg-slate-900/80 rounded-full h-1.5">
                                <div
                                  className="h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: `${pct}%`, backgroundColor: barColor }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    /* ── Aggregated Ranking View (default) ── */
                    <>
                      {aggregatedPfi.score < 0 ? (
                        <div className="p-4 bg-slate-800/60 border border-slate-700/50 rounded-lg text-center">
                          <p className="text-sm text-slate-400">Data tidak cukup untuk menghitung PFI di wilayah ini.</p>
                        </div>
                      ) : (
                        <>
                          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 mb-4 text-center shadow-inner">
                            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Skor PFI</p>
                            <p className="text-4xl font-bold mb-1" style={{ color: aggregatedPfi.color }}>
                              {aggregatedPfi.score.toFixed(1)}
                            </p>
                            <div
                              className="text-xs font-semibold px-2 py-1 rounded-full inline-block mt-1"
                              style={{ backgroundColor: `${aggregatedPfi.color}20`, color: aggregatedPfi.color, border: `1px solid ${aggregatedPfi.color}40` }}
                            >
                              {aggregatedPfi.category}
                            </div>
                            <p className="text-xs text-slate-500 mt-3 pt-2 border-t border-slate-700/50">
                              HHI: {aggregatedPfi.hhi.toFixed(4)} &bull; {aggregatedData.sortedCalon.length} Calon
                            </p>
                          </div>

                          <p className="text-xs text-slate-500 italic mb-3">💡 Klik desa di peta untuk lihat detail</p>

                          {!highlightedDesa && aggregatedPfi.topFragmented.length > 0 && (
                            <div className="mb-4">
                              <h4 className="font-semibold text-xs text-slate-300 mb-2 uppercase tracking-wide">Desa Paling Cair (Fragmentasi Tinggi)</h4>
                              <div className="space-y-1.5">
                                {aggregatedPfi.topFragmented.slice(0, 5).map(([id, score], idx) => {
                                  const [desa, kec] = id.split('__');
                                  return (
                                    <button
                                      key={idx}
                                      onClick={() => setPfiClickedDesa({ desa, kec })}
                                      className="flex justify-between items-center text-xs bg-slate-800/30 hover:bg-slate-700/50 p-1.5 rounded w-full transition-colors"
                                    >
                                      <span className="text-slate-300 truncate pr-2">{idx + 1}. {desa}</span>
                                      <span className="font-mono font-medium shrink-0" style={{ color: getPFIColor(score) }}>{score.toFixed(1)}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {!highlightedDesa && aggregatedPfi.topDominant.length > 0 && (
                            <div className="mb-4">
                              <h4 className="font-semibold text-xs text-slate-300 mb-2 uppercase tracking-wide">Desa Paling Stabil (Dominan)</h4>
                              <div className="space-y-1.5">
                                {aggregatedPfi.topDominant.slice(0, 5).map(([id, score], idx) => {
                                  const [desa, kec] = id.split('__');
                                  return (
                                    <button
                                      key={idx}
                                      onClick={() => setPfiClickedDesa({ desa, kec })}
                                      className="flex justify-between items-center text-xs bg-slate-800/30 hover:bg-slate-700/50 p-1.5 rounded w-full transition-colors"
                                    >
                                      <span className="text-slate-300 truncate pr-2">{idx + 1}. {desa}</span>
                                      <span className="font-mono font-medium shrink-0" style={{ color: getPFIColor(score) }}>{score.toFixed(1)}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <>
                  <h4 className="font-semibold text-sm mb-2 text-slate-300 border-b border-slate-700 pb-2">
                    Perolehan Suara Calon
                    {selectedParty && <span className="text-xs text-blue-400 ml-2 font-normal">({selectedParty} dipilih)</span>}
                  </h4>
                  <p className="text-xs text-slate-500 italic mb-2">Klik kartu untuk highlight di peta</p>
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
                    {aggregatedData.sortedCalon.map(([nama, suara]: [string, number], idx: number) => {
                      const pct = aggregatedData.total_suara_sah > 0 ? (suara / aggregatedData.total_suara_sah) * 100 : 0;
                      const isSelected = selectedParty === nama;
                      return (
                        <button
                          key={idx}
                          onClick={() => handlePartyClick(nama)}
                          className={`w-full text-left rounded p-2.5 border transition-all duration-200 ${
                            isSelected
                              ? 'bg-blue-600/25 border-blue-400/60 ring-1 ring-blue-400/40 shadow-lg shadow-blue-900/20'
                              : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-700/60 hover:border-slate-500/60'
                          }`}
                        >
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className={`font-medium pr-2 ${isSelected ? 'text-blue-200' : 'text-slate-200'}`}>
                              {isSelected && <span className="mr-1">📍</span>}{nama}
                            </span>
                            <span className="font-bold text-blue-300">
                              {suara.toLocaleString('id-ID')}
                              <span className="text-slate-400 font-normal ml-1">
                                ({pct.toFixed(1)}%)
                              </span>
                            </span>
                          </div>
                          {/* Progress Bar */}
                          <div className="w-full bg-slate-900 rounded-full h-1.5 ring-1 ring-slate-700/50">
                            <div
                              className={`h-1.5 rounded-full ${isSelected ? 'bg-gradient-to-r from-blue-400 to-cyan-300' : 'bg-gradient-to-r from-blue-500 to-cyan-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                    {aggregatedData.sortedCalon.length === 0 && (
                      <p className="text-xs text-slate-500 italic text-center py-6">Data tidak tersedia untuk wilayah ini.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active = false, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 px-4 rounded-lg transition-all duration-200 group ${
        active
          ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-inner'
          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
      }`}
    >
      <span className="shrink-0 transition-transform group-hover:scale-110">{icon}</span>
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
}
