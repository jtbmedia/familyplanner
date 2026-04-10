/**
 * Modul: Kalender (Calendar)
 * Zweck: Monats-/Wochen-/Tages-/Agenda-Ansicht mit vollem Termin-CRUD
 * Abhängigkeiten: /api.js, /router.js (window.oikos)
 */

import { api } from '/api.js';
import { renderRRuleFields, bindRRuleEvents, getRRuleValues } from '/rrule-ui.js';
import { openModal as openSharedModal, closeModal, confirmModal } from '/components/modal.js';
import { stagger } from '/utils/ux.js';
import { t, formatTime } from '/i18n.js';
import { esc } from '/utils/html.js';

// Initials helper for avatar chips
const ini = (name) => (name || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const VIEWS      = ['month', 'week', 'day', 'agenda'];
const VIEW_LABELS = () => ({
  month: t('calendar.viewMonth'),
  week:  t('calendar.viewWeek'),
  day:   t('calendar.viewDay'),
  agenda: t('calendar.viewAgenda'),
});
const DAY_NAMES_SHORT = () => [
  t('calendar.dayShortSunday'), t('calendar.dayShortMonday'), t('calendar.dayShortTuesday'),
  t('calendar.dayShortWednesday'), t('calendar.dayShortThursday'), t('calendar.dayShortFriday'),
  t('calendar.dayShortSaturday'),
];
const DAY_NAMES_LONG  = () => [
  t('calendar.dayLongSunday'), t('calendar.dayLongMonday'), t('calendar.dayLongTuesday'),
  t('calendar.dayLongWednesday'), t('calendar.dayLongThursday'), t('calendar.dayLongFriday'),
  t('calendar.dayLongSaturday'),
];
const MONTH_NAMES     = () => [
  t('calendar.monthJanuary'), t('calendar.monthFebruary'), t('calendar.monthMarch'),
  t('calendar.monthApril'), t('calendar.monthMay'), t('calendar.monthJune'),
  t('calendar.monthJuly'), t('calendar.monthAugust'), t('calendar.monthSeptember'),
  t('calendar.monthOctober'), t('calendar.monthNovember'), t('calendar.monthDecember'),
];

const EVENT_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#FF3B30',
  '#AF52DE', '#FF6B35', '#5AC8FA', '#FFCC00',
  '#8E8E93', '#30B0C7',
];

const HOUR_HEIGHT = 56; // px pro Stunde in Wochen-/Tagesansicht

// --------------------------------------------------------
// State
// --------------------------------------------------------

let state = {
  view:        'month',
  today:       '',
  cursor:      null,     // aktuell angezeigte Referenz-Datum (YYYY-MM-DD)
  events:      [],
  users:       [],
  rangeFrom:   '',
  rangeTo:     '',
};
let _container = null;

// --------------------------------------------------------
// Datumshelfer
// --------------------------------------------------------

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return isoDate(d);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function getMondayOf(dateStr) {
  const d   = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}

function formatDate(dateStr, { long = false, weekday = false } = {}) {
  const d   = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const mon = MONTH_NAMES()[d.getMonth()];
  if (weekday) {
    const wd = long ? DAY_NAMES_LONG()[d.getDay()] : DAY_NAMES_SHORT()[d.getDay()];
    return `${wd}, ${day}. ${mon}`;
  }
  return `${day}. ${mon} ${d.getFullYear()}`;
}

function formatDateTime(datetimeStr) {
  if (!datetimeStr) return '';
  const date = datetimeStr.slice(0, 10);
  const hasTime = datetimeStr.length > 10 && datetimeStr.slice(11, 16).trim() !== '';
  const time = hasTime ? formatTime(datetimeStr) : '';
  return time ? `${formatDate(date)} ${time} ${t('calendar.timeSuffix')}`.trimEnd() : formatDate(date);
}

function getMonthRange(dateStr) {
  const d     = new Date(dateStr + 'T00:00:00');
  const year  = d.getFullYear();
  const month = d.getMonth();
  const from  = `${year}-${pad(month + 1)}-01`;
  // Extra Tage für Kalenderraster (6 Wochen × 7 = 42 Tage)
  const to    = addDays(from, 41);
  return { from, to };
}

function getWeekRange(dateStr) {
  const monday = getMondayOf(dateStr);
  return { from: monday, to: addDays(monday, 6) };
}

function getAgendaRange(dateStr) {
  return { from: dateStr, to: addDays(dateStr, 30) };
}

function eventsOnDay(dateStr) {
  return state.events.filter((e) => {
    const start = e.start_datetime.slice(0, 10);
    const end   = e.end_datetime ? e.end_datetime.slice(0, 10) : start;
    return start <= dateStr && end >= dateStr;
  });
}

// --------------------------------------------------------
// API
// --------------------------------------------------------

