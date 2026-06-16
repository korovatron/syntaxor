import { EXAMPLES, parseGrammar, renderDiagramSvg, testString } from "./syntaxor-core.js";

const STORAGE_KEY = "syntaxor.workspace.v1";
const DEFAULT_EXAMPLE_KEY = "arithmetic";

const els = {
  exampleSelect: document.getElementById("exampleSelect"),
  startSymbolSelect: document.getElementById("startSymbolSelect"),
  diagramRuleSelect: document.getElementById("diagramRuleSelect"),
  resetGrammarBtn: document.getElementById("resetGrammarBtn"),
  grammarInput: document.getElementById("grammarInput"),
  grammarHighlight: document.getElementById("grammarHighlight"),
  testInput: document.getElementById("testInput"),
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
  parseError: null
};

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
      return;
    }

    const stored = JSON.parse(raw);
    if (stored.selectedExample && EXAMPLES[stored.selectedExample]) {
      state.selectedExample = stored.selectedExample;
    }
    if (typeof stored.grammarText === "string" && stored.grammarText.trim()) {
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
  } catch (_error) {
    localStorage.removeItem(STORAGE_KEY);
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
    els.warningsValue.textContent = "No warnings.";
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

  const inputValue = els.testInput.value;

  if (!inputValue) {
    return;
  }

  if (!state.parsed) {
    els.testInput.classList.add("test-fail");
    return;
  }

  const grammarForTest = state.selectedStartSymbol && state.selectedStartSymbol !== state.parsed.startSymbol
    ? { ...state.parsed, startSymbol: state.selectedStartSymbol }
    : state.parsed;

  const result = testString(grammarForTest, inputValue);
  els.testInput.classList.add(result.accepted ? "test-pass" : "test-fail");
  saveWorkspace();
}

function populateExamples() {
  const options = Object.entries(EXAMPLES)
    .map(([key, example]) => `<option value="${key}">${escapeHtml(example.title)}</option>`)
    .join("");
  els.exampleSelect.innerHTML = options;
  els.exampleSelect.value = state.selectedExample;
}

function attachEvents() {
  let parseTimer = null;

  els.grammarInput.addEventListener("input", () => {
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

  els.exampleSelect.addEventListener("change", () => {
    applyExample(els.exampleSelect.value);
  });

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

  els.resetGrammarBtn.addEventListener("click", () => {
    applyExample(DEFAULT_EXAMPLE_KEY);
    els.exampleSelect.value = DEFAULT_EXAMPLE_KEY;
  });
}

function init() {
  populateExamples();
  loadWorkspace();
  populateExamples();
  els.grammarInput.value = state.grammarText;
  els.exampleSelect.value = state.selectedExample;
  renderGrammarHighlight();
  syncGrammarHighlightScroll();
  parseAndRender();
  attachEvents();
}

init();
