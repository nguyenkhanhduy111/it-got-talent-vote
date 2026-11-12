// Logic thuần dùng ở trình duyệt và được kiểm thử bằng Node.

/** Chỉ nhận trạng thái mới hơn (chống dữ liệu realtime sai thứ tự / gửi lại). */
export function acceptState(current, incoming) {
  if (!incoming || typeof incoming.version !== 'number') return false;
  if (!current) return true;
  return incoming.version > current.version;
}

/**
 * Quyết định có phát cue từ máy chủ hay không.
 * - lastSeq: số thứ tự cue đã xử lý (null = vừa tải trang: ghi nhận, không phát cue cũ)
 * - cue: {seq,name,at}; serverNow: giờ máy chủ ước tính
 * Cue quá hạn (maxAgeMs) bị bỏ, không xếp hàng phát muộn.
 */
export function cueDecision(lastSeq, cue, serverNow, maxAgeMs = 4000) {
  if (!cue || typeof cue.seq !== 'number') return { play: false, seq: lastSeq };
  if (lastSeq === null || lastSeq === undefined) return { play: false, seq: cue.seq };
  if (cue.seq <= lastSeq) return { play: false, seq: lastSeq };
  const fresh = serverNow - cue.at <= maxAgeMs && cue.name;
  return { play: !!fresh, seq: cue.seq };
}

/** So sánh hai bảng hạng trực tiếp -> thay đổi hạng và đổi ngôi đầu. */
export function diffRanking(prevRows, nextRows) {
  const prevRank = new Map((prevRows || []).map((r) => [r.teamId, r.rank]));
  const changes = [];
  for (const r of nextRows) {
    const p = prevRank.get(r.teamId);
    if (p !== undefined && p !== r.rank) changes.push({ teamId: r.teamId, from: p, to: r.rank, delta: p - r.rank });
  }
  const lead = (rows) => (rows || []).filter((r) => r.rank === 1 && r.votes > 0).map((r) => r.teamId).sort((a, b) => a - b);
  const pl = lead(prevRows); const nl = lead(nextRows);
  const prevTotal = (prevRows || []).reduce((s, r) => s + r.votes, 0);
  const leaderChanged = prevTotal > 0 && nl.length === 1 && !(pl.length === 1 && pl[0] === nl[0]);
  return { changes, leaderChanged, newLeader: leaderChanged ? nl[0] : null };
}

/** Bám đuổi sát nút: chênh lệch hạng 1 và hạng 2 trong ngưỡng (và chưa đồng hạng). */
export function isCloseRace(rows, margin) {
  if (!rows || rows.length < 2) return false;
  const sorted = [...rows].sort((a, b) => b.votes - a.votes);
  const diff = sorted[0].votes - sorted[1].votes;
  return sorted[0].votes > 0 && diff > 0 && diff <= margin;
}

/** Gộp hàng đợi hiệu ứng: ưu tiên cao thắng, mỗi thời điểm một hiệu ứng chính. */
export const FX_PRIORITY = { announce: 3, leader: 2, rankup: 1 };
export function pickBanner(current, candidate, now) {
  if (!candidate) return current;
  if (!current || now >= current.until) return candidate;
  return FX_PRIORITY[candidate.kind] > FX_PRIORITY[current.kind] ? candidate : current;
}