async function loadRange(from, to) {
  try {
    const res      = await api.get(`/calendar?from=${from}&to=${to}`);
    state.events   = res.data;
  } catch (err) {
    console.error('[Calendar] loadRange Fehler:', err);
    state.events = [];
    window.oikos?.showToast(t('calendar.loadError'), 'danger');
  }
  state.rangeFrom = from;
  state.rangeTo   = to;
}

async function loadUsers() {
  try {
    const res   = await api.get('/auth/users');
    state.users = res.data;
  } catch {
    state.users = [];
  }
}

// --------------------------------------------------------
// Entry Point
// --------------------------------------------------------

export async function render(container, { user }) {
  _container = container;
  state.today  = isoDate(new Date());
  state.cursor = state.today;
  state.view   = 'month';

  container.innerHTML = `
    <div class="calendar-page" id="calendar-page">
      <div class="cal-toolbar" id="cal-toolbar"></div>
      <div id="cal-body" style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div>
      <button class="page-fab" id="fab-new-event" aria-label="${t('calendar.newEvent')}">
        <i data-lucide="plus" style="width:24px;height:24px" aria-hidden="true"></i>
      </button>
    </div>
  `;

  const { from, to } = getMonthRange(state.cursor);
  await Promise.all([loadRange(from, to), loadUsers()]);

  renderToolbar();
  renderView();

  container.querySelector('#fab-new-event')?.addEventListener('click', () => openEventModal({ mode: 'create' }));
}

// --------------------------------------------------------
// Toolbar
// --------------------------------------------------------

