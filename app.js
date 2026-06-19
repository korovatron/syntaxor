import { EXAMPLES, buildParseTree, parseGrammar, renderDiagramSvg, testString } from "./syntaxor-core.js";

const APP_VERSION = "0.1.7";
const STORAGE_KEY = "syntaxor.workspace.v1";
const ABOUT_SHOW_ON_START_KEY = "syntaxor.about.showOnStart";
const DEFAULT_EXAMPLE_KEY = "arithmetic";
const DEFAULT_FIRST_RUN_TEST_INPUT = "1+2*3";
const IS_IOS_BROWSER = (() => {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
})();

window.__SYNTAXOR_VERSION__ = APP_VERSION;

const els = {
  btnHamburger: document.getElementById("btnHamburger"),
  btnMenuClose: document.getElementById("btnMenuClose"),
  appMenu: document.getElementById("appMenu"),
  menuExamplesToggle: document.getElementById("menuExamplesToggle"),
  menuExamplesList: document.getElementById("menuExamplesList"),
  menuHelp: document.getElementById("menuHelp"),
  menuAbout: document.getElementById("menuAbout"),
  btnFooterHelp: document.getElementById("btnFooterHelp"),
  startSymbolSelect: document.getElementById("startSymbolSelect"),
  diagramRuleSelect: document.getElementById("diagramRuleSelect"),
  resetGrammarBtn: document.getElementById("resetGrammarBtn"),
  grammarInput: document.getElementById("grammarInput"),
  grammarHighlight: document.getElementById("grammarHighlight"),
  testInput: document.getElementById("testInput"),
  parseTreeBtn: document.getElementById("parseTreeBtn"),
  parseTreeModal: document.getElementById("parseTreeModal"),
  parseTreeCloseBtn: document.getElementById("parseTreeCloseBtn"),
  helpModal: document.getElementById("helpModal"),
  aboutModal: document.getElementById("aboutModal"),
  btnHelpCloseX: document.getElementById("btnHelpCloseX"),
  btnAboutCloseX: document.getElementById("btnAboutCloseX"),
  aboutVersion: document.getElementById("aboutVersion"),
  aboutShowOnStartup: document.getElementById("aboutShowOnStartup"),
  parseTreeTitle: document.getElementById("parseTreeTitle"),
  parseTreeStatus: document.getElementById("parseTreeStatus"),
  parseTreeSvg: document.getElementById("parseTreeSvg"),
  warningsValue: document.getElementById("warningsValue"),
  diagramRuleTitle: document.getElementById("diagramRuleTitle"),
  diagram: document.getElementById("diagram"),
  diagramEmptyState: document.getElementById("diagramEmptyState")
};

const state = {
  selectedExample: DEFAULT_EXAMPLE_KEY,
  grammarText: EXAMPLES[DEFAULT_EXAMPLE_KEY].grammar,
  selectedStartSymbol: null,
  diagramRule: null,
  parsed: null,
  parseError: null,
  modalOpenedAt: 0,
  parseTreeModalOverlay: null,
  aboutModalOverlay: null,
  helpModalOverlay: null
};

function setParseTreeEnabled(enabled) {
  els.parseTreeBtn.disabled = !enabled;
}

function getShowAboutOnStartupPreference() {
  try {
    const raw = localStorage.getItem(ABOUT_SHOW_ON_START_KEY);
    if (raw === null) {
      return true;
    }
    return raw === "1";
  } catch (_error) {
    return true;
  }
}

function setShowAboutOnStartupPreference(enabled) {
  try {
    localStorage.setItem(ABOUT_SHOW_ON_START_KEY, enabled ? "1" : "0");
  } catch (_error) {
    // Ignore storage write failures.
  }
}

function saveWorkspace() {
  const payload = {
    selectedExample: state.selectedExample,
    grammarText: els.grammarInput.value,
    selectedStartSymbol: state.selectedStartSymbol,
    diagramRule: state.diagramRule,
    testInput: els.testInput.value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return false;
    }

    const stored = JSON.parse(raw);
    if (stored.selectedExample && EXAMPLES[stored.selectedExample]) {
      state.selectedExample = stored.selectedExample;
    }
    if (typeof stored.grammarText === "string") {
      state.grammarText = stored.grammarText;
    }
    if (typeof stored.selectedStartSymbol === "string" && stored.selectedStartSymbol.trim()) {
      state.selectedStartSymbol = stored.selectedStartSymbol;
    }
    if (typeof stored.diagramRule === "string" && stored.diagramRule.trim()) {
      state.diagramRule = stored.diagramRule;
    }
    if (typeof stored.testInput === "string") {
      els.testInput.value = stored.testInput;
    }

    return true;
  } catch (_error) {
    localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}

