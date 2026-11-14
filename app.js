"use strict";

// Print-oriented palette: bright CMYK process inks (0% black, at most 92% total ink).
// The screen colors are converted from these CMYK values; print shops may still apply
// their own ICC profile when converting browser/SVG artwork to a press-ready PDF.
function cmykToHex(c, m, y, k = 0) {
  const channel = (ink) => Math.round(255 * (1 - ink) * (1 - k)).toString(16).padStart(2, "0");
  return `#${channel(c)}${channel(m)}${channel(y)}`;
}

function makePrintPalette() {
  return Array.from({ length: 40 }, (_, index) => {
    // Pair two vividness levels across 20 hues, then choose a distinct subset per board size.
    const hue = Math.floor(index / 2) / 20 * 360, chroma = index % 2 ? 0.46 : 0.34;
    const sector = hue / 60, x = chroma * (1 - Math.abs(sector % 2 - 1));
    const [r, g, b] = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0]
      : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma]
        : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
    const light = 1 - chroma;
    return cmykToHex(1 - (r + light), 1 - (g + light), 1 - (b + light));
  });
}

const PALETTE = makePrintPalette();
const DIFFICULTIES = { easy: { label: "سهل", clues: 0.68 }, medium: { label: "متوسط", clues: 0.48 }, hard: { label: "صعب", clues: 0.30 } };
const state = { puzzles: [], currentIndex: 0, gesture: null, clickTimer: null, reveal: false, suppressClick: null };
const $ = (selector) => document.querySelector(selector);

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

function colorLab(hex) {
  const rgb = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb;
  const xyz = [(r * .4124 + g * .3576 + b * .1805) / .95047,
    (r * .2126 + g * .7152 + b * .0722), (r * .0193 + g * .1192 + b * .9505) / 1.08883]
    .map((value) => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}

function makeColorSeparationOrder() {
  const labs = PALETTE.map(colorLab);
  const distance = (a, b) => Math.hypot(labs[a][0] - labs[b][0], labs[a][1] - labs[b][1], labs[a][2] - labs[b][2]);
  let pair = [0, 1], farthest = -1;
  for (let a = 0; a < PALETTE.length; a++) for (let b = a + 1; b < PALETTE.length; b++) {
    const gap = distance(a, b);
    if (gap > farthest) { farthest = gap; pair = [a, b]; }
  }
  const order = pair, selected = new Set(pair);
  while (order.length < PALETTE.length) {
    let best = -1, bestGap = -1;
    for (let candidate = 0; candidate < PALETTE.length; candidate++) {
      if (selected.has(candidate)) continue;
      const gap = Math.min(...order.map((chosen) => distance(candidate, chosen)));
      if (gap > bestGap) { best = candidate; bestGap = gap; }
    }
    order.push(best); selected.add(best);
  }
  return order;
}

const PALETTE_SEPARATION_ORDER = makeColorSeparationOrder();

function assignRegionColors(regions, size) {
  const colors = PALETTE_SEPARATION_ORDER.slice(0, size).map((index) => PALETTE[index]);
  const adjacency = Array.from({ length: size }, () => new Set());
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const cell = row * size + col, region = regions[cell];
    if (col + 1 < size && regions[cell + 1] !== region) {
      adjacency[region].add(regions[cell + 1]); adjacency[regions[cell + 1]].add(region);
    }
    if (row + 1 < size && regions[cell + size] !== region) {
      adjacency[region].add(regions[cell + size]); adjacency[regions[cell + size]].add(region);
    }
  }
  const labs = colors.map(colorLab);
  const distance = (a, b) => Math.hypot(labs[a][0] - labs[b][0], labs[a][1] - labs[b][1], labs[a][2] - labs[b][2]);
  let bestColors = null, bestScore = -1;
  // Try several greedy colorings; keep the one with the clearest neighboring regions.
  for (let attempt = 0; attempt < 48; attempt++) {
    const order = shuffle(Array.from({ length: size }, (_, i) => i)).sort((a, b) => adjacency[b].size - adjacency[a].size);
    const assigned = Array(size).fill(-1), used = new Set();
    for (const region of order) {
      let choices = shuffle(Array.from({ length: size }, (_, i) => i).filter((i) => !used.has(i)));
      choices.sort((a, b) => {
        const minA = Math.min(...[...adjacency[region]].filter((n) => assigned[n] >= 0).map((n) => distance(a, assigned[n])), Infinity);
        const minB = Math.min(...[...adjacency[region]].filter((n) => assigned[n] >= 0).map((n) => distance(b, assigned[n])), Infinity);
        return minB - minA || Number(used.has(a)) - Number(used.has(b));
      });
      assigned[region] = choices[0]; used.add(choices[0]);
    }
    let score = Infinity;
    for (let region = 0; region < size; region++) for (const other of adjacency[region]) {
      if (other > region) score = Math.min(score, distance(assigned[region], assigned[other]));
    }
    if (score > bestScore) { bestScore = score; bestColors = assigned; }
  }
  return bestColors.map((color) => colors[color]);
}