function renderToolbar() {
  const bar = _container.querySelector('#cal-toolbar');
  if (!bar) return;

  bar.innerHTML = `
    <h1 class="sr-only">${t('calendar.title')}</h1>
    <div class="cal-toolbar__nav">
      <button class="btn btn--icon" id="cal-prev" aria-label="${t('calendar.back')}">
        <i data-lucide="chevron-left" aria-hidden="true"></i>
      </button>
    </div>
    <button class="cal-toolbar__today" id="cal-today">${t('calendar.today')}</button>
    <span class="cal-toolbar__label" id="cal-label"></span>
    <div class="cal-toolbar__views">
      ${VIEWS.map((v) => `
        <button class="cal-toolbar__view-btn ${v === state.view ? 'cal-toolbar__view-btn--active' : ''}"
                data-view="${v}">${VIEW_LABELS()[v]}</button>
      `).join('')}
    </div>
    <button class="btn btn--primary btn--icon" id="cal-add" aria-label="${t('calendar.addEvent')}"
            style="margin-left:auto;">
      <i data-lucide="plus" aria-hidden="true"></i>
    </button>
    <div class="cal-toolbar__nav">
      <button class="btn btn--icon" id="cal-next" aria-label="${t('calendar.forward')}">
        <i data-lucide="chevron-right" aria-hidden="true"></i>
      </button>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  updateLabel();

  bar.querySelector('#cal-prev').addEventListener('click', () => navigate(-1));
  bar.querySelector('#cal-next').addEventListener('click', () => navigate(1));
  bar.querySelector('#cal-today').addEventListener('click', goToday);
  bar.querySelector('#cal-add').addEventListener('click', () => openEventModal({ mode: 'create' }));

  bar.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.view === state.view) return;
      state.view = btn.dataset.view;
      bar.querySelectorAll('[data-view]').forEach((b) =>
        b.classList.toggle('cal-toolbar__view-btn--active', b.dataset.view === state.view)
      );
      await reloadForView();
      renderView();
    });
  });
}

function updateLabel() {
  const lbl = _container.querySelector('#cal-label');
  if (!lbl) return;
  const d    = new Date(state.cursor + 'T00:00:00');
  const year = d.getFullYear();
  const mon  = MONTH_NAMES()[d.getMonth()];

  if (state.view === 'month')  lbl.textContent = `${mon} ${year}`;
  if (state.view === 'week')   lbl.textContent = t('calendar.weekNumberLabel', { week: getWeekNumber(state.cursor), month: mon, year });
  if (state.view === 'day')    lbl.textContent = formatDate(state.cursor, { weekday: true, long: true });
  if (state.view === 'agenda') lbl.textContent = t('calendar.agendaFrom', { date: formatDate(state.cursor) });
}

function getWeekNumber(dateStr) {
  const d   = new Date(dateStr + 'T00:00:00');
  const jan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - jan) / 86400000 + jan.getDay() + 1) / 7);
}

async function navigate(dir) {
  if (state.view === 'month') {
    state.cursor = addMonths(state.cursor, dir);
  } else if (state.view === 'week') {
    state.cursor = addDays(state.cursor, dir * 7);
  } else if (state.view === 'day') {
    state.cursor = addDays(state.cursor, dir);
  } else if (state.view === 'agenda') {
    state.cursor = addDays(state.cursor, dir * 30);
  }
  await reloadForView();
  updateLabel();
  renderView();
}

async function goToday() {
  state.cursor = state.today;
  await reloadForView();
  updateLabel();
  renderView();
}

async function reloadForView() {
  let from, to;
  if (state.view === 'month')  ({ from, to } = getMonthRange(state.cursor));
  if (state.view === 'week')   ({ from, to } = getWeekRange(state.cursor));
  if (state.view === 'day')    { from = state.cursor; to = state.cursor; }
  if (state.view === 'agenda') ({ from, to } = getAgendaRange(state.cursor));

  if (from !== state.rangeFrom || to !== state.rangeTo) {
    await loadRange(from, to);
  }
}

// --------------------------------------------------------
// Ansicht-Dispatcher
// --------------------------------------------------------

function renderView() {
  const body = _container.querySelector('#cal-body');
  if (!body) return;
  body.innerHTML = '';

  if (state.view === 'month')  renderMonthView(body);
  if (state.view === 'week')   renderWeekView(body);
  if (state.view === 'day')    renderDayView(body);
  if (state.view === 'agenda') renderAgendaView(body);
}

// --------------------------------------------------------
// Monatsansicht
// --------------------------------------------------------

function renderMonthView(container) {
  const d      = new Date(state.cursor + 'T00:00:00');
  const year   = d.getFullYear();
  const month  = d.getMonth();

  // Erster Tag des Monats
  const firstDay  = new Date(year, month, 1);
  // Montag-basiert: 0=Mo … 6=So
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  // 42 Tage anzeigen (6 Wochen)
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startOffset);

  const days = Array.from({ length: 42 }, (_, i) => {
    const dt = new Date(startDate);
    dt.setDate(startDate.getDate() + i);
    return { date: isoDate(dt), inMonth: dt.getMonth() === month };
  });

  container.innerHTML = `
    <div class="month-view">
      <div class="month-weekdays">
        ${[t('calendar.dayShortMonday'),t('calendar.dayShortTuesday'),t('calendar.dayShortWednesday'),t('calendar.dayShortThursday'),t('calendar.dayShortFriday'),t('calendar.dayShortSaturday'),t('calendar.dayShortSunday')].map((n) => `<div class="month-weekday">${n}</div>`).join('')}
      </div>
      <div class="month-grid" id="month-grid">
        ${days.map(({ date, inMonth }) => renderMonthDay(date, inMonth)).join('')}
      </div>
    </div>
  `;

  container.querySelector('#month-grid').addEventListener('click', (e) => {
    const evEl = e.target.closest('.month-day__event');
    if (evEl) {
      e.stopPropagation();
      const ev = state.events.find((ev) => ev.id === parseInt(evEl.dataset.id, 10));
      if (ev) showEventPopup(ev, evEl);
      return;
    }
    const dayEl = e.target.closest('.month-day');
    if (dayEl) {
      openEventModal({ mode: 'create', date: dayEl.dataset.date });
    }
  });
}

function renderMonthDay(date, inMonth) {
  const evs      = eventsOnDay(date);
  const isToday  = date === state.today;
  const classes  = [
    'month-day',
    !inMonth ? 'month-day--outside' : '',
    isToday  ? 'month-day--today' : '',
  ].filter(Boolean).join(' ');

  const MAX_SHOW = 3;
  const shown    = evs.slice(0, MAX_SHOW);
  const extra    = evs.length - MAX_SHOW;

  const evHtml = shown.map((ev) => `
    <div class="month-day__event"
         data-id="${ev.id}"
         style="background-color:${esc(ev.color)};"
         title="${esc(ev.title)}"
    >${esc(ev.title)}</div>
  `).join('');

  return `
    <div class="${classes}" data-date="${date}">
      <div class="month-day__number">${new Date(date + 'T00:00:00').getDate()}</div>
      ${evHtml}
      ${extra > 0 ? `<div class="month-day__more">${t('calendar.moreEvents', { count: extra })}</div>` : ''}
    </div>
  `;
}

// --------------------------------------------------------
// Wochenansicht
// --------------------------------------------------------

function renderWeekView(container) {
  const monday = getMondayOf(state.cursor);
  const days   = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const alldayEvs = days.map((d) =>
    eventsOnDay(d).filter((e) => e.all_day || !e.start_datetime.includes('T'))
  );
  const timedEvs = days.map((d) =>
    eventsOnDay(d).filter((e) => !e.all_day && e.start_datetime.includes('T'))
  );

  container.innerHTML = `
    <div class="week-view">
      <div class="week-view__header" id="week-header"
           style="display:grid;grid-template-columns:48px repeat(7,1fr);">
        <div class="week-view__time-gutter"></div>
        ${days.map((d) => {
          const dt = new Date(d + 'T00:00:00');
          return `<div class="week-view__day-header">
            <div class="week-view__day-name">${DAY_NAMES_SHORT()[dt.getDay()]}</div>
            <div class="week-view__day-num ${d === state.today ? 'week-view__day-num--today' : ''}">${dt.getDate()}</div>
          </div>`;
        }).join('')}
      </div>
      <!-- Ganztägige Ereignisse -->
      <div class="allday-row" style="display:grid;grid-template-columns:48px repeat(7,1fr);">
        <div style="width:48px;padding:2px;font-size:10px;color:var(--color-text-disabled);text-align:right;padding-right:4px;line-height:24px;">${t('calendar.allDayShort')}</div>
        ${days.map((d, i) => `
          <div class="allday-cell">
            ${alldayEvs[i].map((ev) => `
              <div class="allday-event" data-id="${ev.id}" style="background-color:${esc(ev.color)};"
                   title="${esc(ev.title)}">${esc(ev.title)}</div>
            `).join('')}
          </div>
        `).join('')}
      </div>
      <div class="week-view__scroll" id="week-scroll">
        <div class="week-view__body">
          <div class="week-view__times">
            ${Array.from({ length: 24 }, (_, h) => `
              <div class="week-view__time-slot" style="height:${HOUR_HEIGHT}px;">
                <span class="week-view__time-label">${h === 0 ? '' : `${pad(h)}:00`}</span>
              </div>
            `).join('')}
          </div>
          <div class="week-view__columns" id="week-cols"
               style="display:grid;grid-template-columns:repeat(7,1fr);">
            ${days.map((d, i) => `
              <div class="week-view__col" data-date="${d}">
                ${Array.from({ length: 24 }, (_, h) => `
                  <div class="week-view__hour-line" style="top:${h * HOUR_HEIGHT}px;"></div>
                `).join('')}
                ${timedEvs[i].map((ev) => renderWeekEvent(ev)).join('')}
                ${d === state.today ? `<div class="week-view__now-line" id="now-line" style="top:${nowTop()}px;"></div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  // Event-Delegation
  container.querySelector('#week-cols').addEventListener('click', (e) => {
    const evEl = e.target.closest('.week-event');
    if (evEl) {
      const ev = state.events.find((ev) => ev.id === parseInt(evEl.dataset.id, 10));
      if (ev) showEventPopup(ev, evEl);
      return;
    }
    const col = e.target.closest('[data-date]');
    if (col) openEventModal({ mode: 'create', date: col.dataset.date });
  });

  container.querySelector('.allday-row').addEventListener('click', (e) => {
    const evEl = e.target.closest('.allday-event');
    if (evEl) {
      const ev = state.events.find((ev) => ev.id === parseInt(evEl.dataset.id, 10));
      if (ev) showEventPopup(ev, evEl);
    }
  });

  // Scrollen zu aktueller Zeit
  const scroll = container.querySelector('#week-scroll');
  if (scroll) {
    const h = new Date().getHours();
    scroll.scrollTop = Math.max(0, h * HOUR_HEIGHT - 80);
  }
}

function renderWeekEvent(ev) {
  const start = timeToMinutes(ev.start_datetime.slice(11, 16));
  const end   = ev.end_datetime
    ? timeToMinutes(ev.end_datetime.slice(11, 16))
    : start + 60;
  const duration = Math.max(end - start, 30);

  const top    = (start / 60) * HOUR_HEIGHT;
  const height = (duration / 60) * HOUR_HEIGHT - 2;

  return `
    <div class="week-event" data-id="${ev.id}"
         style="top:${top}px;height:${height}px;background-color:${esc(ev.color)};">
      <div class="week-event__title">${esc(ev.title)}</div>
      <div class="week-event__time">${formatTime(ev.start_datetime)}${ev.end_datetime ? '–' + formatTime(ev.end_datetime) : ''}</div>
    </div>
  `;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function nowTop() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return (minutes / 60) * HOUR_HEIGHT;
}

// --------------------------------------------------------
// Tagesansicht
// --------------------------------------------------------

function renderDayView(container) {
  const dt      = new Date(state.cursor + 'T00:00:00');
  const dayEvs  = eventsOnDay(state.cursor);
  const allday  = dayEvs.filter((e) => e.all_day || !e.start_datetime.includes('T'));
  const timed   = dayEvs.filter((e) => !e.all_day && e.start_datetime.includes('T'));

  container.innerHTML = `
    <div class="day-view">
      <div class="day-view__header">
        <div class="day-view__date-label">${formatDate(state.cursor, { weekday: true, long: true })}</div>
      </div>
      ${allday.length ? `
      <div class="allday-row" style="display:grid;grid-template-columns:48px 1fr;">
        <div style="padding:2px 4px 2px 0;font-size:10px;color:var(--color-text-disabled);text-align:right;line-height:24px;">${t('calendar.allDayShort')}</div>
        <div class="allday-cell">
          ${allday.map((ev) => `
            <div class="allday-event" data-id="${ev.id}" style="background-color:${esc(ev.color)};">
              ${esc(ev.title)}
            </div>`).join('')}
        </div>
      </div>` : ''}
      <div class="day-view__scroll" id="day-scroll">
        <div class="day-view__body">
          <div class="day-view__times">
            ${Array.from({ length: 24 }, (_, h) => `
              <div class="week-view__time-slot" style="height:${HOUR_HEIGHT}px;">
                <span class="week-view__time-label">${h === 0 ? '' : `${pad(h)}:00`}</span>
              </div>
            `).join('')}
          </div>
          <div class="day-view__col" data-date="${state.cursor}" id="day-col">
            ${Array.from({ length: 24 }, (_, h) => `
              <div class="week-view__hour-line" style="top:${h * HOUR_HEIGHT}px;"></div>
            `).join('')}
            ${timed.map((ev) => renderWeekEvent(ev)).join('')}
            ${state.cursor === state.today ? `<div class="week-view__now-line" style="top:${nowTop()}px;"></div>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#day-col').addEventListener('click', (e) => {
    const evEl = e.target.closest('.week-event');
    if (evEl) {
      const ev = state.events.find((ev) => ev.id === parseInt(evEl.dataset.id, 10));
      if (ev) showEventPopup(ev, evEl);
      return;
    }
    openEventModal({ mode: 'create', date: state.cursor });
  });

  const scroll = container.querySelector('#day-scroll');
  if (scroll) {
    const h = new Date().getHours();
    scroll.scrollTop = Math.max(0, h * HOUR_HEIGHT - 80);
  }
}

