'use client';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MapViewer from '@/components/MapViewer';
import {
  Layers, Database, Activity, Share2, UploadCloud,
  LogOut, ChevronDown, ChevronRight, MapPin, Map, Download, PenLine, AlertTriangle, Trash2, Loader2
} from 'lucide-react';
import * as turf from '@turf/turf';

// ─── Helper: temukan key property case-insensitive ─────────────────────────
function getProp(props: any, key: string): string | null {
  if (!props) return null;
  const found = Object.keys(props).find(k => k.toLowerCase() === key.toLowerCase());
  return found ? String(props[found]) : null;
}

// ─── Helpers untuk format compressed GeoJSON ───────────────────────────────
// Format lama: electionData.calon = { "Nama": votes }
// Format baru: electionData.c = [v0, v1, ...], electionData.t = total
//              suara_per_tps entry: [no_tps, {v:[...],t:N}, {v:[...],t:N}, ...]
//   urutan election: PPWP, DPD, DPR RI, DPRD PROVINSI, DPRD KABUPATEN

const ELECTION_ORDER = ['PPWP', 'DPD', 'DPR RI', 'DPRD PROVINSI', 'DPRD KABUPATEN'];

// Ambil kandidat names dari candidate_names lookup atau dari calon dict biasa
function getCandidateNames(geoData: any, pemiluKey: string, election: string): string[] {
  // 1. Cek root-level candidate_names
  if (geoData?.candidate_names) {
    // a. Format flat: candidate_names["PPWP"]
    if (Array.isArray(geoData.candidate_names[election])) {
      return geoData.candidate_names[election];
    }
    // b. Format nested: candidate_names["pemilu_2024"]["PPWP"]
    const key = Object.keys(geoData.candidate_names).find(k => k.toLowerCase() === pemiluKey.toLowerCase());
    if (key && geoData.candidate_names[key]?.[election]) {
      return geoData.candidate_names[key][election];
    }
  }
  // 2. Fallback: cek _cn yang di-embed di feature pertama
  const firstFeat = geoData?.features?.[0];
  if (firstFeat?.properties) {
    const propKey = Object.keys(firstFeat.properties).find(k => k.toLowerCase() === pemiluKey.toLowerCase());
    if (propKey && firstFeat.properties[propKey]?._cn?.[election]) {
      return firstFeat.properties[propKey]._cn[election];
    }
  }
  return [];
}


// Konversi election data (format baru atau lama) → { calon: {nama: votes}, total }
function decodeElectionData(
  elecData: any,
  names: string[]
): { calon: Record<string, number>; total_suara_sah: number } | null {
  if (!elecData) return null;
  // Format lama
  if (elecData.calon) return { calon: elecData.calon, total_suara_sah: elecData.total_suara_sah || 0 };
  // Format baru (compressed)
  if (elecData.c && Array.isArray(elecData.c)) {
    const calon: Record<string, number> = {};
    elecData.c.forEach((v: number, i: number) => {
      calon[names[i] || `Calon ${i + 1}`] = v;
    });
    return { calon, total_suara_sah: elecData.t || 0 };
  }
  return null;
}

// Decode 1 TPS entry dari suara_per_tps
// Format lama: { no_tps, PPWP: {calon, total}, DPD: ... }
// Format baru: [no_tps, {v,t}_PPWP, {v,t}_DPD, {v,t}_DPRRI, {v,t}_PROV, {v,t}_KAB]
function decodeTpsEntry(
  entry: any,
  election: string,
  names: string[]
): { no_tps: number; calon: Record<string, number>; total_suara_sah: number } | null {
  if (Array.isArray(entry)) {
    // Format baru
    const no_tps = entry[0];
    const elecIdx = ELECTION_ORDER.indexOf(election);
    if (elecIdx < 0) return null;
    const elecData = entry[elecIdx + 1]; // +1 karena index 0 = no_tps
    if (!elecData) return null;
    const calon: Record<string, number> = {};
    (elecData.v || []).forEach((v: number, i: number) => {
      calon[names[i] || `Calon ${i + 1}`] = v;
    });
    return { no_tps, calon, total_suara_sah: elecData.t || 0 };
  } else {
    // Format lama
    const no_tps = entry.no_tps;
    const elecData = entry[election];
    if (!elecData) return null;
    return { no_tps, calon: elecData.calon || {}, total_suara_sah: elecData.total_suara_sah || 0 };
  }
}

