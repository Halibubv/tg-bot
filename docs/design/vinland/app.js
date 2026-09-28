(() => {
  'use strict';

  const STORAGE_KEY = 'vinland-miniapp-prototype-v1';
  const app = document.getElementById('app');
  const toolStatus = document.getElementById('prototype-tool-status');
  const validStatuses = new Set(['unplanned', 'planned', 'completed', 'rest']);
  const dayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const suggestedZones = [
    ['Europe/Moscow', 'Москва'], ['Europe/Kaliningrad', 'Калининград'],
    ['Europe/Samara', 'Самара'], ['Asia/Yekaterinburg', 'Екатеринбург'],
    ['Asia/Novosibirsk', 'Новосибирск'], ['Asia/Vladivostok', 'Владивосток'],
    ['Etc/UTC', 'UTC']
  ];

  function validZone(zone) {
    try { new Intl.DateTimeFormat('ru-RU', { timeZone: zone }); return true; }
    catch { return false; }
  }

  function detectedZone() {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return validZone(zone) ? zone : 'Etc/UTC';
  }

  function defaultModel() {
    return {
      onboarded: false,
      days: {},
      settings: { timeZone: detectedZone(), remindersEnabled: false, firstReminderLocal: '09:00' }
    };
  }

  function normalizeModel(raw) {
    const safe = defaultModel();
    if (!raw || typeof raw !== 'object') return safe;
    safe.onboarded = raw.onboarded === true;
    if (raw.settings && typeof raw.settings === 'object') {
      const s = raw.settings;
      safe.settings.timeZone = typeof s.timeZone === 'string' && validZone(s.timeZone) ? s.timeZone : safe.settings.timeZone;
      safe.settings.remindersEnabled = s.remindersEnabled === true;
      safe.settings.firstReminderLocal = typeof s.firstReminderLocal === 'string' && validTime(s.firstReminderLocal) ? s.firstReminderLocal : '09:00';
    }
    if (raw.days && typeof raw.days === 'object') {
      for (const [key, value] of Object.entries(raw.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') continue;
        const status = validStatuses.has(value.workoutStatus) ? value.workoutStatus : 'unplanned';
        let nutrition = null;
        if (value.nutrition && typeof value.nutrition === 'object') {
          const n = value.nutrition;
          if (Number.isSafeInteger(n.kcal) && n.kcal >= 0 &&
              ['proteinG', 'fatG', 'carbsG'].every(field => Number.isFinite(n[field]) && n[field] >= 0)) {
            nutrition = { kcal: n.kcal, proteinG: n.proteinG, fatG: n.fatG, carbsG: n.carbsG };
          }
        }
        if (status !== 'unplanned' || nutrition) {
          safe.days[key] = { localDate: key, workoutStatus: status, nutrition, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '' };
        }
      }
    }
    return safe;
  }

  function loadModel() {
    try { return normalizeModel(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch { return defaultModel(); }
  }

  function validTime(value) {
    if (!/^\d{2}:\d{2}$/.test(value)) return false;
    const [hours, minutes] = value.split(':').map(Number);
    return hours < 24 && minutes < 60;
  }

  function dateKeyInZone(timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function dateFromKey(key) { return new Date(`${key}T12:00:00Z`); }
  function shiftDate(key, days) {
    const date = dateFromKey(key);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  function startOfWeek(key) {
    const weekday = dateFromKey(key).getUTCDay();
    return shiftDate(key, -((weekday + 6) % 7));
  }
  function dateLabel(key, options = { day: 'numeric', month: 'long' }) {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', ...options }).format(dateFromKey(key));
  }
  function weekLabel(start) {
    return `${dateLabel(start, { day: 'numeric', month: 'short' })} — ${dateLabel(shiftDate(start, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  function weekdayIndex(key) { return (dateFromKey(key).getUTCDay() + 6) % 7; }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  let model = loadModel();
  const ui = {
    view: model.onboarded ? 'today' : 'welcome',
    weekStart: startOfWeek(dateKeyInZone(model.settings.timeZone)),
    selectedDate: null,
    workoutExpanded: false,
    nutritionDraft: null,
    nutritionErrors: {},
    settingsDraft: null,
    settingsErrors: {},
    modal: null,
    flash: '',
    error: '',
    failNext: false,
    saving: false
  };

  function todayKey() { return dateKeyInZone(model.settings.timeZone); }
  function dayEntry(key) {
    return model.days[key] || { localDate: key, workoutStatus: 'unplanned', nutrition: null, updatedAt: '' };
  }
  function cloneModel() { return JSON.parse(JSON.stringify(model)); }
  async function save(next, successText = 'Сохранено') {
    if (ui.saving) return false;
    ui.saving = true;
    ui.error = '';
    ui.flash = '';
    render();
    await new Promise(resolve => setTimeout(resolve, 350));
    ui.saving = false;
    if (ui.failNext) {
      ui.failNext = false;
      toolStatus.textContent = 'Ошибка сохранения показана в приложении.';
      ui.error = 'Не удалось сохранить. Попробуйте ещё раз.';
      ui.flash = '';
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      model = next;
      ui.error = '';
      ui.flash = successText;
      return true;
    } catch {
      ui.error = 'Не удалось сохранить. Попробуйте ещё раз.';
      ui.flash = '';
      return false;
    }
  }
  async function saveWorkout(status) {
    const key = todayKey();
    const next = cloneModel();
    const old = dayEntry(key);
    if (status === 'unplanned' && !old.nutrition) delete next.days[key];
    else next.days[key] = { localDate: key, workoutStatus: status, nutrition: old.nutrition, updatedAt: new Date().toISOString() };
    if (await save(next, status === 'rest' ? 'День отмечен без тренировки' : 'Отметка сохранена')) {
      ui.workoutExpanded = false;
      ui.modal = null;
      const focusTarget = status === 'planned' ? '[data-action="complete"]' : status === 'unplanned' ? '[data-action="plan"]' : '[data-action="toggle-workout"]';
      render(focusTarget);
    } else {
      render(ui.modal ? '[data-action="cancel-reset"]' : '.screen h1');
    }
  }

  function renderHeader() {
    return `<header class="app-header"><div class="brand" aria-label="ВИНЛАНД, условный знак гор"><span class="mountains" aria-hidden="true"></span><span>ВИНЛАНД</span></div><span class="header-note">ДНЕВНИК</span></header>`;
  }
  function renderNav() {
    if (!model.onboarded) return '';
    const active = ui.view === 'day' ? 'journal' : ui.view === 'nutrition' ? 'today' : ui.view;
    return `<nav class="bottom-nav" aria-label="Разделы приложения">
      ${[['today', 'Сегодня'], ['journal', 'Журнал'], ['settings', 'Настройки']].map(([view, title]) =>
        `<button type="button" data-action="nav-${view}" ${active === view ? 'aria-current="page"' : ''}>${title}</button>`).join('')}
    </nav>`;
  }
  function renderNotice() {
    if (ui.saving) return `<div class="notice" role="status" aria-live="polite">Сохраняем…</div>`;
    if (ui.error) return `<div class="notice notice-error" role="alert">${escapeHTML(ui.error)}</div>`;
    if (ui.flash) return `<div class="notice" role="status" aria-live="polite">${escapeHTML(ui.flash)}</div>`;
    return '';
  }
  function renderWelcome() {
    return `<section class="screen onboarding" aria-labelledby="welcome-title">
      <div><p class="eyebrow">ПЕРВЫЙ ШАГ</p><h1 id="welcome-title">ТВОЙ РИТМ. ТВОИ ДАННЫЕ.</h1>
      <p class="intro">Отмечайте тренировку сегодня и сохраняйте дневной итог КБЖУ. Всё нужное — в одном месте.</p>
      <div class="onboarding-benefits"><p><strong>Сегодня</strong>Запланировать тренировку и отметить результат.</p><p><strong>Журнал</strong>Посмотреть дни и итог недели.</p></div></div>
      <div><button type="button" class="action action-primary action-full" data-action="start">Начать</button>
      <p class="help-text">Аккаунт сайта для начала не требуется.</p></div>
    </section>`;
  }
  const workoutLabels = {
    unplanned: 'Не запланирована', planned: 'Запланирована',
    completed: 'Выполнена', rest: 'День без тренировки'
  };
  function workoutActions(status) {
    if (status === 'unplanned') return `<div class="actions"><button type="button" class="action action-primary" data-action="plan">Запланировать на сегодня</button><button type="button" class="action" data-action="rest">Сегодня без тренировки</button></div>`;
    if (status === 'planned') return `<div class="actions"><button type="button" class="action action-primary" data-action="complete">Выполнено</button><button type="button" class="action" data-action="rest">Сегодня без тренировки</button></div><button type="button" class="action action-subtle" data-action="request-reset">Убрать план</button>`;
    return `<button type="button" class="action action-subtle" data-action="toggle-workout">${ui.workoutExpanded ? 'Скрыть варианты' : 'Изменить отметку'}</button>
      ${ui.workoutExpanded ? `<div class="actions" role="group" aria-label="Изменение отметки"><button type="button" class="action" data-action="complete" ${status === 'completed' ? 'aria-pressed="true"' : ''}>Выполнено</button><button type="button" class="action" data-action="rest" ${status === 'rest' ? 'aria-pressed="true"' : ''}>Без тренировки</button><button type="button" class="action" data-action="plan">Снова запланировать</button></div><button type="button" class="action action-subtle action-danger" data-action="request-reset">Сбросить отметку</button>` : ''}`;
  }
  function nutritionMetrics(nutrition) {
    const data = nutrition || { kcal: '—', proteinG: '—', fatG: '—', carbsG: '—' };
    return `<div class="metric-grid" aria-label="КБЖУ за день">
      <div class="metric"><strong>${data.kcal}</strong><span>ккал</span></div>
      <div class="metric"><strong>${data.proteinG}</strong><span>белки, г</span></div>
      <div class="metric"><strong>${data.fatG}</strong><span>жиры, г</span></div>
      <div class="metric"><strong>${data.carbsG}</strong><span>углеводы, г</span></div>
    </div>`;
  }
  function renderToday() {
    const key = todayKey();
    const entry = dayEntry(key);
    const copy = {
      unplanned: 'План на сегодня пока не задан.',
      planned: 'План на сегодня готов. Отметьте результат, когда закончите.',
      completed: 'Тренировка отмечена. Запись можно исправить.',
      rest: 'Сегодня день без тренировки. Это тоже завершённая отметка.'
    };
    return `<section class="screen" aria-labelledby="today-title">
      <p class="eyebrow">${escapeHTML(dateLabel(key, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase())}</p>
      <h1 id="today-title">ТВОЙ ДЕНЬ.</h1><p class="intro">Один день — два коротких действия.</p>
      <section class="section" aria-labelledby="workout-title"><div class="section-head"><div><p class="section-kicker">ДВИЖЕНИЕ</p><h2 id="workout-title">ТРЕНИРОВКА</h2></div><span class="status">${workoutLabels[entry.workoutStatus]}</span></div>
      <p class="section-copy">${copy[entry.workoutStatus]}</p>${workoutActions(entry.workoutStatus)}</section>
      <section class="section" aria-labelledby="nutrition-title"><div class="section-head"><div><p class="section-kicker">ПИТАНИЕ</p><h2 id="nutrition-title">КБЖУ ЗА ДЕНЬ</h2></div><span class="status">${entry.nutrition ? 'Сохранено' : 'Не внесено'}</span></div>
      ${nutritionMetrics(entry.nutrition)}<button type="button" class="action action-subtle" data-action="edit-nutrition">${entry.nutrition ? 'Изменить итог дня' : 'Внести итог дня'} ↗</button></section>
    </section>`;
  }

  function fieldError(name) { return ui.nutritionErrors[name] ? escapeHTML(ui.nutritionErrors[name]) : ''; }
  function nutritionField(name, title, hint, inputMode) {
    const draft = ui.nutritionDraft || {};
    const invalid = Boolean(ui.nutritionErrors[name]);
    return `<label class="field" for="field-${name}">${title}<small>${hint}</small>
      <input id="field-${name}" name="${name}" type="text" inputmode="${inputMode}" autocomplete="off" value="${escapeHTML(draft[name] || '')}" ${invalid ? 'aria-invalid="true"' : ''} aria-describedby="error-${name}">
      <span id="error-${name}" class="field-error">${fieldError(name)}</span></label>`;
  }
  function renderNutrition() {
    return `<section class="screen" aria-labelledby="nutrition-form-title"><button type="button" class="back-link" data-action="nav-today">← Сегодня</button>
      <p class="eyebrow">${escapeHTML(dateLabel(todayKey(), { day: 'numeric', month: 'long' }).toUpperCase())}</p>
      <h1 id="nutrition-form-title">ИТОГ ПИТАНИЯ.</h1><p class="intro">Введите четыре значения за сегодняшний день. Пустое поле не считается нулём.</p>
      <form id="nutrition-form" novalidate><div class="form-grid">
        ${nutritionField('kcal', 'Калории', 'ккал, целое число', 'numeric')}
        ${nutritionField('proteinG', 'Белки', 'г, до 1 знака', 'decimal')}
        ${nutritionField('fatG', 'Жиры', 'г, до 1 знака', 'decimal')}
        ${nutritionField('carbsG', 'Углеводы', 'г, до 1 знака', 'decimal')}
      </div><div class="actions"><button type="submit" class="action action-primary">Сохранить итог</button><button type="button" class="action" data-action="nav-today">Отмена</button></div></form>
      <p class="help-text">Калории вводятся отдельно: приложение не рассчитывает их из БЖУ.</p>
    </section>`;
  }
  function summaryForWeek(start) {
    const days = Array.from({ length: 7 }, (_, index) => dayEntry(shiftDate(start, index)));
    return {
      completed: days.filter(day => day.workoutStatus === 'completed').length,
      rest: days.filter(day => day.workoutStatus === 'rest').length,
      nutrition: days.filter(day => day.nutrition !== null).length,
      hasData: days.some(day => day.workoutStatus !== 'unplanned' || day.nutrition !== null)
    };
  }
  function renderJournal() {
    const start = ui.weekStart;
    const summary = summaryForWeek(start);
    const currentWeek = startOfWeek(todayKey());
    const rows = Array.from({ length: 7 }, (_, index) => {
      const key = shiftDate(start, index);
      const entry = dayEntry(key);
      const future = key > todayKey();
      return `<li><button type="button" class="day-row" data-action="open-day" data-date="${key}" ${future ? 'disabled' : ''}>
        <span><strong>${dayNames[index]} · ${dateLabel(key, { day: 'numeric', month: 'short' })}</strong><small>${future ? 'Будущий день' : entry.nutrition ? 'КБЖУ внесены' : 'КБЖУ не внесены'}</small></span>
        <b>${future ? '—' : entry.workoutStatus === 'unplanned' ? 'Нет отметки' : workoutLabels[entry.workoutStatus]}</b></button></li>`;
    }).join('');
    return `<section class="screen" aria-labelledby="journal-title"><p class="eyebrow">ЖУРНАЛ</p><h1 id="journal-title">ТВОЯ НЕДЕЛЯ.</h1><p class="intro">Факты дня без оценок и догадок.</p>
      <div class="week-header"><span class="week-title">${weekLabel(start)}</span><div class="week-controls" aria-label="Переключить неделю"><button type="button" data-action="prev-week" aria-label="Предыдущая неделя">‹</button><button type="button" data-action="next-week" aria-label="Следующая неделя" ${start >= currentWeek ? 'disabled' : ''}>›</button></div></div>
      <div class="summary" aria-label="Итог недели"><div><strong>${summary.completed}</strong><span>выполнено</span></div><div><strong>${summary.rest}</strong><span>без тренировки</span></div><div><strong>${summary.nutrition}</strong><span>дней с КБЖУ</span></div></div>
      ${summary.hasData ? '' : `<div class="empty-state"><h3>ПОКА НЕТ ЗАПИСЕЙ</h3><p>Начните с сегодняшнего дня — здесь появится история.</p><button type="button" class="action action-subtle" data-action="nav-today">Открыть сегодня ↗</button></div>`}
      <ul class="day-list">${rows}</ul></section>`;
  }
  function renderDay() {
    const key = ui.selectedDate || todayKey();
    const entry = dayEntry(key);
    const nutrition = entry.nutrition;
    return `<section class="screen" aria-labelledby="day-title"><button type="button" class="back-link" data-action="back-journal">← К неделе</button>
      <p class="eyebrow">${escapeHTML(dateLabel(key, { weekday: 'long' }).toUpperCase())} · ${key.slice(0, 4)}</p><h1 id="day-title">${escapeHTML(dateLabel(key, { day: 'numeric', month: 'long' }).toUpperCase())}.</h1>
      <section class="section" aria-labelledby="day-workout-title"><p class="section-kicker">ДВИЖЕНИЕ</p><h2 id="day-workout-title">ТРЕНИРОВКА</h2>
      <div class="detail-line"><span>Статус</span><strong>${entry.workoutStatus === 'unplanned' ? 'Нет отметки' : workoutLabels[entry.workoutStatus]}</strong></div></section>
      <section class="section" aria-labelledby="day-food-title"><p class="section-kicker">ПИТАНИЕ</p><h2 id="day-food-title">КБЖУ ЗА ДЕНЬ</h2>
      ${nutrition ? nutritionMetrics(nutrition) : `<p class="section-copy">Не внесено.</p>`}</section>
      ${key === todayKey() ? `<div class="actions"><button type="button" class="action action-primary" data-action="nav-today">Открыть сегодня</button></div>` : `<p class="help-text">Прошедшие дни в этом черновике доступны только для просмотра.</p>`}
    </section>`;
  }
  function zoneOptions(selected) {
    const zones = suggestedZones.slice();
    if (!zones.some(([zone]) => zone === selected)) zones.unshift([selected, selected]);
    return zones.map(([zone, label]) => `<option value="${escapeHTML(zone)}" ${zone === selected ? 'selected' : ''}>${escapeHTML(label)} · ${escapeHTML(zone)}</option>`).join('');
  }
  function reminderPreview(settings) {
    if (!settings.remindersEnabled) return 'Напоминания выключены.';
    if (!validTime(settings.firstReminderLocal)) return 'Укажите время первого напоминания.';
    const [hours, minutes] = settings.firstReminderLocal.split(':').map(Number);
    const second = hours * 60 + minutes + 720;
    if (second >= 1440) return `Первое: ${settings.firstReminderLocal}. Второе попадает на следующий день и не отправится.`;
    return `Предварительно: ${settings.firstReminderLocal} и ${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}. Только если тренировка ещё запланирована.`;
  }
  function renderSettings() {
    const draft = ui.settingsDraft || { ...model.settings };
    return `<section class="screen" aria-labelledby="settings-title"><p class="eyebrow">НАСТРОЙКИ</p><h1 id="settings-title">ТВОЙ РИТМ.</h1><p class="intro">Выберите время и часовой пояс для будущих напоминаний.</p>
      <form id="settings-form" novalidate><label class="setting-row" for="reminders-enabled"><span><strong>Напоминания</strong><small>О запланированной тренировке</small></span><input id="reminders-enabled" name="remindersEnabled" type="checkbox" ${draft.remindersEnabled ? 'checked' : ''}></label>
      <div class="form-spaced"><label class="field" for="first-reminder">Первое напоминание<small>Второе — через 12 часов, если ещё сегодня</small>
      <input id="first-reminder" name="firstReminderLocal" type="time" value="${escapeHTML(draft.firstReminderLocal)}" ${draft.remindersEnabled ? '' : 'disabled'} ${ui.settingsErrors.firstReminderLocal ? 'aria-invalid="true"' : ''} aria-describedby="first-reminder-error"></label><span id="first-reminder-error" class="field-error">${escapeHTML(ui.settingsErrors.firstReminderLocal || '')}</span>
      <label class="field" for="time-zone">Часовой пояс<small>Определяет, какой день считается сегодняшним</small><select id="time-zone" name="timeZone" ${ui.settingsErrors.timeZone ? 'aria-invalid="true"' : ''} aria-describedby="time-zone-error">${zoneOptions(draft.timeZone)}</select></label><span id="time-zone-error" class="field-error">${escapeHTML(ui.settingsErrors.timeZone || '')}</span>
      <p id="reminder-preview" class="help-text">${escapeHTML(reminderPreview(draft))}</p><button type="submit" class="action action-primary">Сохранить настройки</button></div></form>
      <section class="section" aria-labelledby="connection-title"><p class="section-kicker">В БУДУЩЕМ</p><h2 id="connection-title">АККАУНТ ВИНЛАНД</h2>
      <div class="setting-row"><span><strong>Связь с сайтом</strong><small>Позже можно будет привязать Telegram к аккаунту сайта.</small></span><span class="setting-value setting-value-muted">Пока недоступно</span></div></section>
      <p class="help-text">Это локальный прототип. Сообщения в Telegram здесь не отправляются.</p>
    </section>`;
  }
  function renderModal() {
    if (ui.modal !== 'reset-workout') return '';
    return `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description">
      <h2 id="reset-title">СБРОСИТЬ ОТМЕТКУ?</h2><p id="reset-description">Тренировка вернётся в состояние «Не запланирована». Данные КБЖУ останутся.</p>
      <div class="actions"><button type="button" class="action action-primary" data-action="confirm-reset">Сбросить</button><button type="button" class="action" data-action="cancel-reset">Оставить</button></div>
    </div></div>`;
  }
  let lastRenderedView = null;
  function render(focusSelector) {
    const viewChanged = lastRenderedView !== ui.view;
    const screen = {
      welcome: renderWelcome, today: renderToday, nutrition: renderNutrition,
      journal: renderJournal, day: renderDay, settings: renderSettings
    }[ui.view] || renderToday;
    app.innerHTML = `${renderHeader()}${renderNotice()}${screen()}${renderNav()}${renderModal()}`;
    lastRenderedView = ui.view;
    if (ui.saving) app.querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
    document.getElementById('prototype-reset').disabled = ui.saving;
    document.getElementById('prototype-fail').disabled = ui.saving;
    if (focusSelector) {
      const target = app.querySelector(focusSelector);
      if (target) {
        if (!target.hasAttribute('tabindex') && !/^(BUTTON|INPUT|SELECT)$/.test(target.tagName)) target.setAttribute('tabindex', '-1');
        target.focus();
      }
    }
    if (viewChanged) window.scrollTo(0, 0);
  }

  function navigate(view) {
    ui.view = view;
    ui.error = '';
    ui.flash = '';
    ui.modal = null;
    if (view === 'settings') {
      ui.settingsDraft = { ...model.settings };
      ui.settingsErrors = {};
    }
    if (view === 'journal') ui.weekStart = startOfWeek(todayKey());
    render('.screen h1');
  }
  function openNutrition() {
    const nutrition = dayEntry(todayKey()).nutrition;
    ui.nutritionDraft = nutrition ? {
      kcal: String(nutrition.kcal), proteinG: String(nutrition.proteinG),
      fatG: String(nutrition.fatG), carbsG: String(nutrition.carbsG)
    } : { kcal: '', proteinG: '', fatG: '', carbsG: '' };
    ui.nutritionErrors = {};
    navigate('nutrition');
  }
  function parseNutrition() {
    const result = {};
    const errors = {};
    const draft = ui.nutritionDraft;
    const kcalText = draft.kcal.trim();
    if (!/^\d+$/.test(kcalText) || !Number.isSafeInteger(Number(kcalText))) errors.kcal = 'Введите калории целым числом от 0.';
    else result.kcal = Number(kcalText);
    for (const field of ['proteinG', 'fatG', 'carbsG']) {
      const text = draft[field].trim();
      if (!/^\d+(?:[.,]\d)?$/.test(text) || !Number.isFinite(Number(text.replace(',', '.')))) {
        errors[field] = 'Введите число от 0, не более одного знака после запятой.';
      } else result[field] = Number(text.replace(',', '.'));
    }
    return { result, errors };
  }
  async function saveNutrition() {
    const { result, errors } = parseNutrition();
    ui.nutritionErrors = errors;
    if (Object.keys(errors).length) {
      ui.error = 'Проверьте выделенные поля.';
      render(`#field-${Object.keys(errors)[0]}`);
      return;
    }
    const key = todayKey();
    const next = cloneModel();
    const old = dayEntry(key);
    next.days[key] = { localDate: key, workoutStatus: old.workoutStatus, nutrition: result, updatedAt: new Date().toISOString() };
    if (await save(next, 'Итог КБЖУ сохранён')) {
      ui.nutritionErrors = {};
      ui.view = 'today';
      render('.screen h1');
    } else render('button[type="submit"]');
  }
  async function saveSettings() {
    const draft = ui.settingsDraft;
    const errors = {};
    if (!validZone(draft.timeZone)) errors.timeZone = 'Выберите часовой пояс из списка.';
    if (!validTime(draft.firstReminderLocal)) errors.firstReminderLocal = 'Укажите время первого напоминания.';
    ui.settingsErrors = errors;
    if (Object.keys(errors).length) {
      ui.error = 'Проверьте настройки.';
      render(errors.firstReminderLocal ? '#first-reminder' : '#time-zone');
      return;
    }
    const next = cloneModel();
    next.settings = { ...draft };
    if (await save(next, 'Настройки сохранены')) {
      ui.weekStart = startOfWeek(todayKey());
      render('#settings-title');
    } else render('button[type="submit"]');
  }

  app.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || !app.contains(button) || button.disabled || ui.saving) return;
    const action = button.dataset.action;
    if (action.startsWith('nav-')) { navigate(action.slice(4)); return; }
    switch (action) {
      case 'start': {
        const next = cloneModel(); next.onboarded = true;
        void save(next, 'Добро пожаловать').then(saved => {
          if (saved) ui.view = 'today';
          render(saved ? '.screen h1' : '[data-action="start"]');
        });
        break;
      }
      case 'plan': saveWorkout('planned'); break;
      case 'complete': saveWorkout('completed'); break;
      case 'rest': saveWorkout('rest'); break;
      case 'toggle-workout': ui.workoutExpanded = !ui.workoutExpanded; ui.error = ''; render(); break;
      case 'request-reset': ui.modal = 'reset-workout'; render('[data-action="cancel-reset"]'); break;
      case 'cancel-reset': ui.modal = null; render('[data-action="request-reset"]'); break;
      case 'confirm-reset': saveWorkout('unplanned'); break;
      case 'edit-nutrition': openNutrition(); break;
      case 'prev-week': ui.weekStart = shiftDate(ui.weekStart, -7); ui.error = ''; render(); break;
      case 'next-week': if (ui.weekStart < startOfWeek(todayKey())) { ui.weekStart = shiftDate(ui.weekStart, 7); ui.error = ''; render(); } break;
      case 'open-day':
        if (button.dataset.date <= todayKey()) { ui.selectedDate = button.dataset.date; ui.view = 'day'; ui.error = ''; ui.flash = ''; render('.screen h1'); }
        break;
      case 'back-journal': ui.view = 'journal'; ui.error = ''; ui.flash = ''; render('.screen h1'); break;
      default: break;
    }
  });
  app.addEventListener('input', event => {
    const input = event.target;
    if (input.closest('#nutrition-form') && ui.nutritionDraft && input.name in ui.nutritionDraft) {
      ui.nutritionDraft[input.name] = input.value;
      delete ui.nutritionErrors[input.name];
      input.removeAttribute('aria-invalid');
      const errorNode = document.getElementById(`error-${input.name}`);
      if (errorNode) errorNode.textContent = '';
      if (ui.error === 'Проверьте выделенные поля.' && Object.keys(ui.nutritionErrors).length === 0) {
        ui.error = '';
        app.querySelector('.notice-error')?.remove();
      }
    }
    if (input.closest('#settings-form') && ui.settingsDraft && input.name in ui.settingsDraft) {
      ui.settingsDraft[input.name] = input.type === 'checkbox' ? input.checked : input.value;
      delete ui.settingsErrors[input.name];
      input.removeAttribute('aria-invalid');
      const errorId = input.name === 'firstReminderLocal' ? 'first-reminder-error' : input.name === 'timeZone' ? 'time-zone-error' : null;
      if (errorId) document.getElementById(errorId).textContent = '';
      if (ui.error === 'Проверьте настройки.' && Object.keys(ui.settingsErrors).length === 0) {
        ui.error = '';
        app.querySelector('.notice-error')?.remove();
      }
      const timeInput = document.getElementById('first-reminder');
      if (timeInput) timeInput.disabled = !ui.settingsDraft.remindersEnabled;
      const preview = document.getElementById('reminder-preview');
      if (preview) preview.textContent = reminderPreview(ui.settingsDraft);
    }
  });
  app.addEventListener('change', event => {
    const input = event.target;
    if (input.closest('#settings-form') && ui.settingsDraft && input.name in ui.settingsDraft) {
      ui.settingsDraft[input.name] = input.type === 'checkbox' ? input.checked : input.value;
      const preview = document.getElementById('reminder-preview');
      if (preview) preview.textContent = reminderPreview(ui.settingsDraft);
    }
  });
  app.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.id === 'nutrition-form') saveNutrition();
    if (event.target.id === 'settings-form') saveSettings();
  });
  document.addEventListener('keydown', event => {
    if (!ui.modal) return;
    if (event.key === 'Escape') { ui.modal = null; render('[data-action="request-reset"]'); return; }
    if (event.key === 'Tab') {
      const buttons = [...app.querySelectorAll('.modal button')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.getElementById('prototype-reset').addEventListener('click', () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* local storage may be unavailable */ }
    model = defaultModel();
    Object.assign(ui, {
      view: 'welcome', weekStart: startOfWeek(dateKeyInZone(model.settings.timeZone)), selectedDate: null,
      workoutExpanded: false, nutritionDraft: null, nutritionErrors: {}, settingsDraft: null,
      settingsErrors: {}, modal: null, flash: '', error: '', failNext: false, saving: false
    });
    toolStatus.textContent = 'Пример сброшен.';
    render();
  });
  document.getElementById('prototype-fail').addEventListener('click', () => {
    ui.failNext = true;
    toolStatus.textContent = 'Следующее сохранение покажет ошибку.';
  });

  render();
})();