// --------------------------------------------------------
// Agenda-Ansicht
// --------------------------------------------------------

function renderAgendaView(container) {
  const { from, to } = getAgendaRange(state.cursor);
  const days = Array.from({ length: 31 }, (_, i) => addDays(from, i));

  const groups = days
    .map((d) => ({ date: d, events: eventsOnDay(d) }))
    .filter((g) => g.events.length > 0);

  container.innerHTML = `
    <div class="agenda-view" id="agenda-view">
      ${groups.length === 0
        ? `<div class="agenda-empty">${t('calendar.noEvents')}</div>`
        : groups.map(({ date, events }) => `
          <div class="agenda-day">
            <div class="agenda-day__header ${date === state.today ? 'agenda-day__header--today' : ''}">
              <span class="agenda-day__date">${formatDate(date)}</span>
              <span class="agenda-day__weekday">${DAY_NAMES_LONG()[new Date(date + 'T00:00:00').getDay()]}</span>
            </div>
            ${events.map((ev) => renderAgendaEvent(ev)).join('')}
          </div>
        `).join('')
      }
    </div>
  `;

  stagger(container.querySelectorAll('.agenda-event'));

  container.querySelector('#agenda-view').addEventListener('click', (e) => {
    const evEl = e.target.closest('.agenda-event');
    if (evEl) {
      const ev = state.events.find((ev) => ev.id === parseInt(evEl.dataset.id, 10));
      if (ev) showEventPopup(ev, evEl);
    }
  });
}