// Ambil no_tps dari entry (format lama atau baru)
function getTpsNo(entry: any): number {
  return Array.isArray(entry) ? entry[0] : entry.no_tps;
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
  const [perolehanOpen, setPerolehanOpen] = useState(false);
  const [perolehan2024Open, setPerolehan2024Open] = useState(false);
  const [perolehan2019Open, setPerolehan2019Open] = useState(false);
  const [pfiMenuOpen, setPfiMenuOpen] = useState(false);
  const [pfi2024Open, setPfi2024Open] = useState(false);
  const [pfi2019Open, setPfi2019Open] = useState(false);
  
  const [selectedPemilu, setSelectedPemilu] = useState<'pemilu_2024' | 'pemilu_2019' | null>('pemilu_2024');
  const [selectedElection, setSelectedElection] = useState<'PPWP' | 'DPD' | 'DPR RI' | 'DPRD PROVINSI' | 'DPRD KABUPATEN' | null>('DPRD KABUPATEN');

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
  const [isPFIMode, setIsPFIMode] = useState(false);
  const [pfiClickedDesa, setPfiClickedDesa] = useState<{ desa: string; kec: string } | null>(null);

  // ─── TPS Selector State ────────────────────────────────────────────────
  const [selectedTPS, setSelectedTPS] = useState<number | null>(null); // null = semua TPS


  // ─── Uploaded Layers State ─────────────────────────────────────────────
  interface LayerEntry { id: string; name: string; }
  const [uploadedLayers, setUploadedLayers] = useState<LayerEntry[]>([]);
  const [tpsLayers, setTpsLayers]           = useState<LayerEntry[]>([]); // ← file TPS terpisah
  const [kelolaDataOpen, setKelolaDataOpen] = useState(false);
  const [isUploading, setIsUploading]       = useState(false);
  const [isUploadingTps, setIsUploadingTps] = useState(false);

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const tpsFileInputRef = useRef<HTMLInputElement>(null); // ← input file TPS
  const router = useRouter();

  // ─── Load last active layers on mount ─────────────────────────────────
  useEffect(() => {
    let storedLayers: LayerEntry[] = [];
    let storedTpsLayers: LayerEntry[] = [];
    const multiRaw    = localStorage.getItem('active_layer_entries');
    const tpsRaw      = localStorage.getItem('tps_layer_entries');
    const legacyMultiIds = localStorage.getItem('active_layer_ids');
    const legacySingleId = localStorage.getItem('active_layer_id');

    if (multiRaw) {
      try { storedLayers = JSON.parse(multiRaw); } catch (e) { console.error('Gagal parsing active_layer_entries', e); }
    } else if (legacyMultiIds) {
      try {
        const ids: string[] = JSON.parse(legacyMultiIds);
        storedLayers = ids.map((id, i) => ({ id, name: `Layer ${i + 1}` }));
        localStorage.setItem('active_layer_entries', JSON.stringify(storedLayers));
        localStorage.removeItem('active_layer_ids');
        localStorage.removeItem('active_layer_id');
      } catch (e) { console.error('Gagal migrasi legacy ids', e); }
    } else if (legacySingleId) {
      storedLayers = [{ id: legacySingleId, name: 'Layer 1' }];
      localStorage.setItem('active_layer_entries', JSON.stringify(storedLayers));
      localStorage.removeItem('active_layer_id');
    }

    if (tpsRaw) {
      try { storedTpsLayers = JSON.parse(tpsRaw); } catch (e) { console.error('Gagal parsing tps_layer_entries', e); }
    }

    if (storedTpsLayers.length > 0) setTpsLayers(storedTpsLayers);

    if (storedLayers.length > 0) {
      setUploadedLayers(storedLayers);
      fetchAllLayers(storedLayers.map(l => l.id), storedTpsLayers.map(l => l.id));
    }
  }, []);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  // layerIds = peta utama; tpsLayerIds = file TPS terpisah
  const fetchAllLayers = async (layerIds: string[], tpsLayerIds: string[] = []) => {
    try {
      let allFeatures: any[] = [];
      let mergedCandidateNames: Record<string, any> = {};

      // Baca metadata dari localStorage untuk mengatasi masalah backend yang menghilangkan properti root
      let savedMetadata: Record<string, any> = {};
      try {
        const str = localStorage.getItem('layer_metadata');
        if (str) savedMetadata = JSON.parse(str);
      } catch (e) {}

      // ── Phase 1: Muat layer peta utama ──────────────────────────────────
      for (const id of layerIds) {
        const res = await fetch(`${API_URL}/geojson/layer/${id}`);
        if (res.ok) {
          const json = await res.json();
          const meta = savedMetadata[id] || {};
          if (json.features) allFeatures = [...allFeatures, ...json.features];
          
          const cn = meta.candidate_names || json.candidate_names;
          if (cn) mergedCandidateNames = { ...mergedCandidateNames, ...cn };
        }
      }

      // ── Phase 2: Muat layer TPS dan merge ke features peta ───────────────
      for (const id of tpsLayerIds) {
        const res = await fetch(`${API_URL}/geojson/layer/${id}`);
        if (!res.ok) continue;
        const json = await res.json();
        
        // Cek metadata lokal atau fallback
        const meta = savedMetadata[id] || {};
        
        const pemiluKey: string = meta.pemilu_key || json.pemilu_key || 'pemilu_2024';
        const cn = meta.candidate_names || json.candidate_names;
        if (cn) mergedCandidateNames = { ...mergedCandidateNames, ...cn };

        // Bangun lookup desa__kec → suara_per_tps
        const tpsLookup: Record<string, any[]> = {};
        (json.features || []).forEach((feat: any) => {
          const d = (feat.properties?.desa || '').toUpperCase().trim();
          const k = (feat.properties?.kecamatan || '').toUpperCase().trim();
          if (d && k) {
            // Cari actual key (misal pemilu_2024 atau PEMILU_2024)
            let actualKey = pemiluKey;
            if (feat.properties) {
              for (const key of Object.keys(feat.properties)) {
                if (key.toLowerCase() === pemiluKey.toLowerCase()) {
                  actualKey = key;
                  break;
                }
              }
            }
            
            // Cek di dalam object pemilu (format baru) ATAU di root properties (format lama)
            const tpsData = feat.properties?.[actualKey]?.suara_per_tps || feat.properties?.suara_per_tps;
            if (tpsData) {
              tpsLookup[`${d}__${k}`] = tpsData;
            }
          }
        });

        // Inject suara_per_tps ke setiap feature yang cocok
        allFeatures = allFeatures.map((feat: any) => {
          const d = (getProp(feat.properties, 'desa') || '').toUpperCase().trim();
          const k = (getProp(feat.properties, 'kecamatan') || '').toUpperCase().trim();
          const tpsList = tpsLookup[`${d}__${k}`];
          if (!tpsList) return feat;

          // Cari actual key di properties agar tidak duplicate dengan beda case (misal 'PEMILU_2024' vs 'pemilu_2024')
          let actualKey = pemiluKey;
          for (const key of Object.keys(feat.properties)) {
            if (key.toLowerCase() === pemiluKey.toLowerCase()) {
              actualKey = key;
              break;
            }
          }

          return {
            ...feat,
            properties: {
              ...feat.properties,
              [actualKey]: {
                ...(feat.properties[actualKey] || {}),
                suara_per_tps: tpsList
              }
            }
          };
        });
      }

      setGeoData({
        type: 'FeatureCollection',
        features: allFeatures,
        ...(Object.keys(mergedCandidateNames).length > 0 ? { candidate_names: mergedCandidateNames } : {}),
      });
    } catch (e) {
      console.error('Gagal mengambil layers', e);
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

    if (file.size > 4 * 1024 * 1024) {
      alert('File terlalu besar! Batas maksimal ukuran file adalah 4 MB. Gunakan file GeoJSON Compressed yang sudah disiapkan (tersedia di folder Compressed).');
      return;
    }



    const formData = new FormData();
    formData.append('file', file);
    setIsUploading(true);

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
        localStorage.removeItem('active_layer_ids');
        localStorage.removeItem('active_layer_entries');
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

      // Sukses — tambahkan layer entry baru (id + nama file)
      const newEntry: LayerEntry = { id: data.layerId, name: file.name };
      const newLayers = [...uploadedLayers, newEntry];
      setUploadedLayers(newLayers);
      localStorage.setItem('active_layer_entries', JSON.stringify(newLayers));

      // Parse metadata lokal karena backend membuangnya
      try {
        const fileText = await file.text();
        const metaJson = JSON.parse(fileText);
        let savedMeta: Record<string, any> = {};
        try { savedMeta = JSON.parse(localStorage.getItem('layer_metadata') || '{}'); } catch(e){}
        savedMeta[data.layerId] = {
          candidate_names: metaJson.candidate_names,
          pemilu_key: metaJson.pemilu_key,
          _data_type: metaJson._data_type
        };
        localStorage.setItem('layer_metadata', JSON.stringify(savedMeta));
      } catch (err) {
        console.error('Gagal menyimpan metadata layer lokal', err);
      }

      // Reset state kecamatan/desa lama sebelum load data baru
      setSelectedKec(null);
      setHighlightedKec(null);
      setHighlightedDesa(null);
      fetchAllLayers(newLayers.map(l => l.id), tpsLayers.map(l => l.id));

    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUploading(false);
    }

    e.target.value = '';
  };

  const handleRemoveLayer = (layerId: string) => {
    const newLayers = uploadedLayers.filter(l => l.id !== layerId);
    setUploadedLayers(newLayers);
    localStorage.setItem('active_layer_entries', JSON.stringify(newLayers));
    setSelectedKec(null);
    setHighlightedKec(null);
    setHighlightedDesa(null);
    if (newLayers.length > 0) {
      fetchAllLayers(newLayers.map(l => l.id), tpsLayers.map(l => l.id));
    } else {
      setGeoData(null);
    }
  };

  // ─── Upload file TPS terpisah ────────────────────────────────────────────
  const handleTpsFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const token = localStorage.getItem('token');
    if (!token) { alert('Sesi habis. Silakan login.'); router.push('/login'); return; }
    if (file.size > 4 * 1024 * 1024) {
      alert('File TPS terlalu besar (> 4 MB).');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setIsUploadingTps(true);
    try {
      const res = await fetch(`${API_URL}/geojson/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (res.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Gagal upload TPS');

      const newEntry: LayerEntry = { id: data.layerId, name: file.name };
      const newTpsLayers = [...tpsLayers, newEntry];
      setTpsLayers(newTpsLayers);
      localStorage.setItem('tps_layer_entries', JSON.stringify(newTpsLayers));

      // Parse metadata lokal karena backend membuangnya
      try {
        const fileText = await file.text();
        const metaJson = JSON.parse(fileText);
        let savedMeta: Record<string, any> = {};
        try { savedMeta = JSON.parse(localStorage.getItem('layer_metadata') || '{}'); } catch(e){}
        savedMeta[data.layerId] = {
          candidate_names: metaJson.candidate_names,
          pemilu_key: metaJson.pemilu_key,
          _data_type: metaJson._data_type
        };
        localStorage.setItem('layer_metadata', JSON.stringify(savedMeta));
      } catch (err) {
        console.error('Gagal menyimpan metadata TPS lokal', err);
      }

      // Re-fetch semua layer termasuk TPS baru
      await fetchAllLayers(uploadedLayers.map(l => l.id), newTpsLayers.map(l => l.id));
    } catch (err: any) {
      alert(`Error TPS: ${err.message}`);
    } finally {
      setIsUploadingTps(false);
    }
    e.target.value = '';
  };

  const handleRemoveTpsLayer = (layerId: string) => {
    const newTpsLayers = tpsLayers.filter(l => l.id !== layerId);
    setTpsLayers(newTpsLayers);
    localStorage.setItem('tps_layer_entries', JSON.stringify(newTpsLayers));
    // Re-fetch tanpa layer TPS yang dihapus
    fetchAllLayers(uploadedLayers.map(l => l.id), newTpsLayers.map(l => l.id));
  };

  const handleLogout = () => {
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    localStorage.removeItem('token');
    localStorage.removeItem('active_layer_id');
    localStorage.removeItem('active_layer_ids');
    localStorage.removeItem('active_layer_entries');
    router.push('/login');
  };

  const handleClearData = () => {
    if (confirm('Apakah Anda yakin ingin menghapus semua layer dari tampilan peta?')) {
      setUploadedLayers([]);
      setTpsLayers([]);
      setGeoData(null);
      localStorage.removeItem('active_layer_entries');
      localStorage.removeItem('tps_layer_entries');
      localStorage.removeItem('active_layer_ids');
      localStorage.removeItem('active_layer_id');
      setSelectedKec(null);
      setHighlightedKec(null);
      setHighlightedDesa(null);
    }
  };

  // ─── Derive daftar Kecamatan & Desa dari geoData ───────────────────────
  const { kecamatanList, desaByKec } = useMemo(() => {
    if (!geoData?.features) return { kecamatanList: [], desaByKec: {} };
    const kecSet = new Set<string>();
    const desaMap: Record<string, any[]> = {};
    // Deduplikasi: simpan hanya feature pertama per kombinasi desa+kecamatan
    // agar tidak terjadi double-counting saat multi-upload
    const seenDesaKec = new Set<string>();

    geoData.features.forEach((f: any) => {
      const kec = getProp(f.properties, 'kecamatan');
      const desa = getProp(f.properties, 'desa');
      if (kec) {
        kecSet.add(kec);
        if (!desaMap[kec]) desaMap[kec] = [];
        if (desa) {
          const key = `${desa}__${kec}`;
          if (!seenDesaKec.has(key)) {
            seenDesaKec.add(key);
            desaMap[kec].push(f);
          }
        }
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

  // ─── TPS List untuk desa yang dipilih (mendukung format compressed) ────
  const tpsListData = useMemo(() => {
    // Tidak perlu selectedElection — TPS list sama untuk semua jenis pemilu
    if (!highlightedDesa || !selectedKec || selectedKec === 'ALL' || !selectedPemilu || !geoData?.features) return null;

    // Cari feature yang memiliki property pemilu_key (antisipasi jika ada duplicate/multi layers)
    const targetFeatures = geoData.features.filter((f: any) =>
      getProp(f.properties, 'desa') === highlightedDesa &&
      getProp(f.properties, 'kecamatan') === selectedKec
    );
    if (targetFeatures.length === 0) return null;

    let finalPemiluData = null;
    for (const f of targetFeatures) {
      const pKey = Object.keys(f.properties).find(k => k.toLowerCase() === selectedPemilu.toLowerCase()) || selectedPemilu;
      if (f.properties[pKey]) {
        finalPemiluData = f.properties[pKey];
        break; // Ditemukan feature yg punya data pemilu valid
      }
    }
    if (!finalPemiluData) return null;

    const pemiluData = finalPemiluData;

    const tpsList: any[] = pemiluData.suara_per_tps || [];
    if (tpsList.length === 0) return [];   // return [] agar UI bisa tampilkan pesan

    // Normalize ke {no_tps} objects untuk keperluan UI
    return tpsList.map((entry: any) => ({ no_tps: getTpsNo(entry), _raw: entry }));
  }, [highlightedDesa, selectedKec, selectedPemilu, geoData]);


  // Reset TPS selection ketika desa / pemilu berubah
  useEffect(() => { setSelectedTPS(null); }, [highlightedDesa, selectedKec, selectedPemilu, selectedElection]);

  // ─── Aggregation Logic for Spatial Analysis ─────────────────────────────
  const aggregatedData = useMemo(() => {
    if (!selectedPemilu || !selectedElection || !geoData?.features) return null;

    const candidateNames = getCandidateNames(geoData, selectedPemilu, selectedElection);
    const result = {
      total_tps: 0,
      total_suara_sah: 0,
      calon: {} as Record<string, number>
    };

    // ═══════════════════════════════════════════════════════════════════════
    // DESA VIEW — satu desa dipilih (highlightedDesa)
    // Semua kalkulasi dari suara_per_tps agar konsisten antara Semua & per-TPS
    // ═══════════════════════════════════════════════════════════════════════
    if (highlightedDesa && selectedKec && selectedKec !== 'ALL') {
      // Cari semua feature untuk desa ini (bisa lebih dari 1 jika multi-upload)
      const allDesaFeatures = geoData.features.filter((f: any) =>
        getProp(f.properties, 'desa') === highlightedDesa &&
        getProp(f.properties, 'kecamatan') === selectedKec
      );
      if (allDesaFeatures.length === 0) return null;

      // Cari feature PERTAMA yang punya data pemilu yang dipilih
      // Prioritaskan feature yang punya suara_per_tps
      let pemiluData: any = null;
      for (const f of allDesaFeatures) {
        const props = f.properties;
        if (!props) continue;
        const pKey = Object.keys(props).find(k => k.toLowerCase() === selectedPemilu.toLowerCase()) || selectedPemilu;
        const pd = props[pKey];
        if (!pd) continue;
        // Prioritas: feature yang punya suara_per_tps
        if (pd.suara_per_tps?.length > 0) { pemiluData = pd; break; }
        // Fallback: simpan kandidat pertama yang valid (belum ada suara_per_tps)
        if (!pemiluData) pemiluData = pd;
      }
      if (!pemiluData) return null;

      const tpsList: any[] = pemiluData.suara_per_tps || [];

      // ── PER-TPS MODE ──
      if (selectedTPS !== null) {
        const rawEntry = tpsList.find((t: any) => getTpsNo(t) === selectedTPS);
        if (rawEntry) {
          const decoded = decodeTpsEntry(rawEntry, selectedElection, candidateNames);
          if (decoded) {
            result.total_tps = 1;
            result.total_suara_sah = decoded.total_suara_sah;
            Object.entries(decoded.calon).forEach(([nama, suara]) => {
              result.calon[nama] = suara as number;
            });
          }
        }
        const sortedCalon = Object.entries(result.calon).sort((a, b) => b[1] - a[1]);
        return { ...result, sortedCalon, regionName: `TPS ${selectedTPS} — ${highlightedDesa}` };
      }

      // ── SEMUA TPS MODE (desa) ──
      if (tpsList.length > 0) {
        // Hitung dari suara_per_tps agar konsisten dengan tampilan per-TPS
        result.total_tps = tpsList.length;
        for (const entry of tpsList) {
          const decoded = decodeTpsEntry(entry, selectedElection, candidateNames);
          if (decoded) {
            result.total_suara_sah += decoded.total_suara_sah;
            Object.entries(decoded.calon).forEach(([nama, suara]) => {
              if (!result.calon[nama]) result.calon[nama] = 0;
              result.calon[nama] += suara as number;
            });
          }
        }
      } else {
        // Tidak ada data TPS — fallback ke aggregate summary di Main file
        const electionRaw = pemiluData[selectedElection] || pemiluData[selectedElection.toUpperCase()];
        const elecDecoded = decodeElectionData(electionRaw, candidateNames);
        if (elecDecoded) {
          result.total_suara_sah = elecDecoded.total_suara_sah;
          Object.entries(elecDecoded.calon).forEach(([nama, suara]) => {
            result.calon[nama] = suara as number;
          });
        }
        const tpsRaw = pemiluData.jumlah_tps || pemiluData.JUMLAH_TPS ||
          getProp(allDesaFeatures[0]?.properties, 'jumlah_tps') || 0;
        result.total_tps = typeof tpsRaw === 'number' ? tpsRaw : parseInt(tpsRaw, 10) || 0;
      }

      const sortedCalon = Object.entries(result.calon).sort((a, b) => b[1] - a[1]);
      return { ...result, sortedCalon, regionName: `Desa ${highlightedDesa}, Kec. ${selectedKec}` };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // KECAMATAN / SELURUH VIEW
    // Deduplikasi per desa+kec agar tidak double-count dari multi-upload
    // ═══════════════════════════════════════════════════════════════════════
    let targetFeatures: any[] = [];
    if (selectedKec && selectedKec !== 'ALL') {
      targetFeatures = geoData.features.filter((f: any) =>
        getProp(f.properties, 'kecamatan') === selectedKec
      );
    } else if (selectedKec === 'ALL') {
      targetFeatures = geoData.features;
    } else {
      return null;
    }
    if (targetFeatures.length === 0) return null;

    // Build desa → best feature lookup:
    // Prioritaskan feature yang punya data pemilu (pemiluData) dan suara_per_tps
    const desaBestFeature: Record<string, any> = {};
    targetFeatures.forEach(f => {
      const props = f.properties;
      if (!props) return;
      const desa = getProp(props, 'desa');
      const kec = getProp(props, 'kecamatan');
      if (!desa || !kec) return;
      const desaKey = `${desa}__${kec}`;

      const pKey = Object.keys(props).find(k => k.toLowerCase() === selectedPemilu.toLowerCase()) || selectedPemilu;
      const pemiluData = props[pKey];
      if (!pemiluData) return; // fitur ini tidak punya data pemilu, skip

      const existing = desaBestFeature[desaKey];
      if (!existing) {
        desaBestFeature[desaKey] = f;
      } else {
        // Prefer feature yang punya suara_per_tps (lebih lengkap)
        const existingKey = Object.keys(existing.properties).find(k => k.toLowerCase() === selectedPemilu.toLowerCase()) || selectedPemilu;
        const existingPD = existing.properties[existingKey];
        const hasTps = (pemiluData.suara_per_tps || []).length > 0;
        const existingHasTps = (existingPD?.suara_per_tps || []).length > 0;
        if (hasTps && !existingHasTps) desaBestFeature[desaKey] = f;
      }
    });

    Object.values(desaBestFeature).forEach(f => {
      const props = f.properties;
      const desa = getProp(props, 'desa');
      const kec = getProp(props, 'kecamatan');
      const pKey = Object.keys(props).find(k => k.toLowerCase() === selectedPemilu.toLowerCase()) || selectedPemilu;
      const pemiluData = props[pKey];
      if (!pemiluData) return;

      // TPS count
      const tpsList: any[] = pemiluData.suara_per_tps || [];
      const tpsRaw = pemiluData.jumlah_tps || pemiluData.JUMLAH_TPS || getProp(props, 'jumlah_tps');
      const tps = tpsList.length > 0 ? tpsList.length : parseInt(tpsRaw || '0', 10);
      if (!isNaN(tps)) result.total_tps += tps;

      // Prioritas 1: Aggregate suara dari summary per-desa (cepat)
      const electionRaw = pemiluData[selectedElection] || pemiluData[selectedElection.toUpperCase()];
      const elecDecoded = decodeElectionData(electionRaw, candidateNames);
      if (elecDecoded && elecDecoded.total_suara_sah > 0) {
        result.total_suara_sah += elecDecoded.total_suara_sah;
        Object.entries(elecDecoded.calon).forEach(([nama, suara]) => {
          if (!result.calon[nama]) result.calon[nama] = 0;
          result.calon[nama] += suara;
        });
      } else if (tpsList.length > 0) {
        // Fallback: aggregate langsung dari suara_per_tps jika summary tidak ada/0
        for (const entry of tpsList) {
          const decoded = decodeTpsEntry(entry, selectedElection, candidateNames);
          if (decoded) {
            result.total_suara_sah += decoded.total_suara_sah;
            Object.entries(decoded.calon).forEach(([nama, suara]) => {
              if (!result.calon[nama]) result.calon[nama] = 0;
              result.calon[nama] += suara as number;
            });
          }
        }
      }
    });

    const sortedCalon = Object.entries(result.calon).sort((a, b) => b[1] - a[1]);
    let regionName = 'Pilih Wilayah';
    if (selectedKec === 'ALL') regionName = 'Kabupaten Wonogiri (Seluruh Desa)';
    else if (selectedKec) regionName = `Kecamatan ${selectedKec}`;

    return { ...result, sortedCalon, regionName };
  }, [geoData, selectedKec, highlightedDesa, selectedPemilu, selectedElection, desaByKec, selectedTPS]);

  // ─── Per-Desa Party Percentages for map highlight ───────────────────────
  const partyDesaPercentages = useMemo(() => {
    if (!selectedParty || !selectedPemilu || !selectedElection || !geoData?.features) return {};

    const result: Record<string, number> = {};
    const candidateNames = getCandidateNames(geoData, selectedPemilu, selectedElection);
    geoData.features.forEach((f: any) => {
      const desa = getProp(f.properties, 'desa');
      const kec = getProp(f.properties, 'kecamatan');
      if (!desa || !kec) return;

      if (highlightedDesa && selectedKec && selectedKec !== 'ALL') {
        if (desa !== highlightedDesa || kec !== selectedKec) return;
      } else if (selectedKec && selectedKec !== 'ALL') {
        if (kec !== selectedKec) return;
      }

      const pKey = Object.keys(f.properties).find(k => k.toLowerCase() === selectedPemilu.toLowerCase()) || selectedPemilu;
      const pemiluData = f.properties[pKey];
      if (!pemiluData) return;
      const electionRaw = pemiluData[selectedElection] || pemiluData[selectedElection?.toUpperCase?.()];
      const elecDecoded = decodeElectionData(electionRaw, candidateNames);
      if (!elecDecoded) return;

      const { calon, total_suara_sah } = elecDecoded;
      const partyVotes = calon[selectedParty] || 0;
      if (total_suara_sah > 0) {
        result[`${desa}__${kec}`] = (partyVotes / total_suara_sah) * 100;
      }
    });
    return result;
  }, [selectedParty, selectedPemilu, selectedElection, geoData, selectedKec, highlightedDesa]);

  // ─── Per-Desa PFI Scores for map heatmap ──────────────────────────────────
  const pfiDesaScores = useMemo(() => {
    if (!isPFIMode || !selectedPemilu || !selectedElection || !geoData?.features) return {};

    const result: Record<string, number> = {};
    const candidateNames = getCandidateNames(geoData, selectedPemilu, selectedElection);
    geoData.features.forEach((f: any) => {
      const desa = getProp(f.properties, 'desa');
      const kec = getProp(f.properties, 'kecamatan');
      if (!desa || !kec) return;

      if (highlightedDesa && selectedKec && selectedKec !== 'ALL') {
        if (desa !== highlightedDesa || kec !== selectedKec) return;
      } else if (selectedKec && selectedKec !== 'ALL') {
        if (kec !== selectedKec) return;
      }

      const pKey = Object.keys(f.properties).find(k => k.toLowerCase() === selectedPemilu.toLowerCase()) || selectedPemilu;
      const pemiluData = f.properties[pKey];
      if (!pemiluData) return;
      const electionRaw = pemiluData[selectedElection] || pemiluData[selectedElection?.toUpperCase?.()];
      const elecDecoded = decodeElectionData(electionRaw, candidateNames);
      if (!elecDecoded) return;

      const votes = Object.values(elecDecoded.calon).map(v => Number(v) || 0);
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
      const hasPemilu = !!(f.properties[selectedPemilu] || f.properties[selectedPemilu.toUpperCase()]);
      return d === pfiClickedDesa.desa && k === pfiClickedDesa.kec && hasPemilu;
    });
    if (!feature) return null;

    const props = feature.properties;
    const pKey = Object.keys(props).find(k => k.toLowerCase() === selectedPemilu.toLowerCase()) || selectedPemilu;
    const pemiluData = props[pKey];
    if (!pemiluData) return null;
    const electionRaw = pemiluData[selectedElection] || pemiluData[selectedElection?.toUpperCase?.()];
    const candidateNames = getCandidateNames(geoData, selectedPemilu, selectedElection);
    const elecDecoded = decodeElectionData(electionRaw, candidateNames);
    if (!elecDecoded) return null;

    const { calon, total_suara_sah: totalSuaraSah } = elecDecoded;
    const sortedCalon: [string, number][] = Object.entries(calon)
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
    <div className="flex h-screen w-full bg-[#fdfbf7] overflow-hidden text-stone-900 p-3 gap-3">
      {/* ── Sidebar ── */}
      <aside className="w-72 rounded-2xl border border-black/5 bg-white/50 backdrop-blur-xl flex flex-col pt-5 overflow-hidden shadow-2xl">
        {/* Logo */}
        <div className="px-5 mb-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-gradient-to-tr from-red-600 to-red-500 shadow-lg shadow-red-500/20 flex items-center justify-center shrink-0">
            <span className="font-bold text-white tracking-tighter">G</span>
          </div>
          <span className="font-bold text-lg tracking-tight text-stone-900">SmartMap</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 w-full px-3 space-y-1 overflow-y-auto scrollbar-thin scrollbar-track-stone-100/50 scrollbar-thumb-stone-300/50">


          {/* ── Import & Kelola Data ── */}
          {/* File GeoJSON utama (peta desa + ringkasan pemilu) */}
          <input type="file" accept=".geojson,.json" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
          <SidebarItem
            icon={isUploading ? <Loader2 size={20} className="animate-spin text-stone-400" /> : <UploadCloud size={20} />}
            label={isUploading ? "Mengunggah..." : "Import Peta Pemilu"}
            onClick={() => !isUploading && fileInputRef.current?.click()}
          />

          {/* File TPS terpisah (suara per TPS) */}
          <input type="file" accept=".geojson,.json" className="hidden" ref={tpsFileInputRef} onChange={handleTpsFileUpload} />
          <SidebarItem
            icon={isUploadingTps ? <Loader2 size={20} className="animate-spin text-blue-400" /> : <UploadCloud size={20} className="text-blue-500" />}
            label={isUploadingTps ? "Mengunggah TPS..." : "Import Data TPS"}
            onClick={() => !isUploadingTps && tpsFileInputRef.current?.click()}
          />

          {/* Kelola Data – daftar file yang sudah terupload */}
          {(uploadedLayers.length > 0 || tpsLayers.length > 0) && (
            <>
              <button
                onClick={() => setKelolaDataOpen(!kelolaDataOpen)}
                className={`w-full flex items-center gap-3 p-3 px-4 rounded-lg transition-all duration-200 group ${
                  kelolaDataOpen
                    ? 'bg-stone-900 text-white shadow-md'
                    : 'text-stone-600 hover:bg-stone-100/50 hover:text-stone-800'
                }`}
              >
                <Database size={20} className="shrink-0 transition-transform group-hover:scale-110" />
                <span className="font-medium text-sm flex-1 text-left">Kelola Data</span>
                <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full mr-1">
                  {uploadedLayers.length + tpsLayers.length}
                </span>
                {kelolaDataOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>

              {kelolaDataOpen && (
                <div className="ml-3 border-l border-stone-300 pl-2 space-y-1">

                  {/* ─ File Peta Utama ─ */}
                  {uploadedLayers.length > 0 && (
                    <>
                      <p className="px-3 py-1.5 text-[10px] text-stone-500 uppercase tracking-wider font-bold">Peta Pemilu</p>
                      {uploadedLayers.map((layer, idx) => (
                        <div
                          key={layer.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-md bg-stone-100/40 border border-stone-300/40 group/item"
                        >
                          <div className="w-5 h-5 rounded shrink-0 bg-red-100 flex items-center justify-center">
                            <span className="text-[9px] font-bold text-red-600">{idx + 1}</span>
                          </div>
                          <span className="flex-1 text-xs text-stone-700 truncate" title={layer.name}>
                            {layer.name.replace(/\.(geojson|json)$/i, '')}
                          </span>
                          <button
                            onClick={() => handleRemoveLayer(layer.id)}
                            title="Hapus layer ini"
                            className="shrink-0 p-1 rounded text-zinc-600 hover:text-red-600 hover:bg-red-500/10 transition-all opacity-0 group-hover/item:opacity-100"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </>
                  )}

                  {/* ─ File TPS ─ */}
                  {tpsLayers.length > 0 && (
                    <>
                      <p className="px-3 py-1.5 text-[10px] text-blue-500 uppercase tracking-wider font-bold">Data TPS</p>
                      {tpsLayers.map((layer, idx) => (
                        <div
                          key={layer.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50/50 border border-blue-200/60 group/item"
                        >
                          <div className="w-5 h-5 rounded shrink-0 bg-blue-100 flex items-center justify-center">
                            <span className="text-[9px] font-bold text-blue-600">{idx + 1}</span>
                          </div>
                          <span className="flex-1 text-xs text-stone-700 truncate" title={layer.name}>
                            {layer.name.replace(/\.(geojson|json)$/i, '')}
                          </span>
                          <button
                            onClick={() => handleRemoveTpsLayer(layer.id)}
                            title="Hapus layer TPS ini"
                            className="shrink-0 p-1 rounded text-zinc-600 hover:text-red-600 hover:bg-red-500/10 transition-all opacity-0 group-hover/item:opacity-100"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </>
                  )}

                  <button
                    onClick={handleClearData}
                    className="w-full mt-1 flex items-center gap-2 px-3 py-1.5 rounded-md text-red-600/70 hover:text-red-600 hover:bg-red-500/10 transition-all text-xs"
                  >
                    <Trash2 size={13} />
                    <span>Hapus Semua Layer</span>
                  </button>
                </div>
              )}
            </>
          )}
          

          {/* ── Layer Manager (collapsible) ── */}
          <button
            onClick={() => setLayerOpen(!layerOpen)}
            className="w-full flex items-center gap-3 p-3 px-4 rounded-lg transition-all duration-200 group bg-stone-900 text-white shadow-md"
          >
            <Layers size={20} className="shrink-0" />
            <span className="font-medium text-sm flex-1 text-left">Layer Manager</span>
            {layerOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {/* ── Submenu Layer Manager ── */}
          {layerOpen && geoData && (
            <div className="ml-3 border-l border-stone-300 pl-2 space-y-1">

              {/* ── Kecamatan ── */}
              <button
                onClick={() => setKecOpen(!kecOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-stone-700 hover:bg-stone-100 hover:text-stone-900 transition-all text-sm"
              >
                <Map size={15} className="text-red-600 shrink-0" />
                <span className="flex-1 text-left font-medium">Kecamatan</span>
                <span className="text-xs text-stone-500 mr-1">{kecamatanList.length}</span>
                {kecOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {kecOpen && (
                <div className="ml-2 space-y-0.5 max-h-48 overflow-y-auto pr-1">
                  <button
                    onClick={() => handleKecClick('ALL')}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                      selectedKec === 'ALL'
                        ? 'bg-red-600 text-white shadow-sm font-bold'
                        : 'text-stone-700 hover:bg-stone-100 hover:text-stone-800 font-bold'
                    }`}
                  >
                    🌟 Kab. Wonogiri (Semua)
                  </button>
                  <div className="h-px bg-stone-200/50 my-1 mx-2" />
                  {kecamatanList.map(kec => (
                    <button
                      key={kec}
                      onClick={() => handleKecClick(kec)}
                      className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                        selectedKec === kec
                          ? 'bg-red-600 text-white shadow-sm'
                          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-800'
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
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-stone-700 hover:bg-stone-100 hover:text-stone-900 transition-all text-sm"
              >
                <MapPin size={15} className="text-stone-500 shrink-0" />
                <span className="flex-1 text-left font-medium">Desa</span>
                {selectedKec === 'ALL'
                  ? <span className="text-xs text-stone-500 mr-1 italic">Semua Desa</span>
                  : selectedKec
                  ? <span className="text-xs text-stone-500 mr-1">{desaList.length} di {selectedKec}</span>
                  : <span className="text-xs text-stone-500 mr-1 italic">Pilih Kecamatan dulu</span>
                }
                {desaOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {desaOpen && (
                <div className="ml-2 space-y-0.5">
                  {selectedKec === 'ALL' ? (
                    <p className="text-xs text-stone-500 italic px-3 py-2">
                      Semua desa di Kabupaten dipilih.
                    </p>
                  ) : desaList.length === 0 ? (
                    <p className="text-xs text-stone-500 italic px-3 py-2">
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
                                ? 'bg-stone-600/20 text-stone-300 border border-stone-500/30'
                                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-300'
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
            <div className="ml-3 border-l border-stone-300 pl-4 py-2">
              <p className="text-xs text-stone-500 italic">Belum ada data. Import GeoJSON terlebih dahulu.</p>
            </div>
          )}

          {/* ── Missing Geometry Section ── */}
          {geoData && missingGeoFeatures.length > 0 && (
            <>
              <button
                onClick={() => setMissingGeoOpen(!missingGeoOpen)}
                className="w-full flex items-center gap-3 p-3 px-4 rounded-lg transition-all duration-200 group bg-red-500/10 text-red-600 border border-red-500/20"
              >
                <AlertTriangle size={18} className="shrink-0" />
                <span className="font-medium text-sm flex-1 text-left">Desa Tanpa Peta</span>
                <span className="text-xs bg-red-100 px-1.5 py-0.5 rounded-full">{missingGeoFeatures.length}</span>
                {missingGeoOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {missingGeoOpen && (
                <div className="ml-3 border-l border-red-500/20 pl-2 space-y-1">
                  <p className="text-xs text-stone-500 italic px-2 py-1">Klik ✏️ untuk menggambar batas desa di peta</p>
                  {missingGeoFeatures.map((f: any, i: number) => {
                    const desaName = getProp(f.properties, 'desa') || `Desa ${i + 1}`;
                    const kecName = getProp(f.properties, 'kecamatan') || '';
                    return (
                      <div key={i} className="flex items-center gap-1 pr-1">
                        <span className="flex-1 text-xs text-red-600 px-2 py-1 truncate">
                          {desaName}
                          <span className="text-stone-500 ml-1 text-xs">{kecName}</span>
                        </span>
                        <button
                          onClick={() => startDrawForDesa(f)}
                          title={`Gambar batas ${desaName}`}
                          className="shrink-0 p-1.5 rounded bg-red-100 text-red-600 hover:bg-red-500/40 hover:text-red-100 transition-all"
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

          {/* ── Spatial Analysis (collapsible) ── */}
          <button
            onClick={() => setAnalysisOpen(!analysisOpen)}
            className={`w-full flex items-center gap-3 p-3 px-4 rounded-lg transition-all duration-200 group ${
              analysisOpen
                ? 'bg-stone-900 text-white shadow-md'
                : 'text-stone-600 hover:bg-stone-100/50 hover:text-stone-800'
            }`}
          >
            <Activity size={20} className="shrink-0 transition-transform group-hover:scale-110" />
            <span className="font-medium text-sm flex-1 text-left">Spatial Analysis</span>
            {analysisOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {analysisOpen && (
            <div className="ml-3 border-l border-stone-300 pl-2 space-y-1">
              {/* Perolehan Suara – gabungan Pemilu 2024 & 2019 */}
              <button
                onClick={() => setPerolehanOpen(!perolehanOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-stone-700 hover:bg-stone-100 hover:text-stone-900 transition-all text-sm"
              >
                <span className="flex-1 text-left font-medium">Perolehan Suara</span>
                {perolehanOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {perolehanOpen && (
                <div className="ml-2 space-y-0.5">
                  {/* Submenu Pemilu 2024 */}
                  <button
                    onClick={() => setPerolehan2024Open(!perolehan2024Open)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-all text-xs"
                  >
                    <span className="flex-1 text-left font-medium">Pemilu 2024</span>
                    {perolehan2024Open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {perolehan2024Open && (
                    <div className="ml-2 space-y-0.5">
                      {['PPWP', 'DPD', 'DPR RI', 'DPRD PROVINSI', 'DPRD KABUPATEN'].map(election => (
                        <button
                          key={`suara_2024_${election}`}
                          onClick={() => { setSelectedPemilu('pemilu_2024'); setSelectedElection(election as any); setIsPFIMode(false); }}
                          className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                            selectedPemilu === 'pemilu_2024' && selectedElection === election && !isPFIMode
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'text-stone-600 hover:bg-stone-100 hover:text-red-600'
                          }`}
                        >
                          {election}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Submenu Pemilu 2019 */}
                  <button
                    onClick={() => setPerolehan2019Open(!perolehan2019Open)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-all text-xs"
                  >
                    <span className="flex-1 text-left font-medium">Pemilu 2019</span>
                    {perolehan2019Open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {perolehan2019Open && (
                    <div className="ml-2 space-y-0.5">
                      {['PPWP', 'DPD', 'DPR RI', 'DPRD PROVINSI', 'DPRD KABUPATEN'].map(election => (
                        <button
                          key={`suara_2019_${election}`}
                          onClick={() => { setSelectedPemilu('pemilu_2019'); setSelectedElection(election as any); setIsPFIMode(false); }}
                          className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                            selectedPemilu === 'pemilu_2019' && selectedElection === election && !isPFIMode
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'text-stone-600 hover:bg-stone-100 hover:text-red-600'
                          }`}
                        >
                          {election}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Political Fragmentation Index – berdiri sendiri */}
              <button
                onClick={() => setPfiMenuOpen(!pfiMenuOpen)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-all text-sm ${
                  pfiMenuOpen ? 'bg-red-50 text-red-600' : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
                }`}
              >
                <span className="flex-1 text-left font-medium">Political Fragmentation Index</span>
                {pfiMenuOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {pfiMenuOpen && (
                <div className="ml-2 space-y-0.5">
                  {/* PFI – Pemilu 2024 */}
                  <button
                    onClick={() => setPfi2024Open(!pfi2024Open)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-all text-xs"
                  >
                    <span className="flex-1 text-left font-medium">Pemilu 2024</span>
                    {pfi2024Open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {pfi2024Open && (
                    <div className="ml-2 space-y-0.5">
                      {['PPWP', 'DPD', 'DPR RI', 'DPRD PROVINSI', 'DPRD KABUPATEN'].map(election => (
                        <button
                          key={`pfi_2024_${election}`}
                          onClick={() => {
                            setSelectedPemilu('pemilu_2024');
                            setSelectedElection(election as any);
                            setIsPFIMode(true);
                            setSelectedParty(null);
                            setPartyFilter(null);
                          }}
                          className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                            selectedPemilu === 'pemilu_2024' && selectedElection === election && isPFIMode
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'text-stone-600 hover:bg-stone-100 hover:text-red-600'
                          }`}
                        >
                          {election}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* PFI – Pemilu 2019 */}
                  <button
                    onClick={() => setPfi2019Open(!pfi2019Open)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-all text-xs"
                  >
                    <span className="flex-1 text-left font-medium">Pemilu 2019</span>
                    {pfi2019Open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {pfi2019Open && (
                    <div className="ml-2 space-y-0.5">
                      {['PPWP', 'DPD', 'DPR RI', 'DPRD PROVINSI', 'DPRD KABUPATEN'].map(election => (
                        <button
                          key={`pfi_2019_${election}`}
                          onClick={() => {
                            setSelectedPemilu('pemilu_2019');
                            setSelectedElection(election as any);
                            setIsPFIMode(true);
                            setSelectedParty(null);
                            setPartyFilter(null);
                          }}
                          className={`w-full text-left px-3 py-1.5 rounded text-xs transition-all ${
                            selectedPemilu === 'pemilu_2019' && selectedElection === election && isPFIMode
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'text-stone-600 hover:bg-stone-100 hover:text-red-600'
                          }`}
                        >
                          {election}
                        </button>
                      ))}
                    </div>
                  )}
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
              className="w-full flex items-center gap-2 p-2.5 px-4 rounded-lg bg-stone-600/20 text-stone-300 border border-stone-500/30 hover:bg-stone-600/30 transition-all text-sm font-medium animate-pulse"
            >
              <Download size={16} className="shrink-0" />
              <span className="text-xs">Download GeoJSON Terbaru</span>
            </button>
          )}
          <SidebarItem icon={<LogOut size={20} />} label="Logout" onClick={handleLogout} />
        </div>
      </aside>

      {/* ── Main Map ── */}
      <main className="flex-1 relative rounded-2xl overflow-hidden border border-black/5 shadow-2xl bg-white/50 backdrop-blur-xl">
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
            <div className="absolute top-4 right-4 w-80 bg-white/95 backdrop-blur-md rounded-xl border border-stone-300 shadow-2xl p-4 flex flex-col max-h-[85vh] overflow-hidden text-stone-800 z-10">
              <div className="flex items-center justify-between mb-3 border-b border-stone-300 pb-2">
                <h3 className="font-bold text-lg text-red-600">
                  {isPFIMode ? 'Fragmentasi (PFI)' : 'Analisis'} - {selectedElection}
                </h3>
                <button onClick={() => { setSelectedElection(null); setSelectedParty(null); setPartyFilter(null); setIsPFIMode(false); setPfiClickedDesa(null); }} className="text-stone-600 hover:text-stone-900 transition-colors">&times;</button>
              </div>
              
              <div className="text-sm mb-3">
                <p className="text-red-600 font-semibold mb-2 truncate">📍 {aggregatedData.regionName}</p>

                {/* ── TPS Selector: hanya tampil jika desa dipilih ── */}
                {tpsListData !== null && (
                  <div className="mb-3">
                    <p className="text-[10px] text-stone-500 uppercase tracking-wider font-bold mb-1.5">Filter TPS</p>
                    {tpsListData.length === 0 ? (
                      /* File tidak mengandung data per-TPS */
                      <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                        ⚠ Data per-TPS tidak tersedia. Pastikan Anda telah mengunggah file <span className="font-bold">Suara per TPS (Compressed)</span>.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1 max-h-[96px] overflow-y-auto pr-0.5">
                        {/* Tombol Semua */}
                        <button
                          onClick={() => setSelectedTPS(null)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                            selectedTPS === null
                              ? 'bg-red-600 text-white border-red-600 shadow-sm'
                              : 'bg-white text-stone-600 border-stone-300 hover:border-red-400 hover:text-red-600'
                          }`}
                        >
                          Semua ({tpsListData.length})
                        </button>
                        {/* Tombol per TPS */}
                        {tpsListData.map((t: any) => (
                          <button
                            key={t.no_tps}
                            onClick={() => setSelectedTPS(t.no_tps === selectedTPS ? null : t.no_tps)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                              selectedTPS === t.no_tps
                                ? 'bg-red-600 text-white border-red-600 shadow-sm'
                                : 'bg-white text-stone-600 border-stone-300 hover:border-red-400 hover:text-red-600'
                            }`}
                          >
                            TPS {t.no_tps}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}


                {/* ── Summary baris ── */}
                <div className="flex justify-between items-center bg-stone-100/60 p-2.5 rounded-t border border-stone-300/50">
                  <span className="text-stone-600">{selectedTPS !== null ? 'TPS Dipilih' : 'Total TPS'}</span>
                  <span className="font-bold text-stone-800">
                    {selectedTPS !== null
                      ? <span className="text-red-600">TPS {selectedTPS}</span>
                      : aggregatedData.total_tps.toLocaleString('id-ID')
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center bg-stone-100/60 p-2.5 rounded-b border border-stone-300/50 border-t-0">
                  <span className="text-stone-600">Total Suara Sah</span>
                  <span className="font-bold text-stone-800">{aggregatedData.total_suara_sah.toLocaleString('id-ID')}</span>
                </div>
              </div>

              
              {isPFIMode && aggregatedPfi ? (
                <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent">

                  {/* ── Clicked Desa Detail View ── */}
                  {pfiClickedDesaDetail ? (
                    <>
                      {/* Back button */}
                      <button
                        onClick={() => setPfiClickedDesa(null)}
                        className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-800 mb-3 transition-colors"
                      >
                        ← Kembali ke Ringkasan
                      </button>

                      {/* Desa header */}
                      <div className="bg-stone-100/40 border border-stone-300/50 rounded-lg p-3 mb-4 shadow-inner">
                        <p className="text-xs text-stone-600 uppercase tracking-wider mb-0.5">Desa</p>
                        <p className="text-base font-bold text-stone-900">{pfiClickedDesaDetail.desa}</p>
                        <p className="text-xs text-stone-600">Kec. {pfiClickedDesaDetail.kec}</p>

                        <div className="mt-3 pt-3 border-t border-stone-300/50 text-center">
                          <p className="text-xs text-stone-600 uppercase tracking-wider mb-1">Skor PFI</p>
                          <p className="text-3xl font-bold" style={{ color: pfiClickedDesaDetail.color }}>
                            {pfiClickedDesaDetail.pfiScore.toFixed(1)}
                          </p>
                          <div
                            className="text-xs font-semibold px-2 py-1 rounded-full inline-block mt-1"
                            style={{ backgroundColor: `${pfiClickedDesaDetail.color}20`, color: pfiClickedDesaDetail.color, border: `1px solid ${pfiClickedDesaDetail.color}40` }}
                          >
                            {pfiClickedDesaDetail.category}
                          </div>
                          <p className="text-xs text-stone-500 mt-2">
                            HHI: {pfiClickedDesaDetail.hhi.toFixed(4)} &bull; Total Suara: {pfiClickedDesaDetail.totalSuaraSah.toLocaleString('id-ID')}
                          </p>
                        </div>
                      </div>

                      {/* Vote breakdown per candidate */}
                      <h4 className="font-semibold text-xs text-stone-700 mb-2 uppercase tracking-wide">Persebaran Suara Calon</h4>
                      <div className="space-y-2">
                        {pfiClickedDesaDetail.sortedCalon.map(([nama, suara], idx) => {
                          const pct = pfiClickedDesaDetail.totalSuaraSah > 0
                            ? (suara / pfiClickedDesaDetail.totalSuaraSah) * 100
                            : 0;
                          // Color bar based on vote share
                          const barColor = pct >= 50 ? '#22c55e' : pct >= 25 ? '#eab308' : pct >= 10 ? '#f97316' : '#64748b';
                          return (
                            <div key={idx} className="bg-stone-100/30 border border-stone-300/30 rounded p-2">
                              <div className="flex justify-between items-baseline text-xs mb-1.5">
                                <span className="font-medium text-stone-800 pr-2 truncate max-w-[60%]">{idx + 1}. {nama}</span>
                                <span className="font-bold text-stone-900 shrink-0">
                                  {suara.toLocaleString('id-ID')}
                                  <span className="text-stone-600 font-normal ml-1">({pct.toFixed(1)}%)</span>
                                </span>
                              </div>
                              <div className="w-full bg-white/80 rounded-full h-1.5">
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
                        <div className="p-4 bg-stone-100/60 border border-stone-300/50 rounded-lg text-center">
                          <p className="text-sm text-stone-600">Data tidak cukup untuk menghitung PFI di wilayah ini.</p>
                        </div>
                      ) : (
                        <>
                          <div className="bg-stone-100/40 border border-stone-300/50 rounded-lg p-3 mb-4 text-center shadow-inner">
                            <p className="text-xs text-stone-600 uppercase tracking-wider mb-1">Skor PFI</p>
                            <p className="text-4xl font-bold mb-1" style={{ color: aggregatedPfi.color }}>
                              {aggregatedPfi.score.toFixed(1)}
                            </p>
                            <div
                              className="text-xs font-semibold px-2 py-1 rounded-full inline-block mt-1"
                              style={{ backgroundColor: `${aggregatedPfi.color}20`, color: aggregatedPfi.color, border: `1px solid ${aggregatedPfi.color}40` }}
                            >
                              {aggregatedPfi.category}
                            </div>
                            <p className="text-xs text-stone-500 mt-3 pt-2 border-t border-stone-300/50">
                              HHI: {aggregatedPfi.hhi.toFixed(4)} &bull; {aggregatedData.sortedCalon.length} Calon
                            </p>
                          </div>

                          <p className="text-xs text-stone-500 italic mb-3">💡 Klik desa di peta untuk lihat detail</p>

                          {!highlightedDesa && aggregatedPfi.topFragmented.length > 0 && (
                            <div className="mb-4">
                              <h4 className="font-semibold text-xs text-stone-700 mb-2 uppercase tracking-wide">Desa Paling Cair (Fragmentasi Tinggi)</h4>
                              <div className="space-y-1.5">
                                {aggregatedPfi.topFragmented.slice(0, 5).map(([id, score], idx) => {
                                  const [desa, kec] = id.split('__');
                                  return (
                                    <button
                                      key={idx}
                                      onClick={() => setPfiClickedDesa({ desa, kec })}
                                      className="flex justify-between items-center text-xs bg-stone-100/30 hover:bg-stone-200/50 p-1.5 rounded w-full transition-colors"
                                    >
                                      <span className="text-stone-700 truncate pr-2">{idx + 1}. {desa}</span>
                                      <span className="font-mono font-medium shrink-0" style={{ color: getPFIColor(score) }}>{score.toFixed(1)}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {!highlightedDesa && aggregatedPfi.topDominant.length > 0 && (
                            <div className="mb-4">
                              <h4 className="font-semibold text-xs text-stone-700 mb-2 uppercase tracking-wide">Desa Paling Stabil (Dominan)</h4>
                              <div className="space-y-1.5">
                                {aggregatedPfi.topDominant.slice(0, 5).map(([id, score], idx) => {
                                  const [desa, kec] = id.split('__');
                                  return (
                                    <button
                                      key={idx}
                                      onClick={() => setPfiClickedDesa({ desa, kec })}
                                      className="flex justify-between items-center text-xs bg-stone-100/30 hover:bg-stone-200/50 p-1.5 rounded w-full transition-colors"
                                    >
                                      <span className="text-stone-700 truncate pr-2">{idx + 1}. {desa}</span>
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
                  <h4 className="font-semibold text-sm mb-2 text-stone-700 border-b border-stone-300 pb-2">
                    Perolehan Suara Calon
                    {selectedParty && <span className="text-xs text-red-600 ml-2 font-normal">({selectedParty} dipilih)</span>}
                  </h4>
                  <p className="text-xs text-stone-500 italic mb-2">Klik kartu untuk highlight di peta</p>
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent">
                    {aggregatedData.sortedCalon.map(([nama, suara]: [string, number], idx: number) => {
                      const pct = aggregatedData.total_suara_sah > 0 ? (suara / aggregatedData.total_suara_sah) * 100 : 0;
                      const isSelected = selectedParty === nama;
                      return (
                        <button
                          key={idx}
                          onClick={() => handlePartyClick(nama)}
                          className={`w-full text-left rounded p-2.5 border transition-all duration-200 ${
                            isSelected
                              ? 'bg-red-600 border-red-600 shadow-md text-white'
                              : 'bg-white border-stone-200 hover:bg-stone-50 hover:border-stone-300'
                          }`}
                        >
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className={`font-medium pr-2 ${isSelected ? 'text-white' : 'text-stone-800'}`}>
                              {isSelected && <span className="mr-1">📍</span>}{nama}
                            </span>
                            <span className={`font-bold ${isSelected ? 'text-white' : 'text-stone-900'}`}>
                              {suara.toLocaleString('id-ID')}
                              <span className={`font-normal ml-1 ${isSelected ? 'text-red-100' : 'text-stone-500'}`}>
                                ({pct.toFixed(1)}%)
                              </span>
                            </span>
                          </div>
                          {/* Progress Bar */}
                          <div className={`w-full rounded-full h-1.5 ${isSelected ? 'bg-red-800/50' : 'bg-stone-200'}`}>
                            <div
                              className={`h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-red-600'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                    {aggregatedData.sortedCalon.length === 0 && (
                      <p className="text-xs text-stone-500 italic text-center py-6">Data tidak tersedia untuk wilayah ini.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
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
          ? 'bg-red-600 text-white shadow-md'
          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
      }`}
    >
      <span className="shrink-0 transition-transform group-hover:scale-110">{icon}</span>
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
}