function neighbours(index, size) {
  const row = Math.floor(index / size), col = index % size;
  const list = [];
  if (row) list.push(index - size); if (row < size - 1) list.push(index + size);
  if (col) list.push(index - 1); if (col < size - 1) list.push(index + 1);
  return list;
}

function makeStarSolution(size) {
  const solution = Array(size).fill(-1), used = new Set();
  function place(row) {
    if (row === size) return true;
    for (const col of shuffle(Array.from({ length: size }, (_, i) => i))) {
      if (used.has(col) || (row > 0 && Math.abs(solution[row - 1] - col) <= 1)) continue;
      solution[row] = col; used.add(col);
      if (place(row + 1)) return true;
      solution[row] = -1; used.delete(col);
    }
    return false;
  }
  return place(0) ? solution : null;
}

function makeConnectedRegions(solution, size) {
  const total = size * size;
  const regions = Array(total).fill(-1);
  const queue = [];
  for (let row = 0; row < size; row++) { const seed = row * size + solution[row]; regions[seed] = row; queue.push(seed); }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor], region = regions[cell];
    for (const next of shuffle(neighbours(cell, size))) {
      if (regions[next] === -1) { regions[next] = region; queue.push(next); }
    }
  }
  return regions;
}

function countSolutions(size, regions, givens, limit = 2) {
  const usedCols = new Set(), usedRegions = new Set();
  const choices = Array(size).fill(-1);
  for (const [rowText, col] of Object.entries(givens)) {
    const row = Number(rowText), region = regions[row * size + col];
    if (usedCols.has(col) || usedRegions.has(region)) return 0;
    usedCols.add(col); usedRegions.add(region); choices[row] = col;
  }
  for (let row = 0; row < size - 1; row++) {
    if (choices[row] !== -1 && choices[row + 1] !== -1 && Math.abs(choices[row] - choices[row + 1]) <= 1) return 0;
  }
  let count = 0;
  function search() {
    if (count >= limit) return;
    let bestRow = -1, bestOptions = null;
    for (let row = 0; row < size; row++) {
      if (choices[row] !== -1) continue;
      const options = [];
      for (let col = 0; col < size; col++) {
        const region = regions[row * size + col];
        const touchesPrevious = row > 0 && choices[row - 1] !== -1 && Math.abs(choices[row - 1] - col) <= 1;
        const touchesNext = row < size - 1 && choices[row + 1] !== -1 && Math.abs(choices[row + 1] - col) <= 1;
        if (!usedCols.has(col) && !usedRegions.has(region) && !touchesPrevious && !touchesNext) options.push(col);
      }
      if (!options.length) return;
      if (!bestOptions || options.length < bestOptions.length) { bestRow = row; bestOptions = options; }
      if (options.length === 1) break;
    }
    if (bestRow === -1) { count++; return; }
    for (const col of bestOptions) {
      const region = regions[bestRow * size + col];
      usedCols.add(col); usedRegions.add(region); choices[bestRow] = col;
      search();
      choices[bestRow] = -1; usedCols.delete(col); usedRegions.delete(region);
      if (count >= limit) return;
    }
  }
  search();
  return count;
}

