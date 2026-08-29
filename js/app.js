(function () {
  'use strict';

  var CELL_WIDTH = 28;
  var ROW_HEIGHT = 34;
  var STORAGE_KEY = 'monthlyGanttDraft';
  var THEME_STORAGE_KEY = 'monthlyGanttTheme';
  var SCHEMA_VERSION = '2.0';
  var MAX_RANGE_DAYS = 366;

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
    modalLabel: document.getElementById('modal-label'),
    modalColor: document.getElementById('modal-color'),
    modalPalette: document.getElementById('color-palette'),
    modalOk: document.getElementById('modal-ok'),
    modalCancel: document.getElementById('modal-cancel'),
    modalDelete: document.getElementById('modal-delete'),
    toast: document.getElementById('toast'),
    themeOptions: document.querySelectorAll('.theme-option')
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
    scheduleAutosave();
  }

  function renderProjectInfo() {
    syncDateSelects('start', state.project.start_date);
    syncDateSelects('end', state.project.end_date);
    el.title.value = state.project.title;
    el.manager.value = state.project.manager;
    el.company.value = state.project.company;
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

    state.rows.forEach(function (row, index) {
      var rowEl = document.createElement('div');
      rowEl.className = 'body-row';
      rowEl.draggable = true;
      rowEl.dataset.rowId = row.id;

      // --- label cell ---
      var labelCell = document.createElement('div');
      labelCell.className = 'row-label';

      var handle = document.createElement('span');
      handle.className = 'drag-handle no-print';
      handle.textContent = '⠿';
      labelCell.appendChild(handle);

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'row-label-input';
      input.value = row.task_name;
      input.placeholder = '作業項目名';
      input.addEventListener('input', function () {
        row.task_name = input.value;
        touch();
      });
      labelCell.appendChild(input);

      var rowControls = document.createElement('span');
      rowControls.className = 'row-controls no-print';

      var upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.textContent = '↑';
      upBtn.title = '上へ移動';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', function () {
        moveRow(index, index - 1);
      });

      var downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = '↓';
      downBtn.title = '下へ移動';
      downBtn.disabled = index === state.rows.length - 1;
      downBtn.addEventListener('click', function () {
        moveRow(index, index + 1);
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.title = '行を削除';
      delBtn.addEventListener('click', function () {
        if (confirm('この作業項目を削除しますか？')) {
          state.rows.splice(index, 1);
          touch();
          render();
        }
      });

      rowControls.appendChild(upBtn);
      rowControls.appendChild(downBtn);
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
        track.appendChild(dayCell);
      });

      row.bars.forEach(function (bar) {
        track.appendChild(renderBar(row, bar));
      });

      attachTrackDragToCreate(track, row);

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

  // ---------- Row reorder (create/delete/move) ----------
  function moveRow(from, to) {
    if (to < 0 || to >= state.rows.length) return;
    var item = state.rows.splice(from, 1)[0];
    state.rows.splice(to, 0, item);
    touch();
    render();
  }

  var dragSrcIndex = null;
  function attachRowReorderDnD() {
    var rowEls = el.bodyRows.querySelectorAll('.body-row');
    rowEls.forEach(function (rowEl, idx) {
      rowEl.addEventListener('dragstart', function (evt) {
        dragSrcIndex = idx;
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
        if (dragSrcIndex === null || dragSrcIndex === idx) return;
        moveRow(dragSrcIndex, idx);
      });
    });
  }

  function addRow() {
    state.rows.push({ id: uid('row'), task_name: '', bars: [] });
    touch();
    render();
  }

  // ---------- Bar creation by drag on empty track ----------
  function attachTrackDragToCreate(track, row) {
    var creating = null;

    track.addEventListener('mousedown', function (evt) {
      if (evt.target.closest('.gantt-bar')) return;
      var cell = evt.target.closest('.day-cell');
      if (!cell) return;
      var offset = Number(cell.dataset.offset);
      creating = { startOffset: offset, endOffset: offset };
      renderGhost();
      evt.preventDefault();
    });

    function renderGhost() {
      var existing = track.querySelector('.gantt-bar-ghost');
      if (existing) existing.remove();
      if (!creating) return;
      var lo = Math.min(creating.startOffset, creating.endOffset);
      var hi = Math.max(creating.startOffset, creating.endOffset);
      var ghost = document.createElement('div');
      ghost.className = 'gantt-bar gantt-bar-ghost';
      ghost.style.left = (lo * CELL_WIDTH) + 'px';
      ghost.style.width = ((hi - lo + 1) * CELL_WIDTH - 2) + 'px';
      track.appendChild(ghost);
    }

    document.addEventListener('mousemove', function (evt) {
      if (!creating) return;
      var rect = track.getBoundingClientRect();
      var x = evt.clientX - rect.left;
      var maxOffset = getDateRangeArray(state.project.start_date, state.project.end_date).length - 1;
      var offset = clamp(Math.floor(x / CELL_WIDTH), 0, maxOffset);
      creating.endOffset = offset;
      renderGhost();
    });

    document.addEventListener('mouseup', function () {
      if (!creating) return;
      var lo = Math.min(creating.startOffset, creating.endOffset);
      var hi = Math.max(creating.startOffset, creating.endOffset);
      creating = null;
      var ghost = track.querySelector('.gantt-bar-ghost');
      if (ghost) ghost.remove();
      var rangeStart = parseISODate(state.project.start_date);
      var newBar = {
        id: uid('bar'),
        start_date: formatISODate(addDays(rangeStart, lo)),
        end_date: formatISODate(addDays(rangeStart, hi)),
        color: COLOR_PALETTE[row.bars.length % COLOR_PALETTE.length],
        label: ''
      };
      row.bars.push(newBar);
      touch();
      render();
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
    });

    document.addEventListener('mouseup', function () {
      if (!mode) return;
      mode = null;
      touch();
      scheduleAutosave();
    });
  }

  // ---------- Bar modal (label / color / delete) ----------
  var modalTarget = null; // { row, bar }

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

  function openBarModal(row, bar) {
    modalTarget = { row: row, bar: bar };
    el.modalLabel.value = bar.label || '';
    el.modalColor.value = bar.color || COLOR_PALETTE[0];
    el.modal.hidden = false;
    el.modalLabel.focus();
  }

  function closeBarModal() {
    el.modal.hidden = true;
    modalTarget = null;
  }

  el.modalOk.addEventListener('click', function () {
    if (!modalTarget) return;
    modalTarget.bar.label = el.modalLabel.value;
    modalTarget.bar.color = el.modalColor.value;
    touch();
    closeBarModal();
    render();
  });

  el.modalCancel.addEventListener('click', closeBarModal);
  el.modal.addEventListener('click', function (evt) {
    if (evt.target === el.modal) closeBarModal();
  });

  el.modalDelete.addEventListener('click', function () {
    if (!modalTarget) return;
    var idx = modalTarget.row.bars.findIndex(function (b) {
      return b.id === modalTarget.bar.id;
    });
    if (idx >= 0) modalTarget.row.bars.splice(idx, 1);
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
  });
  el.manager.addEventListener('input', function () {
    state.project.manager = el.manager.value;
    touch();
  });
  el.company.addEventListener('input', function () {
    state.project.company = el.company.value;
    touch();
  });
  el.remarks.addEventListener('input', function () {
    state.project.remarks = el.remarks.value;
    touch();
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
        remarks: data.project.remarks || ''
      },
      rows: (data.rows || []).map(function (row) {
        return {
          id: row.id || uid('row'),
          task_name: row.task_name || '',
          bars: (row.bars || []).map(function (bar) {
            return {
              id: bar.id || uid('bar'),
              start_date: bar.start_date,
              end_date: bar.end_date,
              color: bar.color || COLOR_PALETTE[0],
              label: bar.label || ''
            };
          })
        };
      })
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
      } catch (e) {
        // localStorage unavailable or quota exceeded: ignore silently
      }
    }, 500);
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
