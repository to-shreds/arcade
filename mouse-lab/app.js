const STORAGE_KEY = 'arcade.mouse-lab.progress.v1';
const difficultySettings = {
  easy: { target: 48, movingSpeed: .85, traceWidth: 17, hold: 650 },
  steady: { target: 38, movingSpeed: 1.1, traceWidth: 13, hold: 900 },
  challenge: { target: 28, movingSpeed: 1.5, traceWidth: 10, hold: 1200 }
};
const lessons = [
  ['click', 'Click', 'Click the dots. They get smaller as you go.', clickTargets],
  ['aim', 'Aim', 'Click the small dots as they appear. Try moving the pointer to the middle of each dot.', clickTargets],
  ['moving', 'Moving targets', 'Click or tap the moving dot three times. Pause it any time to practice with a still dot.', clickTargets],
  ['sort', 'Drag and drop', 'Drag each tile to its matching folder. You can also choose a tile, then choose its folder.', sortTiles],
  ['trace', 'Trace', 'Start at the yellow dot. Hold down the button and follow the line through each dot. On a touchscreen, slide your finger along the line.', tracePath],
  ['hold', 'Click and hold', 'Press the pad and keep holding until it lights up. Try a mouse button, a finger, or the Space key.', holdPad],
  ['double', 'Double-click', 'Click twice quickly using the left mouse button. On a touchscreen, tap twice. With a keyboard, press Enter twice.', doubleClick],
  ['right', 'Right-click', 'Press the right mouse button on the card to open its menu. On a touchscreen or keyboard, use Open card menu.', rightClick],
  ['wheel', 'Scroll', 'Point at the box and turn the mouse wheel down to find the finish button. You can also swipe inside the box or use the arrow keys while it has focus.', scrollBox],
  ['files', 'Folders and files', 'Open the school folder and find the drawing called Moon. This is a pretend desktop.', desktop]
].map(([id, title, instructions, render]) => ({ id, title, instructions, render }));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const stage = document.getElementById('stage');
const lessonTitle = document.getElementById('lesson-title');
const instructions = document.getElementById('instructions');
const feedback = document.getElementById('feedback');
const lessonMenu = document.getElementById('lessons');
const difficultyPicker = document.getElementById('difficulty');
const progressCaption = document.getElementById('progress');
const repeat = document.getElementById('repeat');
const next = document.getElementById('next');
const resetDialog = document.getElementById('reset-dialog');
const progress = readProgress();
const lessonButtons = new Map();
let releaseLesson = () => {};

function readProgress() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
  const knownLesson = id => lessons.some(lesson => lesson.id === id);
  return {
    active: knownLesson(saved?.active) ? saved.active : lessons[0].id,
    difficulty: Object.hasOwn(difficultySettings, saved?.difficulty) ? saved.difficulty : 'easy',
    completed: new Set(Array.isArray(saved?.completed) ? saved.completed.filter(knownLesson) : [])
  };
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      active: progress.active,
      difficulty: progress.difficulty,
      completed: [...progress.completed]
    }));
  } catch {}
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label, className = 'arcade-btn') {
  const node = element('button', className, label);
  node.type = 'button';
  return node;
}

function refreshProgress() {
  for (const [id, control] of lessonButtons) {
    if (id === progress.active) control.setAttribute('aria-current', 'step');
    else control.removeAttribute('aria-current');
    const completed = progress.completed.has(id);
    control.lastElementChild.hidden = !completed;
    const title = lessons.find(lesson => lesson.id === id).title;
    control.setAttribute('aria-label', completed ? `${title}, completed` : title);
  }
  progressCaption.textContent = `${progress.completed.size} of ${lessons.length} exercises completed`;
}

function openLesson(id, focus = false) {
  releaseLesson();
  releaseLesson = () => {};
  const lesson = lessons.find(item => item.id === id);
  progress.active = id;
  saveProgress();
  refreshProgress();
  lessonTitle.textContent = lesson.title;
  if (focus) lessonTitle.focus();
  instructions.textContent = lesson.instructions;
  stage.replaceChildren();
  feedback.textContent = '';
  next.hidden = true;
  next.textContent = id === lessons.at(-1).id ? 'First exercise' : 'Next exercise';
  let complete = false;
  const finish = message => {
    if (complete) return;
    complete = true;
    progress.completed.add(id);
    saveProgress();
    refreshProgress();
    feedback.textContent = message || 'Nice work! You finished this exercise.';
    next.hidden = false;
  };
  releaseLesson = lesson.render({ id, settings: difficultySettings[progress.difficulty], finish }) || (() => {});
}

