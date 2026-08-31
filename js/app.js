(function () {
  'use strict';

  var CELL_WIDTH = 28;
  var ROW_HEIGHT = 34;
  var STORAGE_KEY = 'monthlyGanttDraft';
  var THEME_STORAGE_KEY = 'monthlyGanttTheme';
  var SCHEMA_VERSION = '2.3';
  var MAX_RANGE_DAYS = 366;
  var MAX_ROW_LEVEL = 4;
  var INDENT_WIDTH = 16;

  var COLOR_PALETTE = [
    '#4a90d9', '#e07b39', '#5cb85c', '#d9534f',
    '#9b59b6', '#f0ad4e', '#20c997', '#607d8b'
  ];

  /** @type {{meta:object, project:object, rows:Array}} */
  var state = createEmptyState();
  var uidCounter = 0;

  function uid(prefix) {
    uidCounter += 1;
    return prefix + '_' + Date.now().toString(36) + '_' + uidCounter;
  }

  // ---------- Date helpers ----------
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function parseISODate(str) {
    var p = str.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function formatISODate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function addDays(date, n) {
    var result = new Date(date);
    result.setDate(result.getDate() + n);
    return result;
  }

  function diffDays(a, b) {
    var utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((utcA - utcB) / 86400000);
  }

  function daysInMonthOf(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function pruneDependencies(rows) {
    var validIds = {};
    rows.forEach(function (row) {
      row.bars.forEach(function (bar) {
        validIds[bar.id] = true;
      });
    });
    rows.forEach(function (row) {
      row.bars.forEach(function (bar) {
        bar.depends_on = (bar.depends_on || []).filter(function (id) {
          return id !== bar.id && validIds[id];
        });
      });
    });
  }

  function normalizeRowLevels(rows) {
    rows.forEach(function (row, i) {
      var lvl = row.level || 0;
      var maxAllowed = i === 0 ? 0 : (rows[i - 1].level || 0) + 1;
      row.level = clamp(lvl, 0, Math.min(maxAllowed, MAX_ROW_LEVEL));
    });
  }

  function getDateRangeArray(startISO, endISO) {
    var start = parseISODate(startISO);
    var end = parseISODate(endISO);
    var total = Math.min(Math.max(diffDays(end, start) + 1, 1), MAX_RANGE_DAYS);
    var arr = [];
    for (var i = 0; i < total; i++) arr.push(addDays(start, i));
    return arr;
  }

  function createEmptyState() {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);
    var end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      meta: {
        version: SCHEMA_VERSION,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: ''
      },
      project: {
        start_date: formatISODate(start),
        end_date: formatISODate(end),
        title: '',
        manager: '',
        company: '',
        floor_area: '',
        floors: '',
        structure: '',
        fire_resistance: '',
        fire_use_code: '',
        remarks: ''
      },
      rows: []
    };
  }

  // ---------- DOM refs ----------
  var el = {
    startYear: document.getElementById('input-start-year'),
    startMonth: document.getElementById('input-start-month'),
    startDay: document.getElementById('input-start-day'),
    endYear: document.getElementById('input-end-year'),
    endMonth: document.getElementById('input-end-month'),
    endDay: document.getElementById('input-end-day'),
    title: document.getElementById('input-title'),
    manager: document.getElementById('input-manager'),
    company: document.getElementById('input-company'),
    floorArea: document.getElementById('input-floor-area'),
    floors: document.getElementById('input-floors'),
    structure: document.getElementById('input-structure'),
    fireResistance: document.getElementById('input-fire-resistance'),
    fireUseCode: document.getElementById('input-fire-use-code'),
    remarks: document.getElementById('input-remarks'),
    monthGroupHeader: document.getElementById('month-group-header'),
    daysHeader: document.getElementById('days-header'),
    bodyRows: document.getElementById('body-rows'),
    btnAddRow: document.getElementById('btn-add-row'),
    btnNew: document.getElementById('btn-new'),
    btnOpen: document.getElementById('btn-open'),
    fileInput: document.getElementById('file-input'),
    btnSave: document.getElementById('btn-save'),
    btnPrint: document.getElementById('btn-print'),
    btnClear: document.getElementById('btn-clear'),
    modal: document.getElementById('bar-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalLabel: document.getElementById('modal-label'),
    modalStartYear: document.getElementById('modal-start-year'),
    modalStartMonth: document.getElementById('modal-start-month'),
    modalStartDay: document.getElementById('modal-start-day'),
    modalEndYear: document.getElementById('modal-end-year'),
    modalEndMonth: document.getElementById('modal-end-month'),
    modalEndDay: document.getElementById('modal-end-day'),
    modalColor: document.getElementById('modal-color'),
    modalPalette: document.getElementById('color-palette'),
    modalDeps: document.getElementById('modal-deps'),
    modalOk: document.getElementById('modal-ok'),
    modalCancel: document.getElementById('modal-cancel'),
    modalDelete: document.getElementById('modal-delete'),
    toast: document.getElementById('toast'),
    autosaveStatus: document.getElementById('autosave-status'),
    themeOptions: document.querySelectorAll('.theme-option'),
    rowMenu: document.getElementById('row-menu'),
    rowMenuIndent: document.getElementById('row-menu-indent'),
    rowMenuOutdent: document.getElementById('row-menu-outdent'),
    rowMenuUp: document.getElementById('row-menu-up'),
    rowMenuDown: document.getElementById('row-menu-down')
  };

  // ---------- Theme (light / dark / system) ----------
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.dataset.theme = mode;
    } else {
      delete document.documentElement.dataset.theme;
    }
    el.themeOptions.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.themeValue === mode);
    });
  }

  function initTheme() {
    var stored = 'system';
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    } catch (e) {
      stored = 'system';
    }
    applyTheme(stored);

    el.themeOptions.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.dataset.themeValue;
        applyTheme(mode);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, mode);
        } catch (e) {
          // localStorage unavailable: theme choice won't persist across reloads
        }
      });
    });
  }

  // ---------- Rendering ----------
  function render() {
    renderProjectInfo();
    renderHeader();
    renderRows();
    renderDependencyArrows();
    scheduleAutosave();
  }

  function renderProjectInfo() {
    syncDateSelects('start', state.project.start_date);
    syncDateSelects('end', state.project.end_date);
    el.title.value = state.project.title;
    el.manager.value = state.project.manager;
    el.company.value = state.project.company;
    el.floorArea.value = state.project.floor_area;
    el.floors.value = state.project.floors;
    el.structure.value = state.project.structure;
    el.fireResistance.value = state.project.fire_resistance;
    el.fireUseCode.value = state.project.fire_use_code;
    el.remarks.value = state.project.remarks;
  }

  function renderHeader() {
    var dates = getDateRangeArray(state.project.start_date, state.project.end_date);
    var totalWidth = dates.length * CELL_WIDTH;

    el.daysHeader.style.width = totalWidth + 'px';
    el.monthGroupHeader.style.width = totalWidth + 'px';
    el.daysHeader.innerHTML = '';
    el.monthGroupHeader.innerHTML = '';

    var i = 0;
    while (i < dates.length) {
      var y = dates[i].getFullYear();
      var m = dates[i].getMonth();
      var j = i;
      while (j < dates.length && dates[j].getFullYear() === y && dates[j].getMonth() === m) j++;
      var groupCell = document.createElement('div');
      groupCell.className = 'month-group-cell';
      groupCell.style.width = ((j - i) * CELL_WIDTH) + 'px';
      groupCell.textContent = y + '年' + (m + 1) + '月';
      el.monthGroupHeader.appendChild(groupCell);
      i = j;
    }

    dates.forEach(function (date) {
      var dow = date.getDay();
      var holidayName = window.JPHolidays.getHolidayName(date);
      var cell = document.createElement('div');
      cell.className = 'day-header-cell';
      if (dow === 0 || holidayName) cell.classList.add('sunday');
      else if (dow === 6) cell.classList.add('saturday');
      if (holidayName) cell.title = holidayName;
      cell.style.width = CELL_WIDTH + 'px';

      var num = document.createElement('div');
      num.className = 'day-num';
      num.textContent = String(date.getDate());
      var wk = document.createElement('div');
      wk.className = 'day-wk';
      wk.textContent = ['日', '月', '火', '水', '木', '金', '土'][dow];

      cell.appendChild(num);
      cell.appendChild(wk);
      el.daysHeader.appendChild(cell);
    });
  }

  function renderRows() {
    var dates = getDateRangeArray(state.project.start_date, state.project.end_date);
    var totalWidth = dates.length * CELL_WIDTH;
    el.bodyRows.innerHTML = '';

    var ancestorStack = []; // { level, blocksChildren }

    state.rows.forEach(function (row, index) {
      var level = row.level || 0;
      while (ancestorStack.length && ancestorStack[ancestorStack.length - 1].level >= level) {
        ancestorStack.pop();
      }
      var hiddenByAncestor = ancestorStack.some(function (a) {
        return a.blocksChildren;
      });
      var hasChildren = index + 1 < state.rows.length && (state.rows[index + 1].level || 0) > level;
      ancestorStack.push({ level: level, blocksChildren: hiddenByAncestor || !!row.collapsed });

      if (hiddenByAncestor) return;

      var rowEl = document.createElement('div');
      rowEl.className = 'body-row';
      rowEl.draggable = true;
      rowEl.dataset.rowId = row.id;
      rowEl.dataset.rowIndex = String(index);

      // --- label cell ---
      var labelCell = document.createElement('div');
      labelCell.className = 'row-label';

      var mainGroup = document.createElement('span');
      mainGroup.className = 'row-label-main';
      mainGroup.style.marginLeft = (level * INDENT_WIDTH) + 'px';

      if (hasChildren) {
        var toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'row-toggle no-print';
        toggleBtn.textContent = row.collapsed ? '▸' : '▾';
        toggleBtn.title = row.collapsed ? '展開' : '折りたたむ';
        toggleBtn.addEventListener('click', function () {
          row.collapsed = !row.collapsed;
          render();
        });
        mainGroup.appendChild(toggleBtn);
      } else {
        var spacer = document.createElement('span');
        spacer.className = 'row-toggle-spacer';
        mainGroup.appendChild(spacer);
      }

      var handle = document.createElement('span');
      handle.className = 'drag-handle no-print';
      handle.textContent = '⠿';
      mainGroup.appendChild(handle);

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'row-label-input';
      input.value = row.task_name;
      input.placeholder = '(例)基本計画';
      input.addEventListener('input', function () {
        row.task_name = input.value;
        touch();
      });
      mainGroup.appendChild(input);

      labelCell.appendChild(mainGroup);

      var rowControls = document.createElement('span');
      rowControls.className = 'row-controls no-print';

      var menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.textContent = '▼';
      menuBtn.title = '操作メニュー（インデント・移動）';
      menuBtn.addEventListener('click', function (evt) {
        evt.stopPropagation();
        openRowMenu(menuBtn, index, level);
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.title = '行を削除';
      delBtn.addEventListener('click', function () {
        if (confirm('この作業項目を削除しますか？（子項目がある場合は子項目も削除されます）')) {
          var removeCount = 1;
          while (index + removeCount < state.rows.length &&
            (state.rows[index + removeCount].level || 0) > level) {
            removeCount++;
          }
          state.rows.splice(index, removeCount);
          pruneDependencies(state.rows);
          touch();
          render();
        }
      });

      rowControls.appendChild(menuBtn);
      rowControls.appendChild(delBtn);
      labelCell.appendChild(rowControls);

      // --- track cell ---
      var track = document.createElement('div');
      track.className = 'row-track';
      track.style.width = totalWidth + 'px';
      track.dataset.rowId = row.id;

      dates.forEach(function (date, offset) {
        var dow = date.getDay();
        var isHoliday = dow === 0 || dow === 6 || !!window.JPHolidays.getHolidayName(date);
        var dayCell = document.createElement('div');
        dayCell.className = 'day-cell' + (isHoliday ? ' weekend' : '');
        dayCell.style.width = CELL_WIDTH + 'px';
        dayCell.dataset.offset = String(offset);
        dayCell.title = '右クリックで工程を追加';
        track.appendChild(dayCell);
      });

      row.bars.forEach(function (bar) {
        track.appendChild(renderBar(row, bar));
      });

      attachTrackContextMenu(track, row);

      rowEl.appendChild(labelCell);
      rowEl.appendChild(track);
      el.bodyRows.appendChild(rowEl);
    });

    attachRowReorderDnD();
  }

  function renderBar(row, bar) {
    var rangeStart = parseISODate(state.project.start_date);
    var startOffset = diffDays(parseISODate(bar.start_date), rangeStart);
    var endOffset = diffDays(parseISODate(bar.end_date), rangeStart);

    var barEl = document.createElement('div');
    barEl.className = 'gantt-bar';
    barEl.style.left = (startOffset * CELL_WIDTH) + 'px';
    barEl.style.width = ((endOffset - startOffset + 1) * CELL_WIDTH - 2) + 'px';
    barEl.style.backgroundColor = bar.color;
    barEl.dataset.barId = bar.id;
    barEl.title = bar.label || '';

    var labelSpan = document.createElement('span');
    labelSpan.className = 'gantt-bar-label';
    labelSpan.textContent = bar.label || '';
    barEl.appendChild(labelSpan);

    var leftHandle = document.createElement('span');
    leftHandle.className = 'bar-handle bar-handle-left no-print';
    var rightHandle = document.createElement('span');
    rightHandle.className = 'bar-handle bar-handle-right no-print';
    barEl.appendChild(leftHandle);
    barEl.appendChild(rightHandle);

    attachBarDrag(barEl, row, bar, leftHandle, rightHandle);

    barEl.addEventListener('dblclick', function (evt) {
      evt.stopPropagation();
      openBarModal(row, bar);
    });

    return barEl;
  }

  // ---------- Dependency arrows (先行工程の連結線) ----------
  function renderDependencyArrows() {
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'dependency-svg');

    var defs = document.createElementNS(svgNS, 'defs');
    var marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', 'dep-arrowhead');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    var arrowPath = document.createElementNS(svgNS, 'path');
    arrowPath.setAttribute('d', 'M0,0 L6,3 L0,6 Z');
    arrowPath.setAttribute('class', 'dependency-arrowhead');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    var bodyRect = el.bodyRows.getBoundingClientRect();

    state.rows.forEach(function (row) {
      row.bars.forEach(function (bar) {
        if (!bar.depends_on || !bar.depends_on.length) return;
        var toEl = el.bodyRows.querySelector('.gantt-bar[data-bar-id="' + bar.id + '"]');
        if (!toEl) return;

        bar.depends_on.forEach(function (depId) {
          var fromEl = el.bodyRows.querySelector('.gantt-bar[data-bar-id="' + depId + '"]');
          if (!fromEl) return;

          var fromRect = fromEl.getBoundingClientRect();
          var toRect = toEl.getBoundingClientRect();
          var fromX = fromRect.right - bodyRect.left;
          var fromY = fromRect.top + fromRect.height / 2 - bodyRect.top;
          var toX = toRect.left - bodyRect.left;
          var toY = toRect.top + toRect.height / 2 - bodyRect.top;

          var d;
          if (Math.abs(fromY - toY) < 1) {
            d = 'M' + fromX + ' ' + fromY + ' L' + toX + ' ' + toY;
          } else {
            var kick = Math.min(14, Math.max(6, (toX - fromX) / 2));
            var midX = fromX + kick;
            d = 'M' + fromX + ' ' + fromY + ' L' + midX + ' ' + fromY +
              ' L' + midX + ' ' + toY + ' L' + toX + ' ' + toY;
          }

          var path = document.createElementNS(svgNS, 'path');
          path.setAttribute('d', d);
          path.setAttribute('class', 'dependency-line');
          path.setAttribute('marker-end', 'url(#dep-arrowhead)');
          svg.appendChild(path);
        });
      });
    });

    var existing = el.bodyRows.querySelector('.dependency-svg');
    if (existing) existing.remove();
    el.bodyRows.appendChild(svg);
  }

  // ---------- Row action menu (indent / outdent / move) ----------
  var rowMenuTarget = null; // { index, level }

  function openRowMenu(anchorEl, index, level) {
    rowMenuTarget = { index: index, level: level };

    el.rowMenuIndent.disabled = index === 0 ||
      level >= (state.rows[index - 1].level || 0) + 1 ||
      level >= MAX_ROW_LEVEL;
    el.rowMenuOutdent.disabled = level === 0;
    el.rowMenuUp.disabled = index === 0;
    el.rowMenuDown.disabled = index === state.rows.length - 1;

    var rect = anchorEl.getBoundingClientRect();
    el.rowMenu.style.left = rect.left + 'px';
    el.rowMenu.style.top = rect.bottom + 4 + 'px';
    el.rowMenu.hidden = false;
  }

  function closeRowMenu() {
    el.rowMenu.hidden = true;
    rowMenuTarget = null;
  }

  el.rowMenuIndent.addEventListener('click', function () {
    if (!rowMenuTarget) return;
    var row = state.rows[rowMenuTarget.index];
    row.level = Math.min(rowMenuTarget.level + 1, MAX_ROW_LEVEL);
    normalizeRowLevels(state.rows);
    touch();
    closeRowMenu();
    render();
  });

  el.rowMenuOutdent.addEventListener('click', function () {
    if (!rowMenuTarget) return;
    var row = state.rows[rowMenuTarget.index];
    row.level = Math.max(rowMenuTarget.level - 1, 0);
    normalizeRowLevels(state.rows);
    touch();
    closeRowMenu();
    render();
  });

  el.rowMenuUp.addEventListener('click', function () {
    if (!rowMenuTarget) return;
    var index = rowMenuTarget.index;
    closeRowMenu();
    moveRow(index, index - 1);
  });

  el.rowMenuDown.addEventListener('click', function () {
    if (!rowMenuTarget) return;
    var index = rowMenuTarget.index;
    closeRowMenu();
    moveRow(index, index + 1);
  });

  document.addEventListener('click', function (evt) {
    if (!el.rowMenu.hidden && !el.rowMenu.contains(evt.target)) closeRowMenu();
  });

  // ---------- Row reorder (create/delete/move) ----------
  function moveRow(from, to) {
    if (to < 0 || to >= state.rows.length || from === to) return;
    var item = state.rows.splice(from, 1)[0];
    state.rows.splice(to, 0, item);
    normalizeRowLevels(state.rows);
    touch();
    render();
  }

  var dragSrcIndex = null;
  function attachRowReorderDnD() {
    var rowEls = el.bodyRows.querySelectorAll('.body-row');
    rowEls.forEach(function (rowEl) {
      rowEl.addEventListener('dragstart', function (evt) {
        dragSrcIndex = Number(rowEl.dataset.rowIndex);
        evt.dataTransfer.effectAllowed = 'move';
        rowEl.classList.add('dragging');
      });
      rowEl.addEventListener('dragend', function () {
        rowEl.classList.remove('dragging');
        dragSrcIndex = null;
      });
      rowEl.addEventListener('dragover', function (evt) {
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'move';
      });
      rowEl.addEventListener('drop', function (evt) {
        evt.preventDefault();
        var targetIndex = Number(rowEl.dataset.rowIndex);
        if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
        moveRow(dragSrcIndex, targetIndex);
      });
    });
  }

  function addRow() {
    state.rows.push({ id: uid('row'), task_name: '', bars: [], level: 0, collapsed: false });
    touch();
    render();
  }

  // ---------- Bar creation via right-click ----------
  function attachTrackContextMenu(track, row) {
    track.addEventListener('contextmenu', function (evt) {
      evt.preventDefault();

      var barTarget = evt.target.closest('.gantt-bar');
      if (barTarget) {
        var bar = row.bars.find(function (b) {
          return b.id === barTarget.dataset.barId;
        });
        if (bar) openBarModal(row, bar);
        return;
      }

      var cell = evt.target.closest('.day-cell');
      if (!cell) return;
      var offset = Number(cell.dataset.offset);
      var rangeStart = parseISODate(state.project.start_date);
      var iso = formatISODate(addDays(rangeStart, offset));
      openNewBarModal(row, iso);
    });
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // ---------- Bar move / resize ----------
  function attachBarDrag(barEl, row, bar, leftHandle, rightHandle) {
    var mode = null; // 'move' | 'resize-left' | 'resize-right'
    var startX = 0;
    var origStartOffset = 0;
    var origEndOffset = 0;

    function begin(evt, m) {
      mode = m;
      startX = evt.clientX;
      var rangeStart = parseISODate(state.project.start_date);
      origStartOffset = diffDays(parseISODate(bar.start_date), rangeStart);
      origEndOffset = diffDays(parseISODate(bar.end_date), rangeStart);
      evt.preventDefault();
      evt.stopPropagation();
    }

    barEl.addEventListener('mousedown', function (evt) {
      if (evt.target === leftHandle || evt.target === rightHandle) return;
      begin(evt, 'move');
    });
    leftHandle.addEventListener('mousedown', function (evt) {
      begin(evt, 'resize-left');
    });
    rightHandle.addEventListener('mousedown', function (evt) {
      begin(evt, 'resize-right');
    });

    document.addEventListener('mousemove', function (evt) {
      if (!mode) return;
      var rangeStart = parseISODate(state.project.start_date);
      var maxOffset = getDateRangeArray(state.project.start_date, state.project.end_date).length - 1;
      var deltaDays = Math.round((evt.clientX - startX) / CELL_WIDTH);
      var newStartOffset, newEndOffset;

      if (mode === 'move') {
        var span = origEndOffset - origStartOffset;
        newStartOffset = clamp(origStartOffset + deltaDays, 0, maxOffset - span);
        newEndOffset = newStartOffset + span;
      } else if (mode === 'resize-left') {
        newStartOffset = clamp(origStartOffset + deltaDays, 0, origEndOffset);
        newEndOffset = origEndOffset;
      } else if (mode === 'resize-right') {
        newStartOffset = origStartOffset;
        newEndOffset = clamp(origEndOffset + deltaDays, origStartOffset, maxOffset);
      }

      bar.start_date = formatISODate(addDays(rangeStart, newStartOffset));
      bar.end_date = formatISODate(addDays(rangeStart, newEndOffset));
      barEl.style.left = (newStartOffset * CELL_WIDTH) + 'px';
      barEl.style.width = ((newEndOffset - newStartOffset + 1) * CELL_WIDTH - 2) + 'px';
      renderDependencyArrows();
    });

    document.addEventListener('mouseup', function () {
      if (!mode) return;
      mode = null;
      touch();
      renderDependencyArrows();
      scheduleAutosave();
    });
  }

  // ---------- Bar modal (create / edit: label, period, color, delete) ----------
  var modalTarget = null; // { row, bar, isNew }

  function buildColorPalette() {
    el.modalPalette.innerHTML = '';
    COLOR_PALETTE.forEach(function (color) {
      var swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color;
      swatch.addEventListener('click', function () {
        el.modalColor.value = color;
      });
      el.modalPalette.appendChild(swatch);
    });
  }

  function buildDependencyChecklist(excludeBarId, selectedIds) {
    el.modalDeps.innerHTML = '';
    var any = false;
    state.rows.forEach(function (row) {
      row.bars.forEach(function (bar) {
        if (bar.id === excludeBarId) return;
        any = true;
        var label = document.createElement('label');
        label.className = 'dep-item';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = bar.id;
        cb.checked = selectedIds.indexOf(bar.id) !== -1;
        var span = document.createElement('span');
        span.textContent = row.task_name + '：' + (bar.label || '(無題)') +
          '（' + bar.start_date + '〜' + bar.end_date + '）';
        label.appendChild(cb);
        label.appendChild(span);
        el.modalDeps.appendChild(label);
      });
    });
    if (!any) {
      var empty = document.createElement('div');
      empty.className = 'dep-empty';
      empty.textContent = '先行工程に指定できる工程がありません';
      el.modalDeps.appendChild(empty);
    }
  }

  function getSelectedDependencies() {
    return Array.prototype.filter.call(
      el.modalDeps.querySelectorAll('input[type="checkbox"]'),
      function (cb) { return cb.checked; }
    ).map(function (cb) { return cb.value; });
  }

  function openBarModal(row, bar) {
    modalTarget = { row: row, bar: bar, isNew: false };
    el.modalTitle.textContent = '工程の編集';
    el.modalLabel.value = bar.label || '';
    el.modalColor.value = bar.color || COLOR_PALETTE[0];
    syncDateSelects('modalStart', bar.start_date);
    syncDateSelects('modalEnd', bar.end_date);
    buildDependencyChecklist(bar.id, bar.depends_on || []);
    el.modalDelete.hidden = false;
    el.modal.hidden = false;
    el.modalLabel.focus();
  }

  function openNewBarModal(row, defaultIso) {
    modalTarget = { row: row, bar: null, isNew: true };
    el.modalTitle.textContent = '工程の追加';
    el.modalLabel.value = '';
    el.modalColor.value = COLOR_PALETTE[row.bars.length % COLOR_PALETTE.length];
    syncDateSelects('modalStart', defaultIso);
    syncDateSelects('modalEnd', defaultIso);
    buildDependencyChecklist(null, []);
    el.modalDelete.hidden = true;
    el.modal.hidden = false;
    el.modalLabel.focus();
  }

  function closeBarModal() {
    el.modal.hidden = true;
    modalTarget = null;
  }

  ['modalStart', 'modalEnd'].forEach(function (prefix) {
    ['Year', 'Month'].forEach(function (part) {
      el[prefix + part].addEventListener('change', function () {
        buildDayOptions(el[prefix + 'Day'], Number(el[prefix + 'Year'].value), Number(el[prefix + 'Month'].value));
      });
    });
  });

  el.modalOk.addEventListener('click', function () {
    if (!modalTarget) return;

    var startIso = getDateFromSelects('modalStart');
    var endIso = getDateFromSelects('modalEnd');
    if (endIso < startIso) {
      var tmp = startIso;
      startIso = endIso;
      endIso = tmp;
    }
    if (startIso < state.project.start_date) startIso = state.project.start_date;
    if (endIso > state.project.end_date) endIso = state.project.end_date;
    if (endIso < startIso) endIso = startIso;

    var depIds = getSelectedDependencies();

    if (modalTarget.isNew) {
      modalTarget.row.bars.push({
        id: uid('bar'),
        start_date: startIso,
        end_date: endIso,
        color: el.modalColor.value,
        label: el.modalLabel.value,
        depends_on: depIds
      });
    } else {
      modalTarget.bar.label = el.modalLabel.value;
      modalTarget.bar.color = el.modalColor.value;
      modalTarget.bar.start_date = startIso;
      modalTarget.bar.end_date = endIso;
      modalTarget.bar.depends_on = depIds;
    }
    pruneDependencies(state.rows);
    touch();
    closeBarModal();
    render();
  });

  el.modalCancel.addEventListener('click', closeBarModal);
  el.modal.addEventListener('click', function (evt) {
    if (evt.target === el.modal) closeBarModal();
  });

  el.modalDelete.addEventListener('click', function () {
    if (!modalTarget || modalTarget.isNew) return;
    var idx = modalTarget.row.bars.findIndex(function (b) {
      return b.id === modalTarget.bar.id;
    });
    if (idx >= 0) modalTarget.row.bars.splice(idx, 1);
    pruneDependencies(state.rows);
    touch();
    closeBarModal();
    render();
  });

  // ---------- Project info bindings (date-range picker) ----------
  function buildYearOptions(selectEl) {
    var currentYear = new Date().getFullYear();
    selectEl.innerHTML = '';
    for (var y = currentYear - 5; y <= currentYear + 10; y++) {
      var opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = y + '年';
      selectEl.appendChild(opt);
    }
  }

  function buildMonthOptions(selectEl) {
    selectEl.innerHTML = '';
    for (var m = 1; m <= 12; m++) {
      var opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = m + '月';
      selectEl.appendChild(opt);
    }
  }

  function buildDayOptions(selectEl, year, month, keepDay) {
    var dim = daysInMonthOf(year, month);
    var prevValue = keepDay !== undefined ? keepDay : (Number(selectEl.value) || 1);
    selectEl.innerHTML = '';
    for (var d = 1; d <= dim; d++) {
      var opt = document.createElement('option');
      opt.value = String(d);
      opt.textContent = d + '日';
      selectEl.appendChild(opt);
    }
    selectEl.value = String(clamp(prevValue, 1, dim));
  }

  function ensureYearOption(selectEl, year) {
    var exists = Array.prototype.some.call(selectEl.options, function (opt) {
      return opt.value === year;
    });
    if (exists) return;
    var opt = document.createElement('option');
    opt.value = year;
    opt.textContent = year + '年';
    selectEl.appendChild(opt);
    var sorted = Array.prototype.slice.call(selectEl.options).sort(function (a, b) {
      return Number(a.value) - Number(b.value);
    });
    sorted.forEach(function (o) {
      selectEl.appendChild(o);
    });
  }

  function buildDateRangeSelects() {
    buildYearOptions(el.startYear);
    buildMonthOptions(el.startMonth);
    buildYearOptions(el.endYear);
    buildMonthOptions(el.endMonth);
    buildYearOptions(el.modalStartYear);
    buildMonthOptions(el.modalStartMonth);
    buildYearOptions(el.modalEndYear);
    buildMonthOptions(el.modalEndMonth);
  }

  function syncDateSelects(prefix, iso) {
    var parts = iso.split('-');
    var year = parts[0];
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    var yearSel = el[prefix + 'Year'];
    var monthSel = el[prefix + 'Month'];
    var daySel = el[prefix + 'Day'];
    ensureYearOption(yearSel, year);
    yearSel.value = year;
    monthSel.value = String(month);
    buildDayOptions(daySel, Number(year), month, day);
  }

  function getDateFromSelects(prefix) {
    var y = el[prefix + 'Year'].value;
    var m = pad2(Number(el[prefix + 'Month'].value));
    var d = pad2(Number(el[prefix + 'Day'].value));
    return y + '-' + m + '-' + d;
  }

  function onDateSelectChange(prefix) {
    var yearSel = el[prefix + 'Year'];
    var monthSel = el[prefix + 'Month'];
    var daySel = el[prefix + 'Day'];
    buildDayOptions(daySel, Number(yearSel.value), Number(monthSel.value));

    var iso = getDateFromSelects(prefix);
    if (prefix === 'start') {
      state.project.start_date = iso;
      if (state.project.start_date > state.project.end_date) {
        state.project.end_date = state.project.start_date;
      }
    } else {
      state.project.end_date = iso;
      if (state.project.end_date < state.project.start_date) {
        state.project.start_date = state.project.end_date;
      }
    }

    var rangeStart = parseISODate(state.project.start_date);
    var rangeEnd = parseISODate(state.project.end_date);
    if (diffDays(rangeEnd, rangeStart) + 1 > MAX_RANGE_DAYS) {
      if (prefix === 'start') {
        state.project.end_date = formatISODate(addDays(rangeStart, MAX_RANGE_DAYS - 1));
      } else {
        state.project.start_date = formatISODate(addDays(rangeEnd, -(MAX_RANGE_DAYS - 1)));
      }
      showToast('対象期間は最大' + MAX_RANGE_DAYS + '日までです');
    }

    touch();
    render();
  }

  ['start', 'end'].forEach(function (prefix) {
    ['Year', 'Month', 'Day'].forEach(function (part) {
      el[prefix + part].addEventListener('change', function () {
        onDateSelectChange(prefix);
      });
    });
  });

  el.title.addEventListener('input', function () {
    state.project.title = el.title.value;
    touch();
    scheduleAutosave();
  });
  el.manager.addEventListener('input', function () {
    state.project.manager = el.manager.value;
    touch();
    scheduleAutosave();
  });
  el.company.addEventListener('input', function () {
    state.project.company = el.company.value;
    touch();
    scheduleAutosave();
  });
  el.floorArea.addEventListener('input', function () {
    state.project.floor_area = el.floorArea.value;
    touch();
    scheduleAutosave();
  });
  el.floors.addEventListener('input', function () {
    state.project.floors = el.floors.value;
    touch();
    scheduleAutosave();
  });
  el.structure.addEventListener('input', function () {
    state.project.structure = el.structure.value;
    touch();
    scheduleAutosave();
  });
  el.fireResistance.addEventListener('change', function () {
    state.project.fire_resistance = el.fireResistance.value;
    touch();
    scheduleAutosave();
  });
  el.fireUseCode.addEventListener('input', function () {
    state.project.fire_use_code = el.fireUseCode.value;
    touch();
    scheduleAutosave();
  });
  el.remarks.addEventListener('input', function () {
    state.project.remarks = el.remarks.value;
    touch();
    scheduleAutosave();
  });

  el.btnAddRow.addEventListener('click', addRow);

  // ---------- Toolbar actions ----------
  el.btnNew.addEventListener('click', function () {
    if (confirm('現在の内容を破棄して新規作成しますか？')) {
      state = createEmptyState();
      localStorage.removeItem(STORAGE_KEY);
      render();
      showToast('新規作成しました');
    }
  });

  el.btnClear.addEventListener('click', function () {
    if (confirm('作業項目と工程バーをすべてクリアしますか？（工事情報は保持されます）')) {
      state.rows = [];
      state.project.remarks = '';
      touch();
      render();
      showToast('クリアしました');
    }
  });

  el.btnSave.addEventListener('click', function () {
    state.meta.updated_at = new Date().toISOString();
    var dataStr = JSON.stringify(state, null, 2);
    var blob = new Blob([dataStr], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var fileName = '工程表_' + state.project.start_date + '_' + state.project.end_date + '.json';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('JSONを保存しました');
  });

  el.btnOpen.addEventListener('click', function () {
    el.fileInput.value = '';
    el.fileInput.click();
  });

  el.fileInput.addEventListener('change', function () {
    var file = el.fileInput.files && el.fileInput.files[0];
    if (file) loadFile(file);
  });

  el.btnPrint.addEventListener('click', function () {
    window.print();
  });

  document.addEventListener('dragover', function (evt) {
    evt.preventDefault();
  });
  document.addEventListener('drop', function (evt) {
    var file = evt.dataTransfer && evt.dataTransfer.files && evt.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.json')) {
      evt.preventDefault();
      loadFile(file);
    }
  });

  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        if (!validateData(data)) {
          alert('JSONの形式が不正です。工程表データとして読み込めませんでした。');
          return;
        }
        state = normalizeState(data);
        render();
        showToast('JSONを読み込みました');
      } catch (e) {
        alert('JSONの解析に失敗しました: ' + e.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function validateData(data) {
    return !!(data && data.meta && data.project && Array.isArray(data.rows) &&
      ISO_DATE_RE.test(data.project.start_date) &&
      ISO_DATE_RE.test(data.project.end_date));
  }

  function normalizeLoadedRows(rawRows) {
    var rows = rawRows.map(function (row) {
      return {
        id: row.id || uid('row'),
        task_name: row.task_name || '',
        level: Number(row.level) || 0,
        collapsed: !!row.collapsed,
        bars: (row.bars || []).map(function (bar) {
          return {
            id: bar.id || uid('bar'),
            start_date: bar.start_date,
            end_date: bar.end_date,
            color: bar.color || COLOR_PALETTE[0],
            label: bar.label || '',
            depends_on: Array.isArray(bar.depends_on) ? bar.depends_on.slice() : []
          };
        })
      };
    });
    normalizeRowLevels(rows);
    pruneDependencies(rows);
    return rows;
  }

  function normalizeState(data) {
    var startDate = data.project.start_date;
    var endDate = data.project.end_date;
    if (endDate < startDate) endDate = startDate;

    return {
      meta: {
        version: data.meta.version || SCHEMA_VERSION,
        created_at: data.meta.created_at || new Date().toISOString(),
        updated_at: data.meta.updated_at || new Date().toISOString(),
        updated_by: data.meta.updated_by || ''
      },
      project: {
        start_date: startDate,
        end_date: endDate,
        title: data.project.title || '',
        manager: data.project.manager || '',
        company: data.project.company || '',
        floor_area: data.project.floor_area || '',
        floors: data.project.floors || '',
        structure: data.project.structure || '',
        fire_resistance: data.project.fire_resistance || '',
        fire_use_code: data.project.fire_use_code || '',
        remarks: data.project.remarks || ''
      },
      rows: normalizeLoadedRows(data.rows || [])
    };
  }

  // ---------- Autosave (LocalStorage) ----------
  function touch() {
    state.meta.updated_at = new Date().toISOString();
  }

  var autosaveTimer = null;
  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        showAutosaveStatus();
      } catch (e) {
        // localStorage unavailable or quota exceeded: ignore silently
      }
    }, 500);
  }

  function showAutosaveStatus() {
    if (!el.autosaveStatus) return;
    var now = new Date();
    el.autosaveStatus.textContent = '自動保存済み ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
    el.autosaveStatus.hidden = false;
  }

  function restoreDraft() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw) return false;
    try {
      var data = JSON.parse(raw);
      if (validateData(data)) {
        state = normalizeState(data);
        return true;
      }
    } catch (e) {
      // ignore corrupt draft
    }
    return false;
  }

  // ---------- Toast ----------
  var toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.hidden = true;
    }, 2000);
  }

  // ---------- Init ----------
  function init() {
    initTheme();
    buildDateRangeSelects();
    buildColorPalette();
    var restored = restoreDraft();
    render();
    if (restored) showToast('前回の編集内容を復元しました');
  }

  init();
})();
