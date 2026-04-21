/**
 * Pagina: Recepten
 * Zweck: Receptenbibliotheek — overzicht, detail, formulier, URL-import
 */

import { api }          from '/api.js';
import { t }            from '/i18n.js';
import { confirmModal } from '/components/modal.js';
import { esc }          from '/utils/html.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function photoSrc(recipe) {
  if (recipe.photo_path) return `/uploads/recipes/${recipe.photo_path.split('/').pop()}`;
  if (recipe.photo_url)  return recipe.photo_url;
  return null;
}

function tagChips(tags) {
  if (!tags) return '';
  return tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    .map((tag) => `<span class="recipe-tag">${esc(tag)}</span>`).join('');
}

// ── Overzichtsweergave ────────────────────────────────────────────────────────

async function renderList(container) {
  let recipes = [];
  let activeTag = '';
  let searchQ   = '';

  async function load() {
    try {
      const params = new URLSearchParams();
      if (activeTag) params.set('tag', activeTag);
      else if (searchQ) params.set('q', searchQ);
      const res = await api.get(`/recipes${params.size ? '?' + params.toString() : ''}`);
      recipes = res.data ?? [];
    } catch { recipes = []; }
    render();
  }

  let searchDebounce = null;

  function render() {
    const allTags = [...new Set(
      recipes.flatMap((r) => (r.tags || '').split(',').map((tg) => tg.trim()).filter(Boolean))
    )].sort();

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">${t('recipes.title')}</h1>
        <div class="page-header__actions">
          <button class="btn btn--secondary" id="import-url-btn">
            <i data-lucide="link" style="width:14px;height:14px;" aria-hidden="true"></i>
            ${t('recipes.importFromUrl')}
          </button>
          <button class="btn btn--primary" id="add-recipe-btn">${t('recipes.add')}</button>
        </div>
      </div>

      <div class="recipes-controls">
        <input class="form-input" type="search" id="recipe-search"
               placeholder="${t('recipes.searchPlaceholder')}" value="${searchQ}" />
        <div class="recipe-tags-filter" id="tag-filter">
          ${allTags.map((tag) => `
            <button class="recipe-tag ${activeTag === tag ? 'recipe-tag--active' : ''}"
                    data-tag="${tag}">${tag}</button>
          `).join('')}
        </div>
      </div>

      ${recipes.length === 0 ? `<p class="empty-state">${t('recipes.noRecipes')}</p>` : `
        <div class="recipes-grid" id="recipes-grid">
          ${recipes.map((r) => {
            const photo = photoSrc(r);
            return `
              <div class="recipe-card" data-id="${r.id}">
                <div class="recipe-card__photo-wrap">
                  <div class="recipe-card__photo recipe-card__photo--placeholder"></div>
                  ${photo ? `<img class="recipe-card__photo" src="${photo}" alt="${esc(r.title)}" loading="lazy" onerror="this.style.display='none'" />` : ''}
                </div>
                <div class="recipe-card__body">
                  <div class="recipe-card__title">${esc(r.title)}</div>
                  ${r.servings ? `<div class="recipe-card__meta">${t('recipes.forPersons', { n: r.servings })}</div>` : ''}
                  <div class="recipe-card__tags">${tagChips(r.tags)}</div>
                </div>
              </div>`;
          }).join('')}
        </div>
      `}
    `;

    container.querySelector('#add-recipe-btn')?.addEventListener('click', () => renderForm(container));
    container.querySelector('#import-url-btn')?.addEventListener('click', () => renderForm(container, null, { defaultTab: 'import' }));
    container.querySelector('#recipe-search')?.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchQ   = e.target.value.trim();
        activeTag = '';
        load();
      }, 300);
    });
    container.querySelectorAll('#tag-filter [data-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTag = activeTag === btn.dataset.tag ? '' : btn.dataset.tag;
        searchQ   = '';
        load();
      });
    });
    container.querySelectorAll('.recipe-card').forEach((card) => {
      card.addEventListener('click', () => renderDetail(container, parseInt(card.dataset.id, 10)));
    });
  }

  await load();
}

// ── Detailweergave ────────────────────────────────────────────────────────────

async function renderDetail(container, id) {
  let recipe;
  try {
    const res = await api.get(`/recipes/${id}`);
    recipe = res.data;
  } catch {
    container.innerHTML = `<p class="empty-state">Recept niet gevonden.</p>`;
    return;
  }

  const photo = photoSrc(recipe);

  container.innerHTML = `
    <div class="page-header">
      <button class="btn btn--ghost" id="back-btn">← ${t('recipes.title')}</button>
      <div class="page-header__actions">
        <button class="btn btn--secondary" id="edit-btn">${t('recipes.edit')}</button>
        <button class="btn btn--danger-outline" id="delete-btn">${t('recipes.delete')}</button>
      </div>
    </div>

    <div class="recipe-detail-content">
      ${photo ? `<img class="recipe-detail__photo" src="${photo}" alt="${esc(recipe.title)}" />` : ''}

      <h2 class="recipe-detail__title">${esc(recipe.title)}</h2>
      ${recipe.description ? `<p class="recipe-detail__desc">${esc(recipe.description)}</p>` : ''}

      <div class="recipe-detail__meta">
        <span class="recipe-detail__servings">${t('recipes.forPersons', { n: recipe.servings })}</span>
        ${recipe.source_url ? `<a href="${encodeURI(recipe.source_url)}" target="_blank" rel="noopener" class="recipe-detail__source">${t('recipes.source')}</a>` : ''}
        <div class="recipe-detail__tags">${tagChips(recipe.tags)}</div>
      </div>

      <button class="btn btn--primary" id="to-meal-plan-btn">${t('recipes.addToMealPlan')}</button>

      <h3 class="recipe-section-title">${t('recipes.ingredients')}</h3>
      <ul class="recipe-detail__ingredients">
        ${(recipe.ingredients || []).map((ing) => `
          <li>${ing.quantity != null ? `<strong>${esc(String(ing.quantity))}</strong> ` : ''}${esc(ing.unit || '')}${ing.unit ? ' ' : ''}${esc(ing.name)}</li>
        `).join('')}
      </ul>

      <h3 class="recipe-section-title">${t('recipes.steps')}</h3>
      <ol class="recipe-detail__steps">
        ${(recipe.steps || []).map((s) => `<li>${esc(s.instruction)}</li>`).join('')}
      </ol>
    </div>
  `;

  container.querySelector('#back-btn')?.addEventListener('click', () => renderList(container));
  container.querySelector('#edit-btn')?.addEventListener('click', () => renderForm(container, recipe));
  container.querySelector('#delete-btn')?.addEventListener('click', async () => {
    if (!await confirmModal(t('recipes.deleteConfirm'), { danger: true })) return;
    try {
      await api.delete(`/recipes/${id}`);
      renderList(container);
    } catch (err) {
      window.oikos?.showToast(err.message, 'danger');
    }
  });
  container.querySelector('#to-meal-plan-btn')?.addEventListener('click', () => {
    renderAddToMealPlanModal(recipe);
  });
}

// ── Modal: recept aan maaltijdplanning toevoegen ──────────────────────────────

function renderAddToMealPlanModal(recipe) {
  const today = new Date().toISOString().slice(0, 10);
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>${t('recipes.addToMealPlan')}</h3>
      <div class="form-group">
        <label class="form-label">${t('recipes.mealDate')}</label>
        <input class="form-input" type="date" id="meal-date-input" value="${today}" />
      </div>
      <div class="form-group">
        <label class="form-label">${t('recipes.mealType')}</label>
        <select class="form-select" id="meal-type-input">
          <option value="dinner">Diner</option>
          <option value="lunch">Lunch</option>
          <option value="breakfast">Ontbijt</option>
          <option value="snack">Snack</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${t('recipes.scaleServings')}</label>
        <input class="form-input" type="number" id="meal-servings-input" value="${recipe.servings}" min="1" max="50" />
      </div>
      <div class="modal-actions">
        <button class="btn btn--ghost" id="modal-cancel">Annuleren</button>
        <button class="btn btn--primary" id="modal-confirm">Toevoegen</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#modal-cancel')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#modal-confirm')?.addEventListener('click', async () => {
    const mealDate  = modal.querySelector('#meal-date-input').value;
    const mealType  = modal.querySelector('#meal-type-input').value;
    try {
      await api.post('/meals', {
        date:       mealDate,
        meal_type:  mealType,
        title:      recipe.title,
        recipe_id:  recipe.id,
      });
      modal.remove();
      window.oikos?.showToast(t('recipes.addToMealPlanSuccess'), 'success');
    } catch (err) {
      window.oikos?.showToast(err.message, 'danger');
    }
  });
}

// ── Formulier (nieuw + bewerken) ──────────────────────────────────────────────

async function renderForm(container, existing = null, opts = {}) {
  const isEdit = !!existing;
  const defaultTab = opts.defaultTab ?? 'manual';

  function ingredientRow(ing = {}, i = 0) {
    return `
      <div class="recipe-ingredient-row" data-idx="${i}">
        <input class="form-input" type="text" placeholder="${t('recipes.ingredients')}" value="${esc(ing.name || '')}" data-field="name" />
        <input class="form-input" type="number" placeholder="Hoeveelheid" value="${ing.quantity ?? ''}" step="0.1" min="0" data-field="quantity" style="width:90px" />
        <input class="form-input" type="text" placeholder="Eenheid" value="${esc(ing.unit || '')}" data-field="unit" style="width:80px" />
        <button type="button" class="btn btn--ghost btn--icon remove-ingredient-btn">✕</button>
      </div>`;
  }

  function stepRow(step = {}, i = 0) {
    return `
      <div class="recipe-step-row" data-idx="${i}">
        <span class="recipe-step-num">${i + 1}.</span>
        <textarea class="form-input" rows="2" data-field="instruction">${esc(step.instruction || '')}</textarea>
        <button type="button" class="btn btn--ghost btn--icon remove-step-btn">✕</button>
      </div>`;
  }

  const ingredients = existing?.ingredients?.length ? existing.ingredients : [{}];
  const steps       = existing?.steps?.length ? existing.steps : [{}];

  container.innerHTML = `
    <div class="page-header">
      <button class="btn btn--ghost" id="back-btn">← ${t('recipes.title')}</button>
      <h2>${isEdit ? t('recipes.edit') : t('recipes.add')}</h2>
    </div>

    <div class="recipe-form-content">
      <div class="settings-tabs" role="tablist">
        <button class="settings-tab-btn ${defaultTab === 'manual' ? 'settings-tab-btn--active' : ''}" data-tab="manual">${t('recipes.manualTab')}</button>
        <button class="settings-tab-btn ${defaultTab === 'import' ? 'settings-tab-btn--active' : ''}" data-tab="import">
          <i data-lucide="link" style="width:13px;height:13px;vertical-align:-2px;" aria-hidden="true"></i>
          ${t('recipes.importTab')}
        </button>
      </div>

      <div id="tab-import" class="tab-panel recipe-import-panel" ${defaultTab !== 'import' ? 'hidden' : ''}>
        <p class="recipe-import-hint">${t('recipes.importHint')}</p>
        <div class="form-group">
          <label class="form-label" for="scrape-url">${t('recipes.importUrl')}</label>
          <div class="input-with-btn">
            <input class="form-input" type="url" id="scrape-url" placeholder="https://www.jumbo.com/recept/..." autocomplete="off" />
            <button class="btn btn--primary" id="scrape-btn">
              <i data-lucide="download" style="width:14px;height:14px;" aria-hidden="true"></i>
              ${t('recipes.importBtn')}
            </button>
          </div>
          <span id="scrape-error" class="form-error" hidden></span>
        </div>
      </div>

      <form id="recipe-form">
        <div class="form-group">
          <label class="form-label">Titel *</label>
          <input class="form-input" type="text" id="recipe-title" value="${esc(existing?.title || '')}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Beschrijving</label>
          <textarea class="form-input" id="recipe-desc" rows="3">${esc(existing?.description || '')}</textarea>
        </div>
        <div class="form-group" style="max-width:120px">
          <label class="form-label">${t('recipes.servings')} *</label>
          <input class="form-input" type="number" id="recipe-servings" value="${existing?.servings || 4}" min="1" max="100" required />
        </div>
        <div class="form-group">
          <label class="form-label">${t('recipes.tags')}</label>
          <input class="form-input" type="text" id="recipe-tags" value="${esc(existing?.tags || '')}" placeholder="pasta, vegetarisch, snel" />
        </div>
        <div class="form-group">
          <label class="form-label">${t('recipes.source')}</label>
          <input class="form-input" type="url" id="recipe-source" value="${esc(existing?.source_url || '')}" />
        </div>

        <div class="form-group">
          <label class="form-label">${t('recipes.uploadPhoto')}</label>
          <input type="file" id="recipe-photo-file" accept="image/jpeg,image/png,image/webp" />
        </div>
        <div class="form-group">
          <label class="form-label">${t('recipes.photoUrl')}</label>
          <input class="form-input" type="url" id="recipe-photo-url" value="${esc(existing?.photo_url || '')}" />
        </div>

        <h3 class="recipe-section-title">${t('recipes.ingredients')}</h3>
        <div id="ingredients-list">
          ${ingredients.map((ing, i) => ingredientRow(ing, i)).join('')}
        </div>
        <button type="button" class="btn btn--ghost" id="add-ingredient-btn">+ ${t('recipes.addIngredient')}</button>

        <h3 class="recipe-section-title">${t('recipes.steps')}</h3>
        <div id="steps-list">
          ${steps.map((s, i) => stepRow(s, i)).join('')}
        </div>
        <button type="button" class="btn btn--ghost" id="add-step-btn">+ ${t('recipes.addStep')}</button>

        <div class="form-actions">
          <button type="submit" class="btn btn--primary">${isEdit ? t('recipes.edit') : t('recipes.add')}</button>
          <button type="button" class="btn btn--ghost" id="cancel-btn">Annuleren</button>
        </div>
      </form>
    </div>
  `;

  // Tab switching
  container.querySelectorAll('.settings-tab-btn').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.settings-tab-btn').forEach((tb) => tb.classList.remove('settings-tab-btn--active'));
      tab.classList.add('settings-tab-btn--active');
      container.querySelector('#tab-import').hidden = tab.dataset.tab !== 'import';
      if (tab.dataset.tab === 'import') {
        container.querySelector('#scrape-url')?.focus();
      }
    });
  });

  // Auto-focus URL input when opened directly on import tab
  if (defaultTab === 'import') {
    setTimeout(() => container.querySelector('#scrape-url')?.focus(), 50);
  }

  // Scraper
  container.querySelector('#scrape-btn')?.addEventListener('click', async () => {
    const url    = container.querySelector('#scrape-url').value.trim();
    const errEl  = container.querySelector('#scrape-error');
    const btn    = container.querySelector('#scrape-btn');
    errEl.hidden = true;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite;" aria-hidden="true"></i> ${t('recipes.importing')}`;
    try {
      const { data } = await api.post('/recipes/scrape', { url });
      container.querySelector('#recipe-title').value     = data.title || '';
      container.querySelector('#recipe-servings').value  = data.servings || 4;
      container.querySelector('#recipe-source').value    = data.sourceUrl || '';
      container.querySelector('#recipe-photo-url').value = data.imageUrl || '';

      const ingList = container.querySelector('#ingredients-list');
      ingList.innerHTML = (data.ingredients?.length ? data.ingredients : [{}]).map((ing, i) => ingredientRow(ing, i)).join('');
      bindIngredientButtons();

      const stepList = container.querySelector('#steps-list');
      stepList.innerHTML = (data.steps?.length ? data.steps : [{}]).map((s, i) => stepRow(s, i)).join('');
      bindStepButtons();

      container.querySelector('[data-tab="manual"]')?.click();
    } catch (err) {
      errEl.textContent = err.message || t('recipes.importFailed');
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="download" style="width:14px;height:14px;" aria-hidden="true"></i> ${t('recipes.importBtn')}`;
      if (window.lucide) window.lucide.createIcons({ el: btn });
    }
  });

  function bindIngredientButtons() {
    container.querySelectorAll('.remove-ingredient-btn').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('.recipe-ingredient-row').remove());
    });
  }

  function bindStepButtons() {
    container.querySelectorAll('.remove-step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('.recipe-step-row').remove();
        container.querySelectorAll('.recipe-step-num').forEach((num, i) => { num.textContent = `${i + 1}.`; });
      });
    });
  }

  bindIngredientButtons();
  bindStepButtons();

  container.querySelector('#add-ingredient-btn')?.addEventListener('click', () => {
    const list = container.querySelector('#ingredients-list');
    const idx  = list.querySelectorAll('.recipe-ingredient-row').length;
    list.insertAdjacentHTML('beforeend', ingredientRow({}, idx));
    bindIngredientButtons();
  });

  container.querySelector('#add-step-btn')?.addEventListener('click', () => {
    const list = container.querySelector('#steps-list');
    const idx  = list.querySelectorAll('.recipe-step-row').length;
    list.insertAdjacentHTML('beforeend', stepRow({}, idx));
    list.querySelectorAll('.recipe-step-num').forEach((num, i) => { num.textContent = `${i + 1}.`; });
    bindStepButtons();
  });

  container.querySelector('#back-btn')?.addEventListener('click', () => {
    if (existing) renderDetail(container, existing.id);
    else renderList(container);
  });
  container.querySelector('#cancel-btn')?.addEventListener('click', () => {
    if (existing) renderDetail(container, existing.id);
    else renderList(container);
  });

  container.querySelector('#recipe-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const ingredients = [...container.querySelectorAll('.recipe-ingredient-row')].map((row) => ({
      name:     row.querySelector('[data-field="name"]').value.trim(),
      quantity: row.querySelector('[data-field="quantity"]').value || null,
      unit:     row.querySelector('[data-field="unit"]').value.trim() || null,
    })).filter((ing) => ing.name);

    const steps = [...container.querySelectorAll('.recipe-step-row')].map((row, i) => ({
      step_number: i + 1,
      instruction: row.querySelector('[data-field="instruction"]').value.trim(),
    })).filter((s) => s.instruction);

    const payload = {
      title:       container.querySelector('#recipe-title').value.trim(),
      description: container.querySelector('#recipe-desc').value.trim() || null,
      servings:    parseInt(container.querySelector('#recipe-servings').value, 10),
      tags:        container.querySelector('#recipe-tags').value.trim() || null,
      source_url:  container.querySelector('#recipe-source').value.trim() || null,
      photo_url:   container.querySelector('#recipe-photo-url').value.trim() || null,
      ingredients,
      steps,
    };

    try {
      let saved;
      if (isEdit) {
        saved = await api.put(`/recipes/${existing.id}`, payload);
      } else {
        saved = await api.post('/recipes', payload);
      }
      const savedRecipe = saved.data;

      const fileInput = container.querySelector('#recipe-photo-file');
      if (fileInput?.files?.[0]) {
        const formData = new FormData();
        formData.append('photo', fileInput.files[0]);
        await fetch(`/api/v1/recipes/photo/${savedRecipe.id}`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
      }

      renderDetail(container, savedRecipe.id);
    } catch (err) {
      window.oikos?.showToast(err.message, 'danger');
    }
  });
}

// ── Hoofd render-functie ──────────────────────────────────────────────────────

export async function render(container) {
  container.classList.add('recipes-page');
  await renderList(container);
}