function clickTargets({ id, settings, finish }) {
  const moving = id === 'moving';
  const precise = id === 'aim';
  const stations = precise
    ? [[.19, .28], [.76, .59], [.54, .24], [.22, .72], [.82, .31], [.63, .78]]
    : [[.5, .45], [.29, .35], [.72, .66], [.24, .72], [.79, .27]];
  const goal = moving ? 3 : stations.length;
  const playfield = element('div', 'playfield');
  const target = button('+', moving ? 'target move' : 'target');
  playfield.append(target);
  stage.append(playfield);
  let hit = 0;
  let frame;
  let keepStill = reducedMotion.matches;
  let elapsed = 0;
  let previousFrame;
  let motionControl;
  const place = (x, y) => {
    target.style.left = `${x * 100}%`;
    target.style.top = `${y * 100}%`;
  };
  const tick = now => {
    const delta = previousFrame ? Math.min(now - previousFrame, 32) : 0;
    previousFrame = now;
    if (!keepStill && !target.matches(':focus-visible') && !document.hidden) {
      elapsed += delta * settings.movingSpeed;
      place(.5 + .28 * Math.sin(elapsed / 850 + hit), .5 + .22 * Math.sin(elapsed / 570 + hit));
    }
    frame = requestAnimationFrame(tick);
  };
  function showTarget() {
    const size = id === 'click' ? settings.target + (goal - 1 - hit) * 10 : settings.target;
    target.style.width = target.style.height = `${size}px`;
    target.setAttribute('aria-label', `Target ${hit + 1} of ${goal}`);
    place(...stations[hit]);
  }
  target.addEventListener('click', () => {
    hit++;
    if (hit === goal) {
      const hadFocus = document.activeElement === target;
      target.hidden = true;
      if (motionControl) motionControl.hidden = true;
      cancelAnimationFrame(frame);
      finish(`You hit all ${goal} targets!`);
      if (hadFocus) next.focus();
      return;
    }
    feedback.textContent = `${hit} of ${goal} targets. Find the next dot.`;
    showTarget();
  });
  playfield.addEventListener('click', event => {
    if (event.target === playfield && hit < goal) feedback.textContent = 'You clicked beside the dot. Try the middle.';
  });
  showTarget();
  if (moving) {
    motionControl = element('label', 'small-control', 'Pause moving targets');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = keepStill;
    checkbox.addEventListener('change', () => { keepStill = checkbox.checked; });
    motionControl.prepend(checkbox);
    stage.append(motionControl);
    frame = requestAnimationFrame(tick);
  }
  return () => cancelAnimationFrame(frame);
}

