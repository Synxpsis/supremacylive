// tabs.js — wires the top tab bar to the two independent apps (the
// single-tile view in main.js, the multi-tile board in board.js),
// showing/hiding their containers and pausing whichever one isn't on
// screen so it's not wasting a render loop in the background.
//
// It also owns the app-wide drag-and-drop:
//  - drop a saved .json layout anywhere and it loads straight in — the
//    JSON's own shape decides which view it belongs to (a board layout
//    has a "board"/"tiles" section; a single-tile layout doesn't) and
//    that view is switched to automatically.
//  - drop a .glb/.gltf model anywhere and it's registered as a new
//    placeable type and spawned onto whichever view is currently open
//    (the active tile in Tile View, or the active tile in Board View).

import { setActive as setTileActive, loadTileData, spawnType as spawnTileType } from './main.js';
import { setActive as setBoardActive, loadBoardData, spawnType as spawnBoardType } from './board.js';
import { registerGLBFile } from './glb.js';
import { showToast } from './toast.js';

const panes = {
  tile: document.getElementById('tile-tab'),
  board: document.getElementById('board-tab'),
};
const buttons = document.querySelectorAll('[data-tab]');
let currentTab = 'tile';

function showTab(name) {
  currentTab = name;
  for (const [key, el] of Object.entries(panes)) {
    el.classList.toggle('active', key === name);
  }
  buttons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  setTileActive(name === 'tile');
  setBoardActive(name === 'board');
}

buttons.forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

showTab('tile');

// ---------------------------------------------------------------------
// Drag-and-drop anywhere in the window: .json layouts or .glb/.gltf models
// ---------------------------------------------------------------------

const dropOverlay = document.getElementById('drop-overlay');
let dragDepth = 0;

window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.classList.add('show');
});

window.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
});

window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.remove('show');
});

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('show');

  const file = e.dataTransfer.files?.[0];
  if (!file) return;

  const lower = file.name.toLowerCase();
  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
    await handleGLBDrop(file);
  } else if (lower.endsWith('.json')) {
    await handleJSONDrop(file);
  } else {
    showToast(`"${file.name}" isn't a .json layout or a .glb/.gltf model`, { error: true });
  }
});

async function handleGLBDrop(file) {
  let key;
  try {
    const buffer = await file.arrayBuffer();
    key = await registerGLBFile(buffer, file.name);
  } catch (err) {
    console.error(err);
    showToast(`Couldn't load "${file.name}" — not a readable glTF/GLB file`, { error: true });
    return;
  }

  // Spawn onto whichever view is currently open.
  const entry = currentTab === 'board' ? spawnBoardType(key) : spawnTileType(key);
  if (currentTab === 'board' && !entry) {
    showToast(`Loaded ${file.name} — click a tile first, then add it from the palette`);
    return;
  }
  showToast(`Loaded ${file.name} — added to the ${currentTab === 'board' ? 'active tile' : 'scene'}`);
}

async function handleJSONDrop(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showToast(`Couldn't parse "${file.name}" — not valid JSON`, { error: true });
    return;
  }

  const isBoardLayout = Array.isArray(data.objects)
    ? data.objects.some((o) => 'tileX' in o) || !!data.board || !!data.tiles
    : !!data.board;

  try {
    if (isBoardLayout) {
      showTab('board');
      await loadBoardData(data);
    } else {
      showTab('tile');
      await loadTileData(data);
    }
  } catch (err) {
    console.error(err);
    showToast(`Loaded ${file.name}, but a model inside it failed to load`, { error: true });
    return;
  }

  const count = data.objects?.length ?? 0;
  showToast(`Loaded ${file.name} — ${count} object${count === 1 ? '' : 's'}`);
}
