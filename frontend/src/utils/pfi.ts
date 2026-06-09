export function calculateHHI(votes: number[]): number {
  if (!votes || votes.length === 0) return 0;
  
  const validVotes = votes.filter(v => v > 0);
  if (validVotes.length === 0) return 0;
  if (validVotes.length === 1) return 1;

  const totalVotes = validVotes.reduce((sum, v) => sum + v, 0);
  if (totalVotes === 0) return 0;

  const hhi = validVotes.reduce((sum, v) => {
    const proportion = v / totalVotes;
    return sum + (proportion * proportion);
  }, 0);

  return hhi;
}

export function calculatePFI(votes: number[]): number {
  const hhi = calculateHHI(votes);
  if (hhi === 0 && votes.reduce((sum, v) => sum + (v > 0 ? v : 0), 0) === 0) return -1; // -1 as marker for insufficient data
  if (hhi === 1) return 0; // single candidate

  const pfi = (1 - hhi) * 100;
  return pfi;
}

export function getPFICategory(score: number): string {
  if (score < 0) return "Data Tidak Cukup";
  if (score <= 30) return "Dominan / Terkonsentrasi";
  if (score <= 50) return "Cukup Stabil";
  if (score <= 70) return "Kompetitif";
  return "Sangat Terfragmentasi / Cair";
}

export function getPFIColor(score: number): string {
  if (score < 0) return "#475569"; // slate-600
  if (score <= 30) return "#22c55e"; // green-500
  if (score <= 50) return "#eab308"; // yellow-500
  if (score <= 70) return "#f97316"; // orange-500
  return "#ef4444"; // red-500
}