function sortTiles({ finish }) {
  const pieces = [
    { label: 'Apple', folder: 'Fruit' },
    { label: 'Triangle', folder: 'Shapes' },
    { label: 'Dog', folder: 'Animals' }
  ];
  const board = element('div', 'sort-board');
  const tiles = element('div', 'sort-row');
  const folders = element('div', 'sort-row');
  board.append(tiles, folders);
  stage.append(board);
  const dropped = new Set();
  let selected;
  let pointer;
  let ghost;
  let highlighted;

  function select(tile) {
    selected?.setAttribute('aria-pressed', 'false');
    selected = tile;
    selected.setAttribute('aria-pressed', 'true');
    feedback.textContent = `Choose a folder for ${tile.textContent}.`;
  }
  function drop(tile, folder) {
    const label = tile.dataset.label;
    if (tile.dataset.folder !== folder.dataset.folder) {
      feedback.textContent = `${label} goes in a different folder. Try another one.`;
      return;
    }
    const hadFocus = document.activeElement === tile;
    dropped.add(label);
    tile.disabled = true;
    tile.textContent = `${label} ✓`;
    tile.setAttribute('aria-pressed', 'false');
    if (selected) {
      selected.setAttribute('aria-pressed', 'false');
      selected = undefined;
    }
    if (dropped.size === pieces.length) {
      finish('You sorted every tile into its folder!');
      if (hadFocus) next.focus();
    } else {
      feedback.textContent = `${label} is in ${folder.dataset.folder}. Choose another tile.`;
      if (hadFocus) tiles.querySelector('button:not(:disabled)')?.focus();
    }
  }
  for (const piece of pieces) {
    const folder = button(`📁 ${piece.folder}`, 'folder-drop');
    folder.dataset.folder = piece.folder;
    folder.addEventListener('click', () => {
      if (selected) drop(selected, folder);
      else feedback.textContent = 'Choose a tile first, or drag one onto this folder.';
    });
    folders.append(folder);
  }
  function clearDrag() {
    pointer?.tile.classList.remove('dragging');
    highlighted?.classList.remove('hover');
    ghost?.remove();
    pointer = ghost = highlighted = undefined;
  }
  for (const piece of pieces) {
    const tile = button(piece.label, 'card');
    tile.dataset.label = piece.label;
    tile.dataset.folder = piece.folder;
    tile.setAttribute('aria-pressed', 'false');
    tile.addEventListener('click', event => {
      if (event.detail === 0) select(tile);
    });
    tile.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || pointer) return;
      pointer = { tile, id: event.pointerId, x: event.clientX, y: event.clientY };
      tile.setPointerCapture(event.pointerId);
    });
    tile.addEventListener('pointermove', event => {
      if (pointer?.id !== event.pointerId) return;
      if (!ghost && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 7) {
        ghost = element('span', 'card drag-ghost', piece.label);
        ghost.setAttribute('aria-hidden', 'true');
        document.body.append(ghost);
        tile.classList.add('dragging');
        select(tile);
      }
      if (!ghost) return;
      ghost.style.left = `${event.clientX}px`;
      ghost.style.top = `${event.clientY}px`;
      highlighted?.classList.remove('hover');
      highlighted = document.elementFromPoint(event.clientX, event.clientY)?.closest('.folder-drop');
      highlighted?.classList.add('hover');
    });
    tile.addEventListener('pointerup', event => {
      if (pointer?.id !== event.pointerId) return;
      const end = document.elementFromPoint(event.clientX, event.clientY);
      if (ghost) {
        const destination = end?.closest('.folder-drop');
        if (destination) drop(tile, destination);
        else feedback.textContent = 'Drop the tile inside a folder.';
      } else if (end === tile) {
        select(tile);
      }
      clearDrag();
    });
    tile.addEventListener('lostpointercapture', event => {
      if (pointer?.id === event.pointerId) clearDrag();
    });
    tile.addEventListener('contextmenu', event => {
      if (pointer) event.preventDefault();
    });
    tiles.append(tile);
  }
  return clearDrag;
}

const traceRoutes = {
  easy: [[30, 104], [93, 47], [151, 95], [219, 28]],
  steady: [[27, 93], [76, 49], [122, 91], [167, 45], [217, 86]],
  challenge: [[22, 112], [63, 66], [104, 104], [144, 44], [183, 88], [220, 28]]
};
const svgNS = 'http://www.w3.org/2000/svg';

