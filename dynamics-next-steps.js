// dynamics-next-steps.js - Update Dynamics CRM "Next Steps" date prefixes.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const DEFAULT_TARGET_URL =
  'https://adobe-ent.crm.dynamics.com/main.aspx?appid=f2e74f34-7119-ea11-a811-000d3a5936c5&pagetype=entitylist&etn=incident&viewid=a753a9e7-16a2-e811-a969-000d3a10877d&viewType=1039';

const MONTH_PATTERN = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const DATE_SEPARATOR_PATTERN = '[:\\-\\u2013\\u2014]';
const DATE_PREFIX = new RegExp(`^(\\s*)${MONTH_PATTERN}\\s+\\d{1,2}(\\s*${DATE_SEPARATOR_PATTERN}\\s*)([\\s\\S]*)$`, 'i');
const CASE_ID = /\bE-\d+\b/;

function boolFromEnv(name, fallback) {
  if (process.env[name] === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(process.env[name].toLowerCase());
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function resolvePathFromCwd(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function formatTodayLabel(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone
  }).formatToParts(new Date());

  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${month} ${day}`;
}

function updateDatePrefix(text, todayLabel) {
  if (!text || !text.trim()) {
    return { status: 'blank', updatedText: text };
  }

  const match = text.match(DATE_PREFIX);
  if (!match) {
    return { status: 'unmatched', updatedText: text };
  }

  return {
    status: 'updated',
    updatedText: `${match[1]}${todayLabel}${match[3]}${match[4]}`
  };
}

function normalizeWhitespace(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferTitleFromRowText(rowText, caseId) {
  const normalized = normalizeWhitespace(rowText);
  const afterCase = normalized.slice(normalized.indexOf(caseId) + caseId.length).trim();
  const statusIndex = afterCase.search(/\bPending\b|\bResolved\b|\bIn Progress\b/i);
  return statusIndex > 0 ? afterCase.slice(0, statusIndex).trim() : afterCase;
}

function getSettings() {
  const dynamicsConfig = config.dynamics?.nextSteps || {};
  return {
    targetUrl: dynamicsConfig.targetUrl || DEFAULT_TARGET_URL,
    timeZone: dynamicsConfig.timeZone || process.env.UPDATE_TIME_ZONE || 'Asia/Calcutta',
    userDataDir: dynamicsConfig.userDataDir || process.env.DYNAMICS_PROFILE_DIR || './.playwright/dynamics-profile',
    headless: boolFromEnv('DYNAMICS_HEADLESS', dynamicsConfig.headless ?? false),
    slowMo: numberFromEnv('DYNAMICS_SLOW_MO', dynamicsConfig.slowMo ?? config.browser?.slowMo ?? 0),
    timeout: numberFromEnv('DYNAMICS_TIMEOUT', dynamicsConfig.timeout ?? config.browser?.timeout ?? 60000),
    loginTimeout: numberFromEnv('DYNAMICS_LOGIN_TIMEOUT', dynamicsConfig.loginTimeout ?? 300000),
    editorTimeout: numberFromEnv('DYNAMICS_EDITOR_TIMEOUT', dynamicsConfig.editorTimeout ?? 30000),
    processAllPages: boolFromEnv('DYNAMICS_PROCESS_ALL_PAGES', dynamicsConfig.processAllPages ?? true),
    maxPages: numberFromEnv('DYNAMICS_MAX_PAGES', dynamicsConfig.maxPages ?? 20),
    reportDirectory: dynamicsConfig.reportDirectory || config.monitoring?.logDirectory || './logs'
  };
}

class DynamicsNextStepsUpdater {
  constructor(options = {}) {
    this.settings = { ...getSettings(), ...options };
    this.todayLabel = options.todayLabel || formatTodayLabel(this.settings.timeZone);
    this.dryRun = !!options.dryRun;
    this.context = null;
    this.page = null;
    this.results = {
      timestamp: new Date().toISOString(),
      targetUrl: this.settings.targetUrl,
      dateLabel: this.todayLabel,
      dryRun: this.dryRun,
      updated: [],
      blank: [],
      skipped: [],
      errors: [],
      reportPath: null
    };
  }

  async initialize() {
    const userDataDir = resolvePathFromCwd(this.settings.userDataDir);
    fs.mkdirSync(path.dirname(userDataDir), { recursive: true });

    console.log('Starting Dynamics next-steps updater...');
    console.log(`Using date label: ${this.todayLabel}`);
    console.log(`Browser profile: ${userDataDir}`);

    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: this.settings.headless,
      slowMo: this.settings.slowMo,
      viewport: null,
      args: ['--start-maximized']
    });

    this.context.on('page', (page) => {
      this.page = page;
      page.setDefaultTimeout(this.settings.timeout);
    });

    this.page = await this.getActivePage();
  }

  async getOpenPages() {
    if (!this.context) return [];
    return this.context.pages().filter((page) => !page.isClosed());
  }

  async getActivePage() {
    const pages = await this.getOpenPages();
    if (this.page && !this.page.isClosed()) {
      this.page.setDefaultTimeout(this.settings.timeout);
      return this.page;
    }

    this.page = pages[pages.length - 1] || await this.context.newPage();
    this.page.setDefaultTimeout(this.settings.timeout);
    return this.page;
  }

  setActivePage(page) {
    this.page = page;
    this.page.setDefaultTimeout(this.settings.timeout);
  }

  async openTargetView() {
    const page = await this.getActivePage();
    console.log(`Opening Dynamics view: ${this.settings.targetUrl}`);
    await page.goto(this.settings.targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.settings.loginTimeout
    });

    console.log('If a Microsoft sign-in screen is shown, complete sign-in in the browser window.');
    await this.waitForCaseGrid();
  }

  async waitForCaseGrid() {
    const deadline = Date.now() + this.settings.loginTimeout;
    let nextProgressLog = 0;

    while (Date.now() < deadline) {
      const grid = await this.findCurrentGridFrame();
      if (grid.frame && grid.rows.length > 0) {
        console.log(`Case grid detected with ${grid.rows.length} visible row(s).`);
        return grid.frame;
      }

      if (Date.now() >= nextProgressLog) {
        await this.logWaitingDiagnostics();
        nextProgressLog = Date.now() + 10000;
      }

      await delay(1000);
    }

    throw new Error('Timed out waiting for the Dynamics case grid. Sign-in may not have completed.');
  }

  async logWaitingDiagnostics() {
    const pages = await this.getOpenPages();
    const pageSummaries = [];

    for (const page of pages) {
      const title = await page.title().catch(() => '');
      pageSummaries.push(`${title || 'untitled'} <${page.url() || 'about:blank'}> frames=${page.frames().length}`);
    }

    console.log(`Still waiting for the case grid... open pages: ${pageSummaries.join(' | ') || 'none'}`);
  }

  async collectCaseRows(frame) {
    const candidates = [
      frame.locator('[role="row"]'),
      frame.locator('[data-id*="cell"]').locator('xpath=ancestor::*[@role="row"][1]')
    ];

    const rows = new Map();
    for (const locator of candidates) {
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const row = locator.nth(index);
        const visible = await row.isVisible().catch(() => false);
        if (!visible) continue;

        const text = await row.textContent().catch(() => '');
        const caseId = text.match(CASE_ID)?.[0];
        if (!caseId || rows.has(caseId)) continue;

        rows.set(caseId, {
          caseId,
          title: inferTitleFromRowText(text, caseId),
          text: normalizeWhitespace(text)
        });
      }
    }

    const domRows = await this.collectCaseRowsFromDom(frame);
    for (const row of domRows) {
      if (!rows.has(row.caseId)) rows.set(row.caseId, row);
    }

    return [...rows.values()];
  }

  async collectCaseRowsFromDom(frame) {
    const rawRows = await frame.evaluate((caseIdPattern) => {
      const caseRe = new RegExp(caseIdPattern, 'g');
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const rowSelector = '[role="row"], tr, [data-id*="row"], [data-id*="grid-cell"], [data-id*="cell"]';
      const results = [];

      const addElement = (element) => {
        const row = element.closest('[role="row"], tr, [data-id*="row"]') ||
          element.closest('[data-id*="grid-cell"], [data-id*="cell"]')?.parentElement ||
          element;
        const text = normalize(row.innerText || row.textContent || element.textContent);
        caseRe.lastIndex = 0;
        if (text && caseRe.test(text)) results.push(text);
      };

      for (const element of Array.from(document.querySelectorAll(rowSelector))) {
        addElement(element);
      }

      if (results.length === 0) {
        for (const element of Array.from(document.querySelectorAll('a, span, div, label'))) {
          const text = normalize(element.innerText || element.textContent);
          caseRe.lastIndex = 0;
          if (caseRe.test(text)) addElement(element);
        }
      }

      return [...new Set(results)].slice(0, 250);
    }, CASE_ID.source).catch(() => []);

    return rawRows
      .map((text) => {
        const caseId = text.match(CASE_ID)?.[0];
        if (!caseId) return null;

        return {
          caseId,
          title: inferTitleFromRowText(text, caseId),
          text: normalizeWhitespace(text)
        };
      })
      .filter(Boolean);
  }

  async findCaseRow(frame, caseId) {
    const candidates = [
      frame.locator('[role="row"]').filter({ hasText: caseId }),
      frame.locator('tr').filter({ hasText: caseId }),
      frame.locator('[data-id*="row"]').filter({ hasText: caseId }),
      frame.locator('[data-id*="cell"]').filter({ hasText: caseId })
    ];

    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const row = candidate.nth(index);
        if (await row.isVisible().catch(() => false)) return row;
      }
    }

    const textHit = frame.getByText(caseId).first();
    await textHit.waitFor({ state: 'visible', timeout: this.settings.timeout });
    const row = textHit.locator('xpath=ancestor-or-self::*[@role="row" or self::tr or contains(@data-id, "row") or contains(@data-id, "cell")][1]');
    return await row.count().catch(() => 0) ? row : textHit;
  }

  async deselectAllRows(frame) {
    // Dynamics checkboxes become visible only on hover, so use force:true to click aria-checked ones
    const checked = frame.locator('[role="row"] [role="checkbox"][aria-checked="true"]');
    const count = await checked.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      await checked.nth(i).click({ force: true }).catch(() => {});
      await delay(300);
    }
    if (count > 0) await delay(500);
  }

  async selectCase(frame, caseRow) {
    this.setActivePage(frame.page());
    await this.deselectAllRows(frame);

    const row = await this.findCaseRow(frame, caseRow.caseId);
    await row.scrollIntoViewIfNeeded();

    const page = frame.page();
    const box = await row.boundingBox();
    if (!box) throw new Error(`Could not locate row bounding box for ${caseRow.caseId}`);

    // Hover over the row first — Dynamics only renders the checkbox on hover
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await delay(400);

    // The checkbox column is the narrow leftmost strip (≈ first 40px of the row)
    const checkbox = row.locator('[role="checkbox"], input[type="checkbox"]').first();
    const cbCount = await checkbox.count().catch(() => 0);

    if (cbCount > 0) {
      const alreadyChecked = await checkbox.getAttribute('aria-checked').catch(() => null);
      if (alreadyChecked !== 'true') {
        await checkbox.click({ force: true });
      }
    } else {
      // Fallback: click the leftmost ~20px of the row where the checkbox should be
      await page.mouse.click(box.x + 20, box.y + box.height / 2);
    }

    // Give the ribbon time to re-render with the single-selection commands
    await delay(1500);
  }

  async findVisibleLocator(locator) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) return item;
    }

    return null;
  }

  async findNextStepsButton(preferredFrame) {
    const pages = await this.getOpenPages();
    const frames = [
      preferredFrame,
      ...pages.flatMap((page) => page.frames()).filter((frame) => frame !== preferredFrame)
    ];

    for (const frame of frames) {
      const candidates = [
        frame.getByRole('button', { name: /Next Steps/i }),
        frame.getByRole('menuitem', { name: /Next Steps/i }),
        frame.locator('button:has-text("Next Steps"), [role="button"]:has-text("Next Steps"), [role="menuitem"]:has-text("Next Steps"), a:has-text("Next Steps")'),
        frame.locator('[aria-label*="Next Steps"], [title*="Next Steps"], [data-id*="Next"]:has-text("Next Steps"), [data-lp-id*="Next"]:has-text("Next Steps")'),
        frame.locator('span:has-text("Next Steps")')
      ];

      for (const candidate of candidates) {
        const button = await this.findVisibleLocator(candidate);
        if (button) return button;
      }
    }

    throw new Error('Could not find the Next Steps ribbon button.');
  }

  async clickNextSteps(frame) {
    this.setActivePage(frame.page());
    const button = await this.findNextStepsButton(frame);
    await button.click();
    await delay(1000);
  }

  async describeEditable(locator) {
    return locator.evaluate((element) => {
      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute('type') || '').toLowerCase();
      const role = (element.getAttribute('role') || '').toLowerCase();
      const editable = element.getAttribute('contenteditable') === 'true';

      if (tag === 'textarea') return { kind: 'input', tag, type, role };
      if (tag === 'input' && !['button', 'submit', 'checkbox', 'radio', 'hidden'].includes(type)) {
        return { kind: 'input', tag, type, role };
      }
      if (editable || role === 'textbox') return { kind: 'contenteditable', tag, type, role };
      return null;
    }).catch(() => null);
  }

  async firstEditableInside(container) {
    const candidates = [
      container.locator('textarea'),
      container.locator('input[type="text"], input:not([type])'),
      container.locator('[contenteditable="true"], [role="textbox"]')
    ];

    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const locator = candidate.nth(index);
        if (!await locator.isVisible().catch(() => false)) continue;

        const editable = await this.describeEditable(locator);
        if (editable) return { locator, editable };
      }
    }

    return null;
  }

  async findNextStepsEditor() {
    const deadline = Date.now() + this.settings.editorTimeout;

    while (Date.now() < deadline) {
      const pages = await this.getOpenPages();
      for (const frame of pages.flatMap((page) => page.frames())) {
        const dialogs = frame.locator('[role="dialog"], [aria-modal="true"], .ms-Dialog-main, [data-id*="dialog"]');
        const dialogCount = await dialogs.count().catch(() => 0);
        for (let index = dialogCount - 1; index >= 0; index -= 1) {
          const dialog = dialogs.nth(index);
          if (!await dialog.isVisible().catch(() => false)) continue;

          const editor = await this.firstEditableInside(dialog);
          if (editor) return { frame, ...editor, inDialog: true };
        }

        const labeledCandidates = [
          frame.getByLabel(/Next Steps/i),
          frame.locator('textarea[aria-label*="Next Steps"], input[aria-label*="Next Steps"], [role="textbox"][aria-label*="Next Steps"]')
        ];

        for (const candidate of labeledCandidates) {
          const count = await candidate.count().catch(() => 0);
          for (let index = 0; index < count; index += 1) {
            const locator = candidate.nth(index);
            if (!await locator.isVisible().catch(() => false)) continue;

            const editable = await this.describeEditable(locator);
            if (editable) return { frame, locator, editable, inDialog: false };
          }
        }
      }

      await delay(500);
    }

    throw new Error('Could not find an editable Next Steps field after clicking the ribbon button.');
  }

  async readEditorValue(editor) {
    if (editor.editable.kind === 'input') {
      return editor.locator.inputValue();
    }

    return editor.locator.evaluate((element) => element.innerText || element.textContent || '');
  }

  async writeEditorValue(editor, value) {
    if (editor.editable.kind === 'input') {
      await editor.locator.fill(value);
      return;
    }

    await editor.locator.click();
    const page = editor.frame.page();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(value);
  }

  async clickDialogButton(frame, names) {
    for (const name of names) {
      const button = await this.findVisibleLocator(frame.getByRole('button', { name }));
      if (button) {
        await button.click();
        await delay(1000);
        return true;
      }
    }

    return false;
  }

  async saveEditor(editor) {
    if (this.dryRun) return;

    const clicked = await this.clickDialogButton(editor.frame, [/^(Save|Update|OK|Apply|Done)$/i]);
    if (!clicked) {
      await editor.frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S').catch(() => {});
      await delay(1000);
    }
  }

  async closeEditor(editor) {
    await this.clickDialogButton(editor.frame, [/^(Cancel|Close)$/i]);
    await editor.frame.page().keyboard.press('Escape').catch(() => {});
    await delay(500);
  }

  async openCaseInNewTab(frame, caseRow) {
    const row = await this.findCaseRow(frame, caseRow.caseId);
    await row.scrollIntoViewIfNeeded();

    const titleLink = row.locator('a').first();
    const linkCount = await titleLink.count().catch(() => 0);
    if (!linkCount) throw new Error(`No title link found for ${caseRow.caseId}`);

    // Extract href and open in a brand-new page so the list tab is never affected
    const href = await titleLink.evaluate((el) => el.href).catch(() => null);
    if (!href || href.startsWith('javascript:')) {
      throw new Error(`Could not extract a navigable URL from the title link for ${caseRow.caseId}`);
    }

    const casePage = await this.context.newPage();
    casePage.setDefaultTimeout(this.settings.timeout);
    await casePage.goto(href, { waitUntil: 'domcontentloaded' });
    await delay(2500);
    return casePage;
  }

  async clickCaseDescriptionTab(casePage) {
    const tab = casePage.getByRole('tab', { name: /Case Description/i }).first();
    const visible = await tab.isVisible().catch(() => false);
    if (visible) {
      await tab.click();
      // Wait for the Case Description form body to render (fields appear async after tab switch)
      await casePage.locator('input[aria-label="Channel"], textarea, input[type="text"]')
        .first()
        .waitFor({ state: 'visible', timeout: this.settings.timeout })
        .catch(() => {});
      await delay(2000);
    }
  }

  async findNextStepsField(casePage) {
    // Wait for the form to have at least one visible input before searching
    await casePage.locator('input, textarea').first()
      .waitFor({ state: 'visible', timeout: this.settings.timeout }).catch(() => {});

    const knownSelectors = [
      '[data-id="ent_nextsteps.fieldControl-text-box-text"]',
      '[aria-label="Next Steps"]',
    ];

    const findInDom = async () => {
      // Check known selectors first
      for (const sel of knownSelectors) {
        const el = casePage.locator(sel).first();
        if (await el.count().catch(() => 0) > 0) return el;
      }
      // Walk up from the "Next Steps" label as fallback
      const labelSel = await casePage.evaluate(() => {
        const normalize = (v) => (v || '').replace(/\s+/g, ' ').trim();
        for (const labelEl of document.querySelectorAll('label')) {
          if (normalize(labelEl.textContent) !== 'Next Steps') continue;
          let node = labelEl;
          for (let i = 0; i < 8; i++) {
            node = node.parentElement;
            if (!node) break;
            const field = node.querySelector('textarea, input[type="text"], input:not([type])');
            if (field) {
              const dataId = field.getAttribute('data-id');
              if (dataId) return `[data-id="${dataId}"]`;
              const ariaLabel = field.getAttribute('aria-label');
              if (ariaLabel) return `[aria-label="${ariaLabel}"]`;
            }
          }
        }
        return null;
      }).catch(() => null);
      if (labelSel) return casePage.locator(labelSel).first();
      return null;
    };

    // Check DOM before scrolling (field may already be rendered)
    const immediate = await findInDom();
    if (immediate) {
      await immediate.scrollIntoViewIfNeeded().catch(() => {});
      await delay(400);
      return immediate;
    }

    // Scroll window in 1000px steps — window.scrollBy triggers Dynamics lazy rendering
    for (let i = 0; i < 15; i++) {
      await casePage.evaluate(() => window.scrollBy(0, 1000));
      await delay(700);
      const found = await findInDom();
      if (found) {
        await found.scrollIntoViewIfNeeded().catch(() => {});
        await delay(400);
        return found;
      }
    }

    return null;
  }

  async diagnoseCasePage(casePage) {
    await casePage.evaluate(() => window.scrollBy(0, 800));
    await delay(500);

    return casePage.evaluate(() => {
      const normalize = (v) => (v || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => {
        const s = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };

      const fields = Array.from(document.querySelectorAll(
        'textarea, input[type="text"], input:not([type]), [contenteditable="true"]'
      )).filter(isVisible).map((el) => ({
        tag: el.tagName.toLowerCase(),
        dataId: el.getAttribute('data-id') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        name: el.getAttribute('name') || '',
        value: normalize(el.value || el.innerText || '').slice(0, 120)
      }));

      const labels = Array.from(document.querySelectorAll('label, [class*="label"]'))
        .filter(isVisible)
        .map((el) => normalize(el.textContent).slice(0, 60))
        .filter(Boolean);

      return { fields, labels: [...new Set(labels)] };
    });
  }

  async processCase(frame, caseRow) {
    console.log(`Processing ${caseRow.caseId}${caseRow.title ? ` - ${caseRow.title}` : ''}`);

    const casePage = await this.openCaseInNewTab(frame, caseRow);

    try {
      await this.clickCaseDescriptionTab(casePage);

      const field = await this.findNextStepsField(casePage);

      if (!field) {
        console.log(`  Next Steps field not found; treating as blank.`);
        this.results.blank.push({ caseId: caseRow.caseId, title: caseRow.title });
        return;
      }

      await field.scrollIntoViewIfNeeded();

      const currentValue = await field.inputValue().catch(async () =>
        field.evaluate((el) => el.innerText || el.textContent || '')
      );

      const update = updateDatePrefix(currentValue, this.todayLabel);

      if (update.status === 'blank') {
        console.log(`  Blank Next Steps; leaving unchanged.`);
        this.results.blank.push({ caseId: caseRow.caseId, title: caseRow.title });
        return;
      }

      if (update.status === 'unmatched') {
        console.log(`  Could not recognize leading date; leaving unchanged.`);
        this.results.skipped.push({
          caseId: caseRow.caseId, title: caseRow.title,
          reason: 'Date prefix did not match "Mon D:" format', currentValue
        });
        return;
      }

      if (currentValue === update.updatedText) {
        console.log(`  Already current (${this.todayLabel}).`);
        this.results.updated.push({
          caseId: caseRow.caseId, title: caseRow.title,
          before: currentValue, after: update.updatedText, changed: false
        });
        return;
      }

      console.log(`  Updating: "${currentValue.slice(0, 60)}" → "${update.updatedText.slice(0, 60)}"${this.dryRun ? ' (dry run)' : ''}`);

      if (!this.dryRun) {
        // Use click+selectAll+type so Dynamics registers the field as dirty
        await field.click();
        await casePage.keyboard.press('Control+A');
        await casePage.keyboard.type(update.updatedText);
        await delay(500);

        const saveButton = casePage.getByRole('button', { name: /^Save$/i }).first();
        const saveVisible = await saveButton.isVisible().catch(() => false);
        if (saveVisible) {
          await saveButton.click();
        } else {
          await casePage.keyboard.press('Control+S');
        }
        await delay(1500);
      }

      this.results.updated.push({
        caseId: caseRow.caseId, title: caseRow.title,
        before: currentValue, after: update.updatedText, changed: !this.dryRun
      });
    } finally {
      await casePage.close();
    }
  }

  async findCurrentGridFrame() {
    const pages = await this.getOpenPages();
    for (const page of pages) {
      for (const frame of page.frames()) {
        const rows = await this.collectCaseRows(frame);
        if (rows.length > 0) {
          this.setActivePage(page);
          return { frame, rows };
        }
      }
    }

    return { frame: null, rows: [] };
  }

  async goToNextPage(frame) {
    const candidates = [
      frame.locator('[aria-label="Next page"], [aria-label="Go to next page"], [title="Next page"]'),
      frame.getByRole('button', { name: /Next page|Go to next page/i })
    ];

    for (const candidate of candidates) {
      const button = await this.findVisibleLocator(candidate);
      if (!button) continue;

      const disabled = await button.isDisabled().catch(() => false);
      const ariaDisabled = await button.getAttribute('aria-disabled').catch(() => null);
      if (disabled || ariaDisabled === 'true') return false;

      await button.click();
      await delay(2000);
      return true;
    }

    return false;
  }

  async processCases() {
    const processed = new Set();
    let pageNumber = 1;

    while (pageNumber <= this.settings.maxPages) {
      const { frame, rows } = await this.findCurrentGridFrame();
      if (!frame || rows.length === 0) {
        throw new Error('No case rows were found in the current Dynamics view.');
      }

      console.log(`Found ${rows.length} visible case row(s) on page ${pageNumber}.`);

      for (const row of rows) {
        if (processed.has(row.caseId)) continue;

        try {
          await this.processCase(frame, row);
          processed.add(row.caseId);
        } catch (error) {
          console.error(`  Error on ${row.caseId}: ${error.message}`);
          this.results.errors.push({ caseId: row.caseId, title: row.title, message: error.message });
          // Each case opens in its own tab, so the list page is unaffected — no reload needed
        }
      }

      if (!this.settings.processAllPages) break;
      const moved = await this.goToNextPage(frame);
      if (!moved) break;

      pageNumber += 1;
      await this.waitForCaseGrid();
    }
  }

  async collectRibbonDiagnostics() {
    const pages = await this.getOpenPages();
    const diagnostics = [];

    for (const page of pages) {
      const pageInfo = {
        url: page.url(),
        title: await page.title().catch(() => ''),
        frames: []
      };

      for (const frame of page.frames()) {
        const frameInfo = await frame.evaluate(() => {
          const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              rect.width > 0 &&
              rect.height > 0;
          };
          const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
          const selector = [
            'button',
            '[role="button"]',
            '[role="menuitem"]',
            'a',
            '[aria-label]',
            '[title]',
            '[data-id]',
            '[data-lp-id]',
            'span'
          ].join(',');
          const interesting = /next|step|bulk|word|dashboard|create|share|update|edit|open|save|cancel/i;
          const elements = [];

          for (const element of Array.from(document.querySelectorAll(selector))) {
            if (!isVisible(element)) continue;

            const rect = element.getBoundingClientRect();
            const item = {
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute('role') || '',
              text: normalize(element.innerText || element.textContent),
              ariaLabel: element.getAttribute('aria-label') || '',
              title: element.getAttribute('title') || '',
              dataId: element.getAttribute('data-id') || '',
              dataLpId: element.getAttribute('data-lp-id') || '',
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            };
            const haystack = [
              item.text,
              item.ariaLabel,
              item.title,
              item.dataId,
              item.dataLpId
            ].join(' ');

            if (interesting.test(haystack)) elements.push(item);
          }

          return {
            url: window.location.href,
            bodyHasNextSteps: /Next Steps/i.test(document.body?.innerText || ''),
            selectedRows: document.querySelectorAll('[aria-selected="true"], [role="row"][aria-selected="true"]').length,
            checkedBoxes: document.querySelectorAll('[aria-checked="true"], input[type="checkbox"]:checked').length,
            elements: elements.slice(0, 200)
          };
        }).catch((error) => ({ error: error.message }));

        pageInfo.frames.push(frameInfo);
      }

      diagnostics.push(pageInfo);
    }

    return diagnostics;
  }

  async saveDiagnostics(diagnostics, screenshotPage) {
    const reportDirectory = resolvePathFromCwd(this.settings.reportDirectory);
    fs.mkdirSync(reportDirectory, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(reportDirectory, `dynamics-ribbon-diagnostics-${stamp}.json`);
    const screenshotPath = path.join(reportDirectory, `dynamics-ribbon-diagnostics-${stamp}.png`);

    fs.writeFileSync(jsonPath, JSON.stringify(diagnostics, null, 2));
    await screenshotPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

    console.log(`Ribbon diagnostics saved: ${jsonPath}`);
    console.log(`Ribbon screenshot saved: ${screenshotPath}`);
  }

  async collectEditorDiagnostics() {
    const pages = await this.getOpenPages();
    const results = [];

    for (const page of pages) {
      for (const frame of page.frames()) {
        const info = await frame.evaluate(() => {
          const normalize = (v) => (v || '').replace(/\s+/g, ' ').trim();
          const isVisible = (el) => {
            const s = window.getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
          };

          const editables = Array.from(document.querySelectorAll(
            'textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"], [role="dialog"], [aria-modal="true"]'
          )).filter(isVisible).map((el) => ({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            ariaModal: el.getAttribute('aria-modal') || '',
            dataId: el.getAttribute('data-id') || '',
            contenteditable: el.getAttribute('contenteditable') || '',
            value: normalize(el.value || el.innerText || el.textContent).slice(0, 200),
            rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()
          }));

          return {
            url: window.location.href,
            editables,
            bodyText: normalize(document.body?.innerText || '').slice(0, 500)
          };
        }).catch((err) => ({ error: err.message }));

        results.push({ frameUrl: frame.url(), ...info });
      }
    }

    return results;
  }

  async diagnoseCase() {
    try {
      await this.initialize();
      await this.openTargetView();

      const { frame, rows } = await this.findCurrentGridFrame();
      if (!frame || rows.length === 0) throw new Error('No case rows found.');

      console.log(`Opening case: ${rows[0].caseId}`);
      const casePage = await this.openCaseInNewTab(frame, rows[0]);

      await this.clickCaseDescriptionTab(casePage);

      const info = await this.diagnoseCasePage(casePage);

      console.log('\nVisible labels on Case Description tab:');
      for (const l of info.labels) console.log(`  "${l}"`);

      console.log('\nVisible editable fields:');
      for (const f of info.fields) {
        console.log(`  ${f.tag} data-id="${f.dataId}" aria-label="${f.ariaLabel}" name="${f.name}" value="${f.value}"`);
      }

      const reportDirectory = resolvePathFromCwd(this.settings.reportDirectory);
      fs.mkdirSync(reportDirectory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = `${reportDirectory}/dynamics-case-diagnostics-${stamp}.png`;
      await casePage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      console.log(`\nScreenshot: ${screenshotPath}`);

      await casePage.close();
    } finally {
      await this.cleanup();
    }
  }

  async diagnoseClick() {
    try {
      await this.initialize();
      await this.openTargetView();

      const { frame, rows } = await this.findCurrentGridFrame();
      if (!frame || rows.length === 0) throw new Error('No case rows found.');

      console.log(`Selecting first row: ${rows[0].caseId}`);
      await this.selectCase(frame, rows[0]);

      console.log('Clicking Next Steps ribbon button...');
      await this.clickNextSteps(frame);

      console.log('Waiting 4s for editor/dialog to appear...');
      await delay(4000);

      const editorInfo = await this.collectEditorDiagnostics();
      const reportDirectory = resolvePathFromCwd(this.settings.reportDirectory);
      fs.mkdirSync(reportDirectory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const jsonPath = path.join(reportDirectory, `dynamics-click-diagnostics-${stamp}.json`);
      const screenshotPath = path.join(reportDirectory, `dynamics-click-diagnostics-${stamp}.png`);
      fs.writeFileSync(jsonPath, JSON.stringify(editorInfo, null, 2));
      await frame.page().screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
      console.log(`Editor diagnostics: ${jsonPath}`);
      console.log(`Screenshot: ${screenshotPath}`);

      for (const f of editorInfo) {
        if (f.error) continue;
        console.log(`\n--- frame: ${f.frameUrl.slice(0, 80)}`);
        for (const el of f.editables) {
          console.log(`  ${el.tag}[role=${el.role}] aria="${el.ariaLabel}" data-id="${el.dataId}" ce="${el.contenteditable}" val="${el.value.slice(0, 80)}"`);
        }
      }
    } finally {
      await this.cleanup();
    }
  }

  async diagnoseRibbon() {
    try {
      await this.initialize();
      await this.openTargetView();

      const { frame, rows } = await this.findCurrentGridFrame();
      if (!frame || rows.length === 0) {
        throw new Error('No case rows were found for ribbon diagnostics.');
      }

      console.log(`Selecting first row for diagnostics: ${rows[0].caseId}`);
      await this.selectCase(frame, rows[0]);
      await delay(1500);

      const diagnostics = await this.collectRibbonDiagnostics();
      await this.saveDiagnostics(diagnostics, frame.page());

      for (const pageInfo of diagnostics) {
        for (const frameInfo of pageInfo.frames) {
          if (frameInfo.error) continue;
          console.log(`bodyHasNextSteps=${frameInfo.bodyHasNextSteps} selectedRows=${frameInfo.selectedRows} checkedBoxes=${frameInfo.checkedBoxes}`);
          for (const element of frameInfo.elements.slice(0, 25)) {
            console.log(`  ${element.tag}[role=${element.role}] text="${element.text}" aria="${element.ariaLabel}" title="${element.title}" data-id="${element.dataId}"`);
          }
        }
      }
    } finally {
      await this.cleanup();
    }
  }

  saveReport() {
    const reportDirectory = resolvePathFromCwd(this.settings.reportDirectory);
    fs.mkdirSync(reportDirectory, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDirectory, `dynamics-next-steps-${stamp}.json`);
    this.results.reportPath = reportPath;
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
    console.log(`Report saved: ${reportPath}`);
  }

  async cleanup() {
    if (this.context) {
      await this.context.close();
    }
  }

  async run() {
    try {
      await this.initialize();
      await this.openTargetView();
      await this.processCases();
    } finally {
      this.saveReport();
      await this.cleanup();
    }

    return this.results;
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const diagnoseRibbon = process.argv.includes('--diagnose-ribbon');
  const diagnoseClick = process.argv.includes('--diagnose-click');
  const diagnoseCase = process.argv.includes('--diagnose-case');
  const updater = new DynamicsNextStepsUpdater({ dryRun });

  const runPromise = diagnoseRibbon ? updater.diagnoseRibbon()
    : diagnoseClick ? updater.diagnoseClick()
    : diagnoseCase ? updater.diagnoseCase()
    : updater.run();

  runPromise
    .then((results) => {
      if (diagnoseRibbon || diagnoseClick || diagnoseCase) return;

      console.log('\nSummary');
      console.log(`  Updated: ${results.updated.length}`);
      console.log(`  Blank: ${results.blank.length}`);
      console.log(`  Skipped: ${results.skipped.length}`);
      console.log(`  Errors: ${results.errors.length}`);

      if (results.blank.length > 0) {
        console.log('\nBlank Next Steps:');
        for (const item of results.blank) {
          console.log(`  - ${item.caseId}${item.title ? `: ${item.title}` : ''}`);
        }
      }

      process.exit(results.errors.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Dynamics next-steps updater failed:', error.message);
      process.exit(1);
    });
}

module.exports = {
  DynamicsNextStepsUpdater,
  formatTodayLabel,
  updateDatePrefix
};
