'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import MapViewer from '@/components/MapViewer';
import {
  Layers, Database, Activity, Share2, UploadCloud,
  LogOut, ChevronDown, ChevronRight, MapPin, Map
} from 'lucide-react';
import * as turf from '@turf/turf';

// ─── Helper: temukan key property case-insensitive ─────────────────────────
function getProp(props: any, key: string): string | null {
  if (!props) return null;
  const found = Object.keys(props).find(k => k.toLowerCase() === key.toLowerCase());
  return found ? String(props[found]) : null;
}

export default function Dashboard() {
  const [geoData, setGeoData] = useState<any>(null);
  const [flyToFeature, setFlyToFeature] = useState<any>(null);
  const [highlightedKec, setHighlightedKec] = useState<string | null>(null);
  const [highlightedDesa, setHighlightedDesa] = useState<string | null>(null);
  const [layerOpen, setLayerOpen] = useState(true);
  const [kecOpen, setKecOpen] = useState(false);
  const [desaOpen, setDesaOpen] = useState(false);
  const [selectedKec, setSelectedKec] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ─── Load last active layer on mount ───────────────────────────────────
  useEffect(() => {
    const layerId = localStorage.getItem('active_layer_id');
    if (layerId) fetchLayer(layerId);
  }, []);

  const fetchLayer = async (layerId: string) => {
    try {
      const res = await fetch(`http://localhost:3000/geojson/layer/${layerId}`);
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
      const res = await fetch('http://localhost:3000/geojson/upload', {
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
    // Buat koleksi semua feature dalam kecamatan ini
    const features = desaByKec[kecName] || [];
    if (features.length === 0) return;
    const fc = { type: 'FeatureCollection', features };
    try {
      const bbox = turf.bbox(fc);
      setFlyToFeature({ type: 'bbox', bbox });
    } catch {}
  };

  // ─── Handler klik Desa: fly ke desa spesifik ────────────────────────────
  const handleDesaClick = (feature: any) => {
    try {
      const desaName = getProp(feature.properties, 'desa');
      if (desaName) setHighlightedDesa(desaName);
      
      const center = turf.center(feature);
      setFlyToFeature({
        type: 'center',
        longitude: center.geometry.coordinates[0],
        latitude: center.geometry.coordinates[1],
        zoom: 13,
      });
    } catch {}
  };

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
                {selectedKec
                  ? <span className="text-xs text-slate-500 mr-1">{desaList.length} di {selectedKec}</span>
                  : <span className="text-xs text-slate-500 mr-1 italic">Pilih Kecamatan dulu</span>
                }
                {desaOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {desaOpen && (
                <div className="ml-2 space-y-0.5">
                  {desaList.length === 0 ? (
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

          {/* ── Menu lain ── */}
          <SidebarItem icon={<UploadCloud size={20} />} label="Import Data" onClick={() => fileInputRef.current?.click()} />
          <SidebarItem icon={<Activity size={20} />} label="Spatial Analysis" />
          <SidebarItem icon={<Database size={20} />} label="Data Store" />
          <SidebarItem icon={<Share2 size={20} />} label="Collaboration" />
        </nav>

        <div className="w-full px-3 pb-4">
          <SidebarItem icon={<LogOut size={20} />} label="Logout" onClick={handleLogout} />
        </div>
      </aside>

      {/* ── Main Map ── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden p-2 lg:p-4">
        <div className="flex-1 rounded-xl overflow-hidden shadow-2xl relative border border-slate-800/60 ring-1 ring-white/5">
          <MapViewer geoData={geoData} flyToFeature={flyToFeature} highlightedKec={highlightedKec} highlightedDesa={highlightedDesa} />
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