function svgElement(tag, attributes) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function tracePath({ settings, finish }) {
  const points = traceRoutes[progress.difficulty];
  const svg = svgElement('svg', {
    class: 'trace-area', viewBox: '0 0 240 140', preserveAspectRatio: 'none',
    role: 'img', 'aria-label': 'A line with dots to trace from left to right'
  });
  const ink = svgElement('polyline', { class: 'trace-ink' });
  svg.append(svgElement('polyline', { class: 'trace-route', points: points.map(point => point.join(',')).join(' ') }), ink);
  const dots = points.map(([x, y], index) => svgElement('circle', {
    class: `trace-dot${index === 0 ? ' current' : ''}`, cx: x, cy: y, r: 6
  }));
  svg.append(...dots);
  const step = button('Mark next dot');
  step.classList.add('small-control');
  stage.append(svg, step);
  let index = 0;
  let pointer;
  function mark() {
    dots[index].classList.remove('current');
    dots[index].classList.add('done');
    index++;
    ink.setAttribute('points', points.slice(0, index).map(point => point.join(',')).join(' '));
    if (index === points.length) {
      const hadFocus = document.activeElement === step;
      step.disabled = true;
      finish('You followed the whole line!');
      if (hadFocus) next.focus();
    } else {
      dots[index].classList.add('current');
      feedback.textContent = `Dot ${index} of ${points.length}. Keep following the line.`;
    }
  }
  function coordinates(event) {
    const rect = svg.getBoundingClientRect();
    return [(event.clientX - rect.left) * 240 / rect.width, (event.clientY - rect.top) * 140 / rect.height];
  }
  function close(point, checkpoint) {
    return Math.hypot(point[0] - checkpoint[0], point[1] - checkpoint[1]) <= settings.traceWidth;
  }
  svg.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || step.disabled || pointer) return;
    const pos = coordinates(event);
    if (close(pos, points[index])) {
      mark();
    } else if (!index || !close(pos, points[index - 1])) {
      feedback.textContent = 'Start at the yellow dot or the last dot you reached.';
      return;
    }
    pointer = event.pointerId;
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', event => {
    if (pointer !== event.pointerId || index === points.length) return;
    const pos = coordinates(event);
    const [startX, startY] = points[index - 1];
    const [endX, endY] = points[index];
    const dx = endX - startX;
    const dy = endY - startY;
    const along = Math.max(0, Math.min(1, ((pos[0] - startX) * dx + (pos[1] - startY) * dy) / (dx * dx + dy * dy)));
    if (!close(pos, [startX + along * dx, startY + along * dy])) {
      pointer = undefined;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      feedback.textContent = 'You left the line. Start again at the last dot you reached.';
      return;
    }
    if (close(pos, points[index])) mark();
  });
  for (const type of ['pointerup', 'lostpointercapture']) {
    svg.addEventListener(type, event => {
      if (pointer === event.pointerId) pointer = undefined;
    });
  }
  svg.addEventListener('contextmenu', event => { if (pointer) event.preventDefault(); });
  step.addEventListener('click', mark);
}

function holdPad({ settings, finish }) {
  const pad = button('Hold here', 'practice-pad');
  stage.append(pad);
  let held;
  let timer;
  let finished = false;
  function begin(input) {
    if (finished || held !== undefined) return;
    held = input;
    feedback.textContent = 'Keep holding…';
    timer = setTimeout(() => {
      finished = true;
      pad.classList.add('holding');
      pad.textContent = 'You did it!';
      finish('The pad lit up. You can let go.');
    }, settings.hold);
  }
  function stop(input) {
    if (held !== input || held === undefined) return;
    held = undefined;
    clearTimeout(timer);
    if (!finished) feedback.textContent = 'Let go a little later. You can try again.';
  }
  pad.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || finished) return;
    pad.setPointerCapture(event.pointerId);
    begin(event.pointerId);
  });
  for (const type of ['pointerup', 'lostpointercapture']) {
    pad.addEventListener(type, event => stop(event.pointerId));
  }
  pad.addEventListener('pointermove', event => {
    if (held !== event.pointerId) return;
    const area = pad.getBoundingClientRect();
    if (event.clientX < area.left || event.clientX > area.right || event.clientY < area.top || event.clientY > area.bottom) {
      stop(event.pointerId);
    }
  });
  for (const type of ['keydown', 'keyup']) {
    pad.addEventListener(type, event => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (type === 'keyup') stop(event.key);
      else if (!event.repeat) begin(event.key);
    });
  }
  const loseFocus = () => stop(held);
  window.addEventListener('blur', loseFocus);
  pad.addEventListener('blur', loseFocus);
  pad.addEventListener('contextmenu', event => { if (held !== undefined) event.preventDefault(); });
  return () => {
    clearTimeout(timer);
    window.removeEventListener('blur', loseFocus);
  };
}

function doubleClick({ finish }) {
  const pad = button('Click twice here', 'practice-pad');
  stage.append(pad);
  let priorTap = -Infinity;
  let keyboardClicks = 0;
  let pointerType;
  let finished = false;
  const success = () => {
    finished = true;
    pad.textContent = 'Opened!';
    finish('You opened the box!');
  };
  pad.addEventListener('pointerdown', event => { pointerType = event.pointerType; });
  pad.addEventListener('click', event => {
    if (finished) return;
    if (pointerType === 'touch' && event.detail !== 0) {
      const now = performance.now();
      if (now - priorTap <= 700) success();
      else priorTap = now;
    } else if (event.detail === 0 && ++keyboardClicks === 2) {
      success();
    }
    if (!finished) feedback.textContent = 'Once. Click or tap again.';
  });
  pad.addEventListener('dblclick', event => {
    if (!finished && event.button === 0) success();
  });
}