function generatePuzzle(size, difficulty) {
  const solution = makeStarSolution(size);
  const regions = makeConnectedRegions(solution, size);
  const target = Math.max(1, Math.round(size * DIFFICULTIES[difficulty].clues));
  // Start from a known unique puzzle (the full solution), then remove clues only
  // while the solver still finds exactly one valid completion.
  const givens = Object.fromEntries(solution.map((col, row) => [row, col]));
  for (const row of shuffle(Array.from({ length: size }, (_, i) => i))) {
    if (Object.keys(givens).length <= target) break;
    const oldCol = givens[row]; delete givens[row];
    if (countSolutions(size, regions, givens) !== 1) givens[row] = oldCol;
  }
  if (countSolutions(size, regions, givens) !== 1) throw new Error("تعذّر ضمان حل وحيد لهذا اللغز.");
  return { id: crypto.randomUUID(), size, difficulty, solution, regions, colors: assignRegionColors(regions, size), givens, marks: Array(size * size).fill("") };
}

function currentPuzzle() { return state.puzzles[state.currentIndex]; }
function regionColor(puzzle, cell) { return puzzle.colors?.[puzzle.regions[cell]] || PALETTE[puzzle.regions[cell] % PALETTE.length]; }

function findConflicts(puzzle) {
  const stars = [];
  puzzle.marks.forEach((mark, index) => { if (mark === "star") stars.push(index); });
  for (const [row, col] of Object.entries(puzzle.givens)) stars.push(Number(row) * puzzle.size + col);
  const starSet = new Set(stars);
  const conflicts = new Set();
  const rowMap = new Map(), colMap = new Map(), regionMap = new Map();
  for (const cell of stars) {
    const row = Math.floor(cell / puzzle.size), col = cell % puzzle.size, region = puzzle.regions[cell];
    for (const [map, key] of [[rowMap, row], [colMap, col], [regionMap, region]]) {
      if (!map.has(key)) map.set(key, []); map.get(key).push(cell);
    }
  }
  for (const map of [rowMap, colMap, regionMap]) for (const cells of map.values()) if (cells.length > 1) cells.forEach((cell) => conflicts.add(cell));
  for (const cell of stars) {
    const row = Math.floor(cell / puzzle.size), col = cell % puzzle.size;
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) for (let colOffset = -1; colOffset <= 1; colOffset++) {
      if (rowOffset === 0 && colOffset === 0) continue;
      const nextRow = row + rowOffset, nextCol = col + colOffset;
      if (nextRow < 0 || nextRow >= puzzle.size || nextCol < 0 || nextCol >= puzzle.size) continue;
      const next = nextRow * puzzle.size + nextCol;
      if (starSet.has(next)) { conflicts.add(cell); conflicts.add(next); }
    }
  }
  for (const [rowText, col] of Object.entries(puzzle.givens)) {
    const clue = Number(rowText) * puzzle.size + col;
    for (const cell of stars) {
      if (cell === clue) continue;
      const row = Math.floor(cell / puzzle.size), cellCol = cell % puzzle.size;
      if (row === Number(rowText) || cellCol === col || puzzle.regions[cell] === puzzle.regions[clue]) { conflicts.add(cell); conflicts.add(clue); }
    }
  }
  return conflicts;
}

function renderBoard() {
  const puzzle = currentPuzzle(); if (!puzzle) return;
  const board = document.createElement("div"); board.className = "game-board"; board.style.setProperty("--size", puzzle.size);
  board.setAttribute("role", "grid"); board.setAttribute("aria-label", `شبكة لغز ${puzzle.size} في ${puzzle.size}`);
  const conflicts = findConflicts(puzzle);
  for (let index = 0; index < puzzle.size * puzzle.size; index++) {
    const row = Math.floor(index / puzzle.size), col = index % puzzle.size, isGiven = puzzle.givens[row] === col;
    const visibleMark = isGiven ? "star" : state.reveal ? (puzzle.solution[row] === col ? "star" : "") : puzzle.marks[index];
    const cell = document.createElement("button"); cell.type = "button"; cell.className = "cell";
    cell.style.setProperty("--region-color", regionColor(puzzle, index));
    cell.style.fontSize = `min(7vw, ${Math.max(10, 36 - puzzle.size)}px)`;
    cell.dataset.index = String(index); cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `صف ${row + 1}، عمود ${col + 1}${isGiven ? "، نجمة معطاة" : visibleMark === "star" ? "، نجمة" : visibleMark === "x" ? "، مستبعدة" : "، فارغة"}`);
    if (isGiven) cell.classList.add("given");
    if (conflicts.has(index) && !isGiven) cell.classList.add("conflict");
    if (state.reveal && visibleMark === "star" && !isGiven) cell.classList.add("solution-mark");
    if (visibleMark === "star") cell.innerHTML = '<span class="star" aria-hidden="true">★</span>';
    else if (visibleMark === "x") cell.innerHTML = '<span class="x-mark" aria-hidden="true">×</span>';
    if (!isGiven && !state.reveal) attachCellActions(cell, index, board);
    board.append(cell);
  }
  const wrap = $("#board-wrap"); wrap.replaceChildren(board);
  $("#current-meta").textContent = `لغز ${state.currentIndex + 1} · ${puzzle.size}×${puzzle.size} · ${DIFFICULTIES[puzzle.difficulty].label}`;
}