function renderAgendaEvent(ev) {
  const timeStr = ev.all_day
    ? t('calendar.allDay')
    : formatTime(ev.start_datetime)
      + (ev.end_datetime ? ` – ${formatTime(ev.end_datetime)} ${t('calendar.timeSuffix')}`.trimEnd() : ` ${t('calendar.timeSuffix')}`.trimEnd());

  const initials = ev.assigned_name
    ? ev.assigned_name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '';

  return `
    <div class="agenda-event" data-id="${ev.id}">
      <div class="agenda-event__color" style="background-color:${esc(ev.color)};"></div>
      <div class="agenda-event__body">
        <div class="agenda-event__title">${esc(ev.title)}${(ev.recurrence_rule || ev.is_recurring_instance) ? ' <i data-lucide="repeat" style="width:12px;height:12px;display:inline;vertical-align:middle;opacity:0.5" aria-hidden="true"></i>' : ''}</div>
        <div class="agenda-event__meta">
          <span>${timeStr}</span>
          ${ev.location ? `<span>📍 ${esc(ev.location)}</span>` : ''}
          ${ev.assigned_name ? `
            <span class="agenda-event__assigned">
              <span class="agenda-event__avatar" style="background-color:${esc(ev.assigned_color || '#8E8E93')}">${initials}</span>
              ${esc(ev.assigned_name)}
            </span>` : ''}
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------
// Event-Popup (Detail-Ansicht bei Klick auf Termin)
// --------------------------------------------------------

function showEventPopup(ev, anchor) {
  document.querySelector('#event-popup')?.remove();

  const popup = document.createElement('div');
  popup.id        = 'event-popup';
  popup.className = 'event-popup';

  const timeStr = ev.all_day
    ? t('calendar.allDay')
    : formatDateTime(ev.start_datetime)
      + (ev.end_datetime ? ` – ${formatTime(ev.end_datetime)}${t('calendar.timeSuffix') ? ' ' + t('calendar.timeSuffix') : ''}`.trim() : '');

  popup.innerHTML = `
    <div class="event-popup__color-bar" style="background-color:${esc(ev.color)};"></div>
    <div class="event-popup__title">${esc(ev.title)}</div>
    <div class="event-popup__meta">
      <div>${timeStr}</div>
      ${ev.location ? `<div>📍 ${esc(ev.location)}</div>` : ''}
      ${ev.description ? `<div>${esc(ev.description)}</div>` : ''}
      ${ev.assigned_name ? `<div>👤 ${esc(ev.assigned_name)}</div>` : ''}
    </div>
    <div class="event-popup__actions">
      <button class="btn btn--secondary" style="flex:1;" id="popup-edit">${t('calendar.popupEdit')}</button>
      <button class="btn btn--danger"    id="popup-delete">
        <i data-lucide="trash-2" style="width:16px;height:16px;" aria-hidden="true"></i>
      </button>
    </div>
  `;

  document.body.appendChild(popup);
  if (window.lucide) lucide.createIcons();

  // Positionierung
  const rect = anchor.getBoundingClientRect();
  const top  = Math.min(rect.bottom + 8, window.innerHeight - 280);
  const left = Math.min(rect.left, window.innerWidth - 340);
  popup.style.top  = `${Math.max(8, top)}px`;
  popup.style.left = `${Math.max(8, left)}px`;

  popup.querySelector('#popup-edit').addEventListener('click', () => {
    popup.remove();
    openEventModal({ mode: 'edit', event: ev });
  });

  popup.querySelector('#popup-delete').addEventListener('click', async () => {
    if (!await confirmModal(t('calendar.deleteConfirm', { title: ev.title }), { danger: true, confirmLabel: t('common.delete') })) return;
    popup.remove();
    await deleteEvent(ev.id);
  });

  // Schließen bei Klick außerhalb
  setTimeout(() => {
    document.addEventListener('click', function closePopup(e) {
      if (!popup.isConnected || !popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', closePopup);
      }
    });
  }, 0);
}

// --------------------------------------------------------
// Event-Modal (Erstellen / Bearbeiten)
// --------------------------------------------------------

function openEventModal({ mode, event = null, date = null }) {
  const isEdit = mode === 'edit';
  const content = buildEventModalContent({ mode, event, date });

  openSharedModal({
    title: isEdit ? t('calendar.editEvent') : t('calendar.newEvent'),
    content,
    size: 'md',
    onSave(panel) {
      // RRULE-Events binden
      bindRRuleEvents(panel, 'event');

      const selectedColor = isEdit ? (event?.color || EVENT_COLORS[0]) : EVENT_COLORS[0];

      // Farb-Auswahl
      panel.querySelectorAll('.color-swatch').forEach((sw) => {
        sw.addEventListener('click', () => {
          panel.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('color-swatch--active'));
          sw.classList.add('color-swatch--active');
        });
      });
      panel.querySelectorAll('.color-swatch').forEach((sw) => {
        if (sw.dataset.color === selectedColor) sw.classList.add('color-swatch--active');
      });

      // Ganztägig-Toggle
      const alldayCheck = panel.querySelector('#modal-allday');
      const timeFields  = panel.querySelector('#time-fields');
      const alldayFields = panel.querySelector('#allday-fields');
      alldayCheck.addEventListener('change', () => {
        if (alldayCheck.checked) { timeFields.style.display = 'none'; alldayFields.style.display = ''; }
        else                      { timeFields.style.display = '';     alldayFields.style.display = 'none'; }
      });
      if (isEdit && event?.all_day) { timeFields.style.display = 'none'; alldayFields.style.display = ''; }

      panel.querySelector('#modal-cancel').addEventListener('click', closeModal);

      panel.querySelector('#modal-delete')?.addEventListener('click', async () => {
        if (!await confirmModal(t('calendar.deleteConfirm', { title: event.title }), { danger: true, confirmLabel: t('common.delete') })) return;
        closeModal();
        await deleteEvent(event.id);
      });

      panel.querySelector('#modal-save').addEventListener('click', () => saveEvent(panel, mode, event?.id));

      // Chip toggle (attendee picker)
      panel.querySelector('#modal-attendees')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.attendee-chip');
        if (!chip) return;
        const selected = chip.classList.toggle('attendee-chip--selected');
        chip.setAttribute('aria-pressed', String(selected));
        const avatar = chip.querySelector('.attendee-chip__avatar');
        if (selected) {
          avatar.classList.remove('attendee-chip__avatar--deselected');
          avatar.style.backgroundColor = chip.dataset.color;
        } else {
          avatar.classList.add('attendee-chip__avatar--deselected');
          avatar.style.backgroundColor = '';
        }
      });
    },
  });
}

function buildEventModalContent({ mode, event, date }) {
  const isEdit = mode === 'edit';
  const today  = date || state.today;

  const startDate = isEdit ? event.start_datetime.slice(0, 10) : today;
  const startTime = isEdit && event.start_datetime.length > 10
    ? event.start_datetime.slice(11, 16) : '09:00';
  const endDate   = isEdit && event.end_datetime ? event.end_datetime.slice(0, 10) : startDate;
  const endTime   = isEdit && event.end_datetime && event.end_datetime.length > 10
    ? event.end_datetime.slice(11, 16) : '10:00';

  const existingAttendees = isEdit && event.attendee_ids
    ? event.attendee_ids.split(',').map(Number)
    : (isEdit && event.assigned_to ? [event.assigned_to] : []);

  return `
    <div class="form-group">
      <label class="form-label" for="modal-title">${t('calendar.titleLabel')}</label>
      <input type="text" class="form-input" id="modal-title"
             placeholder="${t('calendar.titlePlaceholder')}" value="${esc(isEdit ? event.title : '')}">
    </div>

    <div class="form-group">
      <label class="toggle">
        <input type="checkbox" id="modal-allday" ${isEdit && event.all_day ? 'checked' : ''}>
        <span class="toggle__track"></span>
        <span>${t('calendar.allDayToggle')}</span>
      </label>
    </div>

    <div id="time-fields">
      <div class="modal-grid modal-grid--2">
        <div class="form-group">
          <label class="form-label" for="modal-start-date">${t('calendar.startDateLabel')}</label>
          <input type="date" class="form-input" id="modal-start-date" value="${startDate}">
        </div>
        <div class="form-group">
          <label class="form-label" for="modal-start-time">${t('calendar.startTimeLabel')}</label>
          <input type="time" class="form-input" id="modal-start-time" value="${startTime}">
        </div>
      </div>
      <div class="modal-grid modal-grid--2">
        <div class="form-group">
          <label class="form-label" for="modal-end-date">${t('calendar.endDateLabel')}</label>
          <input type="date" class="form-input" id="modal-end-date" value="${endDate}">
        </div>
        <div class="form-group">
          <label class="form-label" for="modal-end-time">${t('calendar.endTimeLabel')}</label>
          <input type="time" class="form-input" id="modal-end-time" value="${endTime}">
        </div>
      </div>
    </div>

    <div id="allday-fields" style="display:none;">
      <div class="modal-grid modal-grid--2">
        <div class="form-group">
          <label class="form-label" for="modal-allday-start">${t('calendar.fromLabel')}</label>
          <input type="date" class="form-input" id="modal-allday-start" value="${startDate}">
        </div>
        <div class="form-group">
          <label class="form-label" for="modal-allday-end">${t('calendar.toLabel')}</label>
          <input type="date" class="form-input" id="modal-allday-end" value="${endDate}">
        </div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label" for="modal-location">${t('calendar.locationLabel')}</label>
      <input type="text" class="form-input" id="modal-location"
             placeholder="${t('calendar.locationPlaceholder')}" value="${esc(isEdit && event.location ? event.location : '')}">
    </div>

    <div class="form-group">
      <label class="form-label">${t('calendar.attendeesLabel')}</label>
      <div class="attendee-chips" id="modal-attendees" role="group" aria-label="${t('calendar.attendeesLabel')}">
        ${state.users.map((u) => {
          const sel   = existingAttendees.includes(u.id);
          const color = esc(u.avatar_color || '#8E8E93');
          return `<button type="button"
            class="attendee-chip${sel ? ' attendee-chip--selected' : ''}"
            data-uid="${u.id}"
            data-color="${color}"
            aria-pressed="${sel}"
            aria-label="${esc(u.display_name)}">
            <span class="attendee-chip__avatar${sel ? '' : ' attendee-chip__avatar--deselected'}"
                  style="background-color:${sel ? color : ''}">
              ${ini(u.display_name)}
            </span>
            <span class="attendee-chip__name">${esc(u.display_name)}</span>
          </button>`;
        }).join('')}
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">${t('calendar.colorLabel')}</label>
      <div class="color-picker">
        ${EVENT_COLORS.map((c) => `
          <div class="color-swatch" data-color="${c}" style="background-color:${c};"
               role="radio" tabindex="0" aria-label="${t('calendar.colorLabel', { color: c })}"></div>
        `).join('')}
      </div>
    </div>

    <div class="form-group">
      <label class="form-label" for="modal-description">${t('calendar.descriptionLabel')}</label>
      <textarea class="form-input" id="modal-description" rows="2"
                placeholder="${t('calendar.descriptionPlaceholder')}">${esc(isEdit && event.description ? event.description : '')}</textarea>
    </div>

    ${renderRRuleFields('event', isEdit ? event.recurrence_rule : null)}

    <div class="modal-panel__footer" style="border:none;padding:0;margin-top:var(--space-4)">
      ${isEdit ? `<button class="btn btn--danger btn--icon" id="modal-delete" aria-label="${t('calendar.deleteEvent')}">
        <i data-lucide="trash-2" style="width:16px;height:16px;" aria-hidden="true"></i>
      </button>` : '<div></div>'}
      <div style="display:flex;gap:var(--space-3)">
        <button class="btn btn--secondary" id="modal-cancel">${t('common.cancel')}</button>
        <button class="btn btn--primary" id="modal-save">${isEdit ? t('common.save') : t('common.create')}</button>
      </div>
    </div>`;
}

async function saveEvent(overlay, mode, eventId) {
  const saveBtn = overlay.querySelector('#modal-save');
  const title   = overlay.querySelector('#modal-title').value.trim();

  if (!title) {
    window.oikos?.showToast(t('calendar.titleRequired'), 'error');
    return;
  }

  const allday  = overlay.querySelector('#modal-allday').checked;
  const color   = overlay.querySelector('.color-swatch--active')?.dataset.color || EVENT_COLORS[0];
  const location    = overlay.querySelector('#modal-location').value.trim() || null;
  const attendeeEls = overlay.querySelectorAll('.attendee-chip--selected');
  const attendees   = Array.from(attendeeEls).map(el => parseInt(el.dataset.uid, 10));
  const description = overlay.querySelector('#modal-description').value.trim() || null;

  let start_datetime, end_datetime;

  if (allday) {
    start_datetime = overlay.querySelector('#modal-allday-start')?.value
                   || overlay.querySelector('#modal-start-date').value;
    end_datetime   = overlay.querySelector('#modal-allday-end')?.value
                   || overlay.querySelector('#modal-end-date').value;
    end_datetime   = end_datetime || null;
  } else {
    const sd = overlay.querySelector('#modal-start-date').value;
    const st = overlay.querySelector('#modal-start-time').value;
    const ed = overlay.querySelector('#modal-end-date').value;
    const et = overlay.querySelector('#modal-end-time').value;
    start_datetime = st ? `${sd}T${st}` : sd;
    end_datetime   = et ? `${ed}T${et}` : (ed || null);
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = '…';

  try {
    const rrule = getRRuleValues(overlay, 'event');
    const body = {
      title, description, start_datetime, end_datetime,
      all_day: allday ? 1 : 0,
      location, color, attendees,
      recurrence_rule: rrule.recurrence_rule,
    };

    let res;
    if (mode === 'create') {
      res = await api.post('/calendar', body);
      state.events.push(res.data);
    } else {
      res = await api.put(`/calendar/${eventId}`, body);
      const idx = state.events.findIndex((e) => e.id === eventId);
      if (idx !== -1) state.events[idx] = res.data;
    }

    closeModal();
    renderView();
    const successMsg = mode === 'create' ? t('calendar.createdToast') : t('calendar.savedToast');
    window.oikos?.showToast(successMsg, 'success');

    // Push failure warning (shown after success toast)
    if (res.push && !res.push.ok && Array.isArray(res.push.failed) && res.push.failed.length > 0) {
      const failedNames = res.push.failed.map((f) => {
        const u = state.users.find(u => u.id === f.userId);
        return u ? u.display_name : `#${f.userId}`;
      }).join(', ');
      setTimeout(() => {
        window.oikos?.showToast(t('calendar.pushFailedToast', { names: failedNames }), 'warning');
      }, 3500);
    }
  } catch (err) {
    window.oikos?.showToast(err.data?.error ?? t('calendar.saveError'), 'error');
    saveBtn.disabled    = false;
    saveBtn.textContent = mode === 'edit' ? t('common.save') : t('common.create');
  }
}

async function deleteEvent(id) {
  try {
    await api.delete(`/calendar/${id}`);
    state.events = state.events.filter((e) => e.id !== id);
    renderView();
    window.oikos?.showToast(t('calendar.deletedToast'), 'success');
  } catch (err) {
    window.oikos?.showToast(err.data?.error ?? t('calendar.deleteError'), 'error');
  }
}