function rightClick({ finish }) {
  const station = element('div', 'station');
  const card = button('Practice card', 'practice-pad');
  const alternate = button('Open card menu');
  const pin = button('Pin card');
  pin.hidden = true;
  alternate.setAttribute('aria-expanded', 'false');
  pin.id = 'pin-card';
  alternate.setAttribute('aria-controls', pin.id);
  station.append(card, alternate, pin);
  stage.append(station);
  function openMenu() {
    pin.hidden = false;
    pin.focus();
    alternate.setAttribute('aria-expanded', 'true');
    feedback.textContent = 'The card menu is open. Choose Pin card.';
  }
  card.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (!pin.disabled) openMenu();
  });
  card.addEventListener('click', () => {
    if (!pin.disabled) feedback.textContent = 'Use the right mouse button, or choose Open card menu.';
  });
  alternate.addEventListener('click', openMenu);
  pin.addEventListener('click', () => {
    card.textContent = 'Pinned ✓';
    pin.disabled = alternate.disabled = true;
    finish('The card is pinned. That is what a right-click menu can do.');
    next.focus();
  });
}

function scrollBox({ finish }) {
  const box = element('div', 'wheel-box');
  box.tabIndex = 0;
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Scroll to the garden gate');
  const places = ['Start here', 'Sunflowers', 'Tomatoes', 'Strawberries', 'Butterfly bench', 'Garden gate'];
  for (const name of places) box.append(element('p', '', name));
  const gate = button('Finish', 'finish-wheel');
  gate.addEventListener('click', () => {
    finish('You scrolled all the way to the garden gate!');
  });
  box.append(gate);
  stage.append(box);
}

function desktop({ finish }) {
  const desktopArea = element('div', 'desktop');
  stage.append(desktopArea);
  let currentFolder;
  const folders = {
    School: ['Moon', 'Spelling'],
    Stories: ['Dragon', 'Ocean']
  };
  function display(focus = false) {
    desktopArea.replaceChildren();
    const heading = element('p', '', currentFolder ? `Desktop / ${currentFolder}` : 'Desktop');
    const items = element('div', 'desktop-items');
    desktopArea.append(heading, items);
    if (currentFolder) {
      const back = button('← Desktop', 'desktop-item');
      back.addEventListener('click', () => {
        currentFolder = undefined;
        display(true);
        feedback.textContent = 'Choose the folder you need.';
      });
      items.append(back);
      for (const file of folders[currentFolder]) {
        const node = button(`▤ ${file}`, 'desktop-item');
        node.addEventListener('click', () => {
          if (file === 'Moon') finish('You found Moon in the School folder!');
          else feedback.textContent = `That is the ${file} file. Look for Moon in the School folder.`;
        });
        items.append(node);
      }
    } else {
      for (const name of Object.keys(folders)) {
        const folder = button(`📁 ${name}`, 'desktop-item');
        folder.addEventListener('click', () => {
          currentFolder = name;
          display(true);
          feedback.textContent = `Opened ${name}. Look at the files inside it.`;
        });
        items.append(folder);
      }
    }
    if (focus) items.firstElementChild?.focus();
  }
  display();
}

for (const lesson of lessons) {
  const control = button(lesson.title);
  const tick = element('span', 'lesson-done', '✓');
  tick.setAttribute('aria-hidden', 'true');
  control.append(tick);
  control.addEventListener('click', () => openLesson(lesson.id, true));
  lessonButtons.set(lesson.id, control);
  lessonMenu.append(control);
}

difficultyPicker.value = progress.difficulty;
difficultyPicker.addEventListener('change', () => {
  progress.difficulty = difficultyPicker.value;
  openLesson(progress.active);
});
repeat.addEventListener('click', () => openLesson(progress.active, true));
next.addEventListener('click', () => {
  const index = lessons.findIndex(lesson => lesson.id === progress.active);
  openLesson(lessons[(index + 1) % lessons.length].id, true);
});
document.getElementById('reset').addEventListener('click', () => {
  resetDialog.returnValue = '';
  resetDialog.showModal();
});
resetDialog.addEventListener('close', () => {
  if (resetDialog.returnValue !== 'reset') return;
  progress.completed.clear();
  openLesson(lessons[0].id, true);
});
openLesson(progress.active);