function setMark(index, mark) {
  const puzzle = currentPuzzle(); if (!puzzle) return;
  const row = Math.floor(index / puzzle.size);
  if (puzzle.givens[row] === index % puzzle.size) return;
  puzzle.marks[index] = puzzle.marks[index] === mark ? "" : mark;
  renderBoard();
  const conflicts = findConflicts(puzzle);
  const message = $("#game-message"); message.className = `game-message${conflicts.size ? " error" : ""}`;
  message.textContent = conflicts.size ? "فيه تعارض في النجوم المضافة. الخانات المتعارضة محددة بالوردي." : "تم تحديث الخانة. تابعي وضع النجوم في الصفوف والأعمدة والمناطق.";
}

function attachCellActions(cell, index) {
  cell.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    state.gesture = { pointerId: event.pointerId, start: index, last: index, dragged: false, visited: new Set([index]) };
  });
  cell.addEventListener("pointerenter", (event) => markDraggedCell(event.pointerId, index));
  cell.addEventListener("click", (event) => {
    if (state.suppressClick === index) { state.suppressClick = null; return; }
    if (event.detail > 1) {
      clearTimeout(state.clickTimer); state.clickTimer = null;
      if (state.gesture?.dragged) return;
      setMark(index, "star"); return;
    }
    const isDrag = state.gesture?.dragged;
    if (isDrag) return;
    clearTimeout(state.clickTimer);
    state.clickTimer = setTimeout(() => { setMark(index, "x"); state.clickTimer = null; }, 260);
  });
}

function markDraggedCell(pointerId, index) {
  const gesture = state.gesture;
  if (!gesture || gesture.pointerId !== pointerId || gesture.start === index) return;
  gesture.dragged = true;
  if (!gesture.visited.has(gesture.start)) { gesture.visited.add(gesture.start); paintX(gesture.start); }
  if (!gesture.visited.has(index)) { gesture.visited.add(index); paintX(index); }
  gesture.last = index;
}

document.addEventListener("pointermove", (event) => {
  if (!state.gesture || state.gesture.pointerId !== event.pointerId) return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const cell = target?.closest?.(".cell");
  if (cell) markDraggedCell(event.pointerId, Number(cell.dataset.index));
});

function paintX(index) {
  const puzzle = currentPuzzle(); if (!puzzle) return;
  const row = Math.floor(index / puzzle.size); if (puzzle.givens[row] === index % puzzle.size) return;
  if (puzzle.marks[index] !== "x") { puzzle.marks[index] = "x"; const cell = document.querySelector(`.cell[data-index="${index}"]`); if (cell) { cell.innerHTML = '<span class="x-mark" aria-hidden="true">×</span>'; cell.setAttribute("aria-label", `صف ${row + 1}، عمود ${index % puzzle.size + 1}، مستبعدة`); } }
}

document.addEventListener("pointerup", (event) => {
  if (state.gesture && state.gesture.pointerId === event.pointerId) {
    const wasDrag = state.gesture.dragged, start = state.gesture.start; state.gesture = null;
    if (wasDrag) {
      state.suppressClick = start;
      setTimeout(() => { if (state.suppressClick === start) state.suppressClick = null; }, 350);
    }
    if (wasDrag) { clearTimeout(state.clickTimer); state.clickTimer = null; $("#game-message").textContent = "تم وضع علامات X على الخانات المحددة."; }
  }
});
document.addEventListener("pointercancel", () => { state.gesture = null; });