function escapeHtml(value) {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHighlightHtml(value) {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXml(value) {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function highlightGrammarLine(line) {
  const placeholders = [];
  const reserve = (token, className) => {
    const marker = `\u0000${placeholders.length}\u0000`;
    placeholders.push(`<span class="${className}">${token}</span>`);
    return marker;
  };

  let highlighted = escapeHighlightHtml(line);
  highlighted = highlighted.replace(/(\/\/.*|#.*)$/g, (token) => reserve(token, "hl-comment"));
  highlighted = highlighted.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (token) => reserve(token, "hl-terminal"));
  highlighted = highlighted.replace(/&lt;[^&\n]+?&gt;/g, (token) => reserve(token, "hl-nonterminal"));
  highlighted = highlighted.replace(/::=/g, (token) => reserve(token, "hl-operator"));
  highlighted = highlighted.replace(/\|/g, (token) => reserve(token, "hl-alternative"));
  highlighted = highlighted.replace(/\b(?:epsilon)\b|ε/gi, (token) => reserve(token, "hl-epsilon"));

  return highlighted.replace(/\u0000(\d+)\u0000/g, (_match, index) => placeholders[Number(index)]);
}

function renderGrammarHighlight() {
  const source = els.grammarInput.value || "";
  const lines = source.split("\n");
  const highlighted = lines.map((line) => highlightGrammarLine(line)).join("\n");
  els.grammarHighlight.innerHTML = highlighted || " ";
}

function syncGrammarHighlightScroll() {
  els.grammarHighlight.scrollTop = els.grammarInput.scrollTop;
  els.grammarHighlight.scrollLeft = els.grammarInput.scrollLeft;
}

function renderWarnings(messages) {
  if (!messages.length) {
    els.warningsValue.innerHTML = '<span class="message-pill message-pill-ok">No warnings.</span>';
    return;
  }

  els.warningsValue.innerHTML = messages
    .map((message) => `<span class="message-pill">${escapeHtml(message)}</span>`)
    .join("");
}

function setStartSymbolOptions(grammar) {
  if (!grammar) {
    els.startSymbolSelect.innerHTML = '<option value="">-</option>';
    els.startSymbolSelect.value = "";
    els.startSymbolSelect.disabled = true;
    return;
  }

  const options = grammar.ruleOrder
    .map((ruleName) => `<option value="${escapeHtml(ruleName)}">&lt;${escapeHtml(ruleName)}&gt;</option>`)
    .join("");

  const preferred = grammar.ruleOrder.includes(state.selectedStartSymbol)
    ? state.selectedStartSymbol
    : grammar.startSymbol;

  state.selectedStartSymbol = preferred;
  els.startSymbolSelect.innerHTML = options;
  els.startSymbolSelect.value = preferred;
  els.startSymbolSelect.disabled = false;
}

function setDiagramRuleOptions(grammar) {
  if (!grammar) {
    els.diagramRuleSelect.innerHTML = '<option value="">-</option>';
    els.diagramRuleSelect.value = "";
    els.diagramRuleSelect.disabled = true;
    state.diagramRule = null;
    return;
  }

  const options = grammar.ruleOrder
    .map((ruleName) => `<option value="${escapeHtml(ruleName)}">&lt;${escapeHtml(ruleName)}&gt;</option>`)
    .join("");

  const preferred = grammar.ruleOrder.includes(state.diagramRule)
    ? state.diagramRule
    : grammar.startSymbol;

  state.diagramRule = preferred;
  els.diagramRuleSelect.innerHTML = options;
  els.diagramRuleSelect.value = preferred;
  els.diagramRuleSelect.disabled = false;
}

function renderDiagram() {
  if (!state.parsed) {
    els.diagram.setAttribute("viewBox", "0 0 960 420");
    els.diagram.innerHTML = "";
    els.diagramRuleTitle.textContent = "";
    els.diagramRuleTitle.hidden = true;
    els.diagramEmptyState.hidden = false;
    return;
  }

  const diagram = renderDiagramSvg(state.parsed, state.diagramRule);
  const displayedRule = state.diagramRule || state.parsed.startSymbol;
  els.diagram.setAttribute("viewBox", `0 0 ${diagram.width} ${diagram.height}`);
  els.diagram.innerHTML = diagram.markup;
  els.diagramRuleTitle.textContent = `<${displayedRule}>`;
  els.diagramRuleTitle.hidden = false;
  els.diagramEmptyState.hidden = true;
}

function getGrammarForCurrentStart() {
  if (!state.parsed) {
    return null;
  }

  if (state.selectedStartSymbol && state.selectedStartSymbol !== state.parsed.startSymbol) {
    return { ...state.parsed, startSymbol: state.selectedStartSymbol };
  }

  return state.parsed;
}

const PARSE_TREE_LAYOUT = {
  nodeHeight: 40,
  padding: 52,
  verticalGap: 80,
  horizontalGap: 26,
  minWidth: 860,
  minHeight: 260
};

function measureParseTree(node) {
  const labelWidth = Math.max(90, Math.min(240, `${node.label}`.length * 8 + 28));
  const childMeasures = (node.children || []).map((child) => measureParseTree(child));
  const childrenWidth = childMeasures.length === 0
    ? 0
    : childMeasures.reduce((total, child) => total + child.width, 0) + PARSE_TREE_LAYOUT.horizontalGap * (childMeasures.length - 1);

  return {
    labelWidth,
    width: Math.max(labelWidth, childrenWidth),
    childMeasures
  };
}

function collectParseTreeLayout(node, measure, left, depth, nodes, edges) {
  const x = left + measure.width / 2;
  const y = PARSE_TREE_LAYOUT.padding + depth * PARSE_TREE_LAYOUT.verticalGap;
  nodes.push({ node, x, y, labelWidth: measure.labelWidth, depth });

  if (!node.children || node.children.length === 0) {
    return;
  }

  const childrenWidth = measure.childMeasures.reduce((total, child) => total + child.width, 0)
    + PARSE_TREE_LAYOUT.horizontalGap * (measure.childMeasures.length - 1);
  let childLeft = left + (measure.width - childrenWidth) / 2;

  node.children.forEach((child, index) => {
    const childMeasure = measure.childMeasures[index];
    const childX = childLeft + childMeasure.width / 2;
    const childY = PARSE_TREE_LAYOUT.padding + (depth + 1) * PARSE_TREE_LAYOUT.verticalGap;
    edges.push({
      x1: x,
      y1: y + PARSE_TREE_LAYOUT.nodeHeight / 2,
      x2: childX,
      y2: childY - PARSE_TREE_LAYOUT.nodeHeight / 2
    });
    collectParseTreeLayout(child, childMeasure, childLeft, depth + 1, nodes, edges);
    childLeft += childMeasure.width + PARSE_TREE_LAYOUT.horizontalGap;
  });
}

function renderParseTreeSvg(tree, targetAspectRatio = null) {
  const measure = measureParseTree(tree);
  const nodes = [];
  const edges = [];
  collectParseTreeLayout(tree, measure, PARSE_TREE_LAYOUT.padding, 0, nodes, edges);

  const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0);
  const width = Math.max(Math.ceil(measure.width + PARSE_TREE_LAYOUT.padding * 2), PARSE_TREE_LAYOUT.minWidth);
  const baseHeight = Math.max(
    Math.ceil(PARSE_TREE_LAYOUT.padding * 2 + maxDepth * PARSE_TREE_LAYOUT.verticalGap + PARSE_TREE_LAYOUT.nodeHeight),
    PARSE_TREE_LAYOUT.minHeight
  );
  const desiredHeightForFrame = targetAspectRatio && Number.isFinite(targetAspectRatio) && targetAspectRatio > 0
    ? Math.ceil(width / targetAspectRatio)
    : 0;
  const height = Math.max(baseHeight, desiredHeightForFrame);

  const edgeMarkup = edges.map((edge) => {
    return `<line class="parse-tree-edge" x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" />`;
  }).join("");

  const nodeMarkup = nodes.map(({ node, x, y, labelWidth, depth }) => {
    const rectX = x - labelWidth / 2;
    const rectY = y - PARSE_TREE_LAYOUT.nodeHeight / 2;
    const classes = ["parse-tree-node", `parse-tree-${node.type}`];
    if (depth === 0) {
      classes.push("parse-tree-root");
    }

    return `<g class="${classes.join(" ")}"><rect x="${rectX}" y="${rectY}" width="${labelWidth}" height="${PARSE_TREE_LAYOUT.nodeHeight}" rx="12" ry="12" /><text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${escapeXml(node.label)}</text></g>`;
  }).join("");

  return {
    width,
    height,
    markup: `${edgeMarkup}${nodeMarkup}`
  };
}

function renderParseTreeModal() {
  const grammarForTree = getGrammarForCurrentStart();
  const expression = `${els.testInput.value ?? ""}`;
  const expressionDisplay = `"${expression}"`;
  const parseTreeFrame = els.parseTreeSvg.parentElement;
  const frameAspectRatio = parseTreeFrame && parseTreeFrame.clientWidth > 0 && parseTreeFrame.clientHeight > 0
    ? parseTreeFrame.clientWidth / parseTreeFrame.clientHeight
    : null;

  if (!grammarForTree) {
    els.parseTreeTitle.textContent = "Parse Tree";
    els.parseTreeStatus.textContent = "Enter a valid grammar first.";
    els.parseTreeSvg.innerHTML = "";
    els.parseTreeSvg.setAttribute("viewBox", "0 0 960 260");
    return;
  }

  const result = buildParseTree(grammarForTree, els.testInput.value, grammarForTree.startSymbol);
  els.parseTreeTitle.textContent = `Parse Tree for <${result.rootSymbol}>`;

  if (!result.accepted || !result.tree) {
    els.parseTreeStatus.textContent = `Expression: ${expressionDisplay}`;
    els.parseTreeSvg.innerHTML = "";
    els.parseTreeSvg.setAttribute("viewBox", "0 0 960 260");
    return;
  }

  const treeSvg = renderParseTreeSvg(result.tree, frameAspectRatio);
  els.parseTreeStatus.textContent = `Expression: ${expressionDisplay}`;
  els.parseTreeSvg.setAttribute("viewBox", `0 0 ${treeSvg.width} ${treeSvg.height}`);
  els.parseTreeSvg.innerHTML = treeSvg.markup;
}

function openParseTreeModal() {
  if (state.parseTreeModalOverlay) {
    return;
  }
  state.modalOpenedAt = performance.now();
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.78);z-index:9999;display:grid;place-items:center;padding:30px;box-sizing:border-box;";
  const content = els.parseTreeModal.firstElementChild;
  if (content) {
    overlay.appendChild(content);
  }
  overlay.addEventListener("click", (event) => {
    if (performance.now() - state.modalOpenedAt < 350) {
      return;
    }
    if (event.target === overlay) {
      closeParseTreeModal();
    }
  });
  document.body.appendChild(overlay);
  state.parseTreeModalOverlay = overlay;
  document.body.style.overflow = "hidden";
  window.requestAnimationFrame(() => {
    renderParseTreeModal();
    els.parseTreeCloseBtn.focus();
  });
}

function closeParseTreeModal() {
  if (!state.parseTreeModalOverlay) {
    return;
  }
  const content = state.parseTreeModalOverlay.firstElementChild;
  if (content) {
    els.parseTreeModal.appendChild(content);
  }
  state.parseTreeModalOverlay.remove();
  state.parseTreeModalOverlay = null;
  document.body.style.overflow = "";
  els.parseTreeBtn.focus();
}

function openAboutModal(options = {}) {
  if (state.aboutModalOverlay) {
    return;
  }
  const { focusClose = true } = options;
  state.modalOpenedAt = performance.now();
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;";
  const content = els.aboutModal.firstElementChild;
  if (content) {
    overlay.appendChild(content);
  }
  overlay.addEventListener("click", (event) => {
    if (performance.now() - state.modalOpenedAt < 350) {
      return;
    }
    if (event.target === overlay) {
      closeAboutModal();
    }
  });
  document.body.appendChild(overlay);
  state.aboutModalOverlay = overlay;
  document.body.style.overflow = "hidden";
  toggleMenu(false);
  if (focusClose) {
    window.requestAnimationFrame(() => {
      els.btnAboutCloseX.focus();
    });
  }
}
function closeAboutModal() {
  if (!state.aboutModalOverlay) {
    return;
  }
  const content = state.aboutModalOverlay.firstElementChild;
  if (content) {
    els.aboutModal.appendChild(content);
  }
  state.aboutModalOverlay.remove();
  state.aboutModalOverlay = null;
  document.body.style.overflow = "";
}

function openHelpModal() {
  if (state.helpModalOverlay) {
    return;
  }
  state.modalOpenedAt = performance.now();
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;";
  const content = els.helpModal.firstElementChild;
  if (content) {
    overlay.appendChild(content);
  }
  overlay.addEventListener("click", (event) => {
    if (performance.now() - state.modalOpenedAt < 350) {
      return;
    }
    if (event.target === overlay) {
      closeHelpModal();
    }
  });
  document.body.appendChild(overlay);
  state.helpModalOverlay = overlay;
  document.body.style.overflow = "hidden";
  toggleMenu(false);
  window.requestAnimationFrame(() => {
    els.btnHelpCloseX.focus();
  });
}

function closeHelpModal() {
  if (!state.helpModalOverlay) {
    return;
  }
  const content = state.helpModalOverlay.firstElementChild;
  if (content) {
    els.helpModal.appendChild(content);
  }
  state.helpModalOverlay.remove();
  state.helpModalOverlay = null;
  document.body.style.overflow = "";
}

function applyExample(exampleKey) {
  const example = EXAMPLES[exampleKey];
  if (!example) {
    return;
  }

  state.selectedExample = exampleKey;
  state.selectedStartSymbol = null;
  state.diagramRule = null;
  els.grammarInput.value = example.grammar;
  parseAndRender();
}

function clearWorkspace() {
  state.selectedStartSymbol = null;
  state.diagramRule = null;
  state.parsed = null;
  state.parseError = null;

  els.grammarInput.value = "";
  els.testInput.value = "";
  els.testInput.classList.remove("test-pass", "test-fail");
  setParseTreeEnabled(false);

  renderGrammarHighlight();
  setStartSymbolOptions(null);
  setDiagramRuleOptions(null);
  renderWarnings([]);
  renderDiagram();

  saveWorkspace();
}

function toggleMenu(open) {
  const isOpen = open !== undefined ? open : !els.appMenu.classList.contains("is-open");
  els.appMenu.classList.toggle("is-open", isOpen);
  els.btnHamburger.setAttribute("aria-expanded", String(isOpen));
  els.btnHamburger.classList.toggle("is-open", isOpen);
}

function parseAndRender() {
  const grammarText = els.grammarInput.value;
  state.grammarText = grammarText;
  renderGrammarHighlight();

  try {
    state.parsed = parseGrammar(grammarText);
    state.parseError = null;
    setStartSymbolOptions(state.parsed);
    setDiagramRuleOptions(state.parsed);
    renderWarnings(state.parsed.warnings);
    renderDiagram();
    saveWorkspace();
  } catch (error) {
    state.parsed = null;
    state.parseError = error;
    state.selectedStartSymbol = null;
    state.diagramRule = null;
    setStartSymbolOptions(null);
    setDiagramRuleOptions(null);
    renderWarnings([error.message]);
    renderDiagram();
    saveWorkspace();
  }

  testCurrentString();
}

function testCurrentString() {
  els.testInput.classList.remove("test-pass", "test-fail");
  setParseTreeEnabled(false);

  const inputValue = els.testInput.value;

  if (!inputValue) {
    return;
  }

  if (!state.parsed) {
    els.testInput.classList.add("test-fail");
    return;
  }

  const grammarForTest = getGrammarForCurrentStart();

  const result = testString(grammarForTest, inputValue);
  els.testInput.classList.add(result.accepted ? "test-pass" : "test-fail");
  setParseTreeEnabled(result.accepted);
  saveWorkspace();
}

function populateExamples() {
  const options = Object.entries(EXAMPLES)
    .map(([key, example]) => `<li><button class="menu-preset-btn" data-example-key="${escapeHtml(key)}" type="button">${escapeHtml(example.title)}</button></li>`)
    .join("");
  els.menuExamplesList.innerHTML = options;
}

function attachEvents() {
  let parseTimer = null;

  els.grammarInput.addEventListener("input", () => {
    // Auto-replace "" with ε
    const cursorPos = els.grammarInput.selectionStart;
    const text = els.grammarInput.value;
    const hasEmptyString = text.includes("\"\"");
    
    if (hasEmptyString) {
      const newText = text.replace(/""/g, "ε");
      const beforeCursor = text.substring(0, cursorPos);
      const emptyStringsBeforeCursor = (beforeCursor.match(/""/g) || []).length;
      const newCursorPos = cursorPos + emptyStringsBeforeCursor;
      
      els.grammarInput.value = newText;
      els.grammarInput.selectionStart = newCursorPos;
      els.grammarInput.selectionEnd = newCursorPos;
    }
    
    renderGrammarHighlight();
    syncGrammarHighlightScroll();
    window.clearTimeout(parseTimer);
    parseTimer = window.setTimeout(() => {
      parseAndRender();
    }, 180);
  });

  els.grammarInput.addEventListener("scroll", syncGrammarHighlightScroll);

  let testTimer = null;
  els.testInput.addEventListener("input", () => {
    window.clearTimeout(testTimer);
    testTimer = window.setTimeout(() => {
      testCurrentString();
    }, 120);
  });

  els.menuExamplesToggle.addEventListener("click", () => {
    const expanded = els.menuExamplesToggle.getAttribute("aria-expanded") === "true";
    els.menuExamplesToggle.setAttribute("aria-expanded", String(!expanded));
    els.menuExamplesList.hidden = expanded;
    els.menuExamplesToggle.querySelector(".concertina-arrow").textContent = expanded ? "▸" : "▾";
  });

  els.menuExamplesList.addEventListener("click", (event) => {
    const target = event.target.closest(".menu-preset-btn");
    if (!target) {
      return;
    }

    applyExample(target.dataset.exampleKey);
    toggleMenu(false);
  });

  els.btnHamburger.addEventListener("click", () => toggleMenu());
  els.btnMenuClose.addEventListener("click", () => toggleMenu(false));
  els.menuHelp.addEventListener("click", openHelpModal);
  els.menuAbout.addEventListener("click", openAboutModal);
  els.btnFooterHelp.addEventListener("click", openHelpModal);

  els.startSymbolSelect.addEventListener("change", () => {
    state.selectedStartSymbol = els.startSymbolSelect.value || null;
    saveWorkspace();
    testCurrentString();
  });

  els.diagramRuleSelect.addEventListener("change", () => {
    state.diagramRule = els.diagramRuleSelect.value || null;
    saveWorkspace();
    renderDiagram();
  });

  els.parseTreeBtn.addEventListener("click", openParseTreeModal);
  els.parseTreeCloseBtn.addEventListener("click", closeParseTreeModal);
  els.btnHelpCloseX.addEventListener("click", closeHelpModal);
  els.btnAboutCloseX.addEventListener("click", closeAboutModal);
  els.aboutShowOnStartup.addEventListener("change", () => {
    setShowAboutOnStartupPreference(els.aboutShowOnStartup.checked);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.appMenu.classList.contains("is-open")) {
      toggleMenu(false);
      return;
    }

    if (event.key === "Escape" && state.helpModalOverlay) {
      closeHelpModal();
      return;
    }

    if (event.key === "Escape" && state.aboutModalOverlay) {
      closeAboutModal();
      return;
    }

    if (event.key === "Escape" && state.parseTreeModalOverlay) {
      closeParseTreeModal();
    }
  });

  document.addEventListener("click", (event) => {
    if (els.appMenu.classList.contains("is-open") && !els.appMenu.contains(event.target) && !els.btnHamburger.contains(event.target)) {
      toggleMenu(false);
    }
  });

  els.resetGrammarBtn.addEventListener("click", () => {
    clearWorkspace();
  });
}

function initZoomLock() {
  if (!IS_IOS_BROWSER) {
    return;
  }

  ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      event.preventDefault();
    }, { passive: false });
  });

  document.addEventListener("touchmove", (event) => {
    if (typeof event.scale === "number" && event.scale !== 1) {
      event.preventDefault();
    }
  }, { passive: false });

  let lastTouchEndAt = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEndAt <= 300) {
      event.preventDefault();
    }
    lastTouchEndAt = now;
  }, { passive: false });
}

function init() {
  initZoomLock();
  const showAboutOnStartup = getShowAboutOnStartupPreference();
  els.aboutShowOnStartup.checked = showAboutOnStartup;
  if (els.aboutVersion) {
    els.aboutVersion.textContent = APP_VERSION;
  }

  populateExamples();
  const restoredFromStorage = loadWorkspace();
  if (!restoredFromStorage) {
    state.selectedExample = DEFAULT_EXAMPLE_KEY;
    state.grammarText = EXAMPLES[DEFAULT_EXAMPLE_KEY].grammar;
    state.selectedStartSymbol = "expression";
    state.diagramRule = "number-tail";
    els.testInput.value = DEFAULT_FIRST_RUN_TEST_INPUT;
  }
  populateExamples();
  els.grammarInput.value = state.grammarText;
  renderGrammarHighlight();
  syncGrammarHighlightScroll();
  parseAndRender();
  attachEvents();

  if (showAboutOnStartup) {
    openAboutModal({ focusClose: false });
  }
}

init();