function startNewGame(size, difficulty) {
  state.puzzles = [generatePuzzle(size, difficulty)]; state.currentIndex = 0; state.reveal = false;
  $("#print-document").replaceChildren(); $("#print-button").disabled = true; $("#images-button").disabled = true;
  $("#batch-status").textContent = "أنشئي مجموعة، ثم اطبعيها أو نزّلي صفحاتها كصور.";
  renderCollection();
  $("#game-message").className = "game-message"; $("#game-message").textContent = "ضغطة واحدة لعلامة X، ضغطتان لوضع نجمة، واسحبي لتمييز عدة خانات.";
  renderBoard();
}

function renderCollection() {
  const wrap = $("#collection"), list = $("#puzzle-list");
  if (state.puzzles.length < 2) { wrap.hidden = true; return; }
  wrap.hidden = false; $("#collection-count").textContent = `${state.puzzles.length} ألغاز`;
  list.replaceChildren();
  state.puzzles.forEach((puzzle, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `puzzle-chip${index === state.currentIndex ? " active" : ""}`;
    button.textContent = `لغز ${index + 1}`; button.addEventListener("click", () => { state.currentIndex = index; state.reveal = false; renderBoard(); renderCollection(); }); list.append(button);
  });
}

function checkPuzzle() {
  const puzzle = currentPuzzle(), conflicts = findConflicts(puzzle), message = $("#game-message");
  if (conflicts.size) { message.className = "game-message error"; message.textContent = "ما زال هناك تعارض بين بعض النجوم. راجعي الصفوف والأعمدة والمناطق الملوّنة."; return; }
  const stars = new Set(); puzzle.marks.forEach((mark, index) => { if (mark === "star") stars.add(index); });
  Object.entries(puzzle.givens).forEach(([row, col]) => stars.add(Number(row) * puzzle.size + col));
  if (stars.size !== puzzle.size) { message.className = "game-message"; message.textContent = `أحسنتِ، لا توجد تعارضات. أضيفي ${puzzle.size - stars.size} نجمة لإكمال الحل.`; return; }
  const solved = Array.from(stars).every((cell) => puzzle.solution[Math.floor(cell / puzzle.size)] === cell % puzzle.size);
  message.className = `game-message ${solved ? "success" : "error"}`;
  message.textContent = solved ? "رائع! حل صحيح، كل النجوم في أماكنها! 👑" : "لا توجد تعارضات، لكن بعض النجوم ليست في الحل. جرّبي مرة أخرى أو شاهدي الحل.";
}

function buildPrintDocument(puzzles, paper) {
  const doc = $("#print-document"); doc.replaceChildren();
  const makePage = (className, inner) => { const page = document.createElement("article"); page.className = `print-page size-${paper}`; page.innerHTML = inner; doc.append(page); };
  puzzles.forEach((puzzle, index) => {
    const cells = Array.from({ length: puzzle.size * puzzle.size }, (_, cell) => {
      const row = Math.floor(cell / puzzle.size), col = cell % puzzle.size;
      return `<div class="print-cell" style="--region-color:${regionColor(puzzle, cell)}">${puzzle.givens[row] === col ? '<span class="print-star">★</span>' : ""}</div>`;
    }).join("");
    makePage("puzzle-page", `<header class="print-head"><div><div class="print-brand">♛ كوين ستار</div><div class="print-subtitle">تحديات منطقية بالألوان</div></div><div class="print-number">${DIFFICULTIES[puzzle.difficulty].label} · ${puzzle.size}×${puzzle.size}</div></header><div class="print-grid" style="--size:${puzzle.size}">${cells}</div><footer class="print-foot"><span>نجمة واحدة في كل صف وعمود ومنطقة · النجوم لا تتلامس</span><span>${index + 1}</span></footer>`);
  });
  for (let start = 0; start < puzzles.length; start += paper === "A5" ? 1 : 4) {
    const group = puzzles.slice(start, start + (paper === "A5" ? 1 : 4));
    const cards = group.map((puzzle, i) => {
      const absolute = start + i, cells = Array.from({ length: puzzle.size * puzzle.size }, (_, cell) => {
        const row = Math.floor(cell / puzzle.size), col = cell % puzzle.size;
        return `<div class="solution-cell" style="--region-color:${regionColor(puzzle, cell)}">${puzzle.solution[row] === col ? "★" : ""}</div>`;
      }).join("");
      return `<section class="solution-card"><h3>حل اللغز ${absolute + 1}</h3><div class="solution-grid" style="--size:${puzzle.size}">${cells}</div></section>`;
    }).join("");
    makePage("solutions-page", `<h2 class="print-answer-title">حلول الألغاز</h2><div class="print-solutions">${cards}</div><footer class="print-foot"><span>كوين ستار · الإجابات</span><span>${Math.floor(start / (paper === "A5" ? 1 : 4)) + 1}</span></footer>`);
  }
}

function makePuzzleSvg(puzzle, index) {
  const size = puzzle.size, cell = 1000 / size, gap = 1.3, lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2800" viewBox="0 0 1200 1400"><rect width="1200" height="1400" fill="#ffffff"/><text x="600" y="90" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="700" fill="#17377f" direction="rtl">كوين ستار · لغز ${index + 1}</text><text x="600" y="150" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#d40080" direction="rtl">${size}×${size} · ${DIFFICULTIES[puzzle.difficulty].label}</text><g transform="translate(100 220)">`);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const indexCell = row * size + col, x = col * cell, y = row * cell;
    lines.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${regionColor(puzzle, indexCell)}" stroke="#393295" stroke-width="${gap}"/>`);
    if (puzzle.givens[row] === col) lines.push(`<text x="${x + cell / 2}" y="${y + cell * .72}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${cell * .68}" fill="#edaa22">★</text>`);
  }
  lines.push(`</g><text x="600" y="1330" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#53618c" direction="rtl">نجمة واحدة في كل صف وعمود ومنطقة · النجوم لا تتلامس</text></svg>`);
  return lines.join("");
}

function populateSizeOptions() {
  const select = $("#grid-size");
  for (let size = 6; size <= 20; size++) { const option = document.createElement("option"); option.value = String(size); option.textContent = `${size} × ${size}`; if (size === 6) option.selected = true; select.append(option); }
}

$("#batch-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const count = Math.max(1, Math.min(100, Number($("#batch-count").value) || 1));
  const size = Number($("#grid-size").value), difficulty = $("#difficulty").value, paper = $("#paper-size").value;
  const button = $("#generate-button"), status = $("#batch-status"); button.disabled = true; status.className = "batch-status busy"; status.textContent = `جاري توليد ${count} لغز…`;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const puzzles = [];
  for (let i = 0; i < count; i++) {
    puzzles.push(generatePuzzle(size, difficulty));
    if ((i + 1) % 5 === 0 || i + 1 === count) {
      status.textContent = `جاري توليد الألغاز… ${i + 1} من ${count}`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  state.puzzles = puzzles; state.currentIndex = 0; state.reveal = false;
  renderBoard(); renderCollection(); buildPrintDocument(puzzles, paper);
  $("#print-button").disabled = false; $("#images-button").disabled = false;
  status.className = "batch-status"; status.textContent = `تم إنشاء ${count} لغز بحجم ${size}×${size} — الحلول جاهزة للطباعة في قسم منفصل.`; button.disabled = false;
});

$("#print-button").addEventListener("click", () => { window.print(); });
$("#images-button").addEventListener("click", () => {
  state.puzzles.forEach((puzzle, index) => {
    const blob = new Blob([makePuzzleSvg(puzzle, index + 1)], { type: "image/svg+xml;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `queen-star-puzzle-${String(index + 1).padStart(3, "0")}.svg`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  });
  $("#batch-status").textContent = `بدأ تنزيل ${state.puzzles.length} صورة SVG عالية الجودة.`;
});
$("#new-game-button").addEventListener("click", () => startNewGame(Number($("#grid-size").value), $("#difficulty").value));
$("#check-button").addEventListener("click", checkPuzzle);
$("#reveal-button").addEventListener("click", () => { state.reveal = !state.reveal; renderBoard(); $("#reveal-button").textContent = state.reveal ? "إخفاء الحل" : "إظهار الحل"; });

populateSizeOptions();
startNewGame(6, "medium");

