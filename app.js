import { EXAMPLES, buildParseTree, parseGrammar, renderDiagramSvg, testString } from "./syntaxor-core.js";
import {
  EditorState,
  EditorSelection,
  EditorView,
  Decoration,
  ViewPlugin,
  MatchDecorator,
  keymap,
  defaultKeymap,
  history,
  historyKeymap
} from "./vendor/codemirror.js";

const APP_VERSION = "1.0.9";
const STORAGE_KEY = "syntaxor.workspace.v1";
const ABOUT_SHOW_ON_START_KEY = "syntaxor.about.showOnStart";
const DEFAULT_EXAMPLE_KEY = "arithmetic";
const DEFAULT_FIRST_RUN_TEST_INPUT = "8*4+21";
const TASKS_SOURCE_URL = "./tasks.txt";
const GRAMMAR_SNIPPETS = {
  digit: buildCharacterRule("digit", "0", "9"),
  lower: buildCharacterRule("lower", "a", "z"),
  upper: buildCharacterRule("upper", "A", "Z")
};
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
  menuOpenFile: document.getElementById("menuOpenFile"),
  menuSaveFile: document.getElementById("menuSaveFile"),
  menuExamplesToggle: document.getElementById("menuExamplesToggle"),
  menuExamplesList: document.getElementById("menuExamplesList"),
  menuTasks: document.getElementById("menuTasks"),
  menuHelp: document.getElementById("menuHelp"),
  menuAbout: document.getElementById("menuAbout"),
  btnFooterHelp: document.getElementById("btnFooterHelp"),
  startSymbolSelect: document.getElementById("startSymbolSelect"),
  diagramRuleSelect: document.getElementById("diagramRuleSelect"),
  resetGrammarBtn: document.getElementById("resetGrammarBtn"),
  grammarEditor: document.getElementById("grammarEditor"),
  grammarSnippetMenu: document.getElementById("grammarSnippetMenu"),
  testInput: document.getElementById("testInput"),
  parseTreeBtn: document.getElementById("parseTreeBtn"),
  parseTreeModal: document.getElementById("parseTreeModal"),
  parseTreeCloseBtn: document.getElementById("parseTreeCloseBtn"),
  tasksModal: document.getElementById("tasksModal"),
  tasksModalList: document.getElementById("tasksModalList"),
  tasksModalStatus: document.getElementById("tasksModalStatus"),
  tasksModalPosition: document.getElementById("tasksModalPosition"),
  btnTasksModalPrev: document.getElementById("btnTasksModalPrev"),
  btnTasksModalNext: document.getElementById("btnTasksModalNext"),
  btnTasksModalCloseX: document.getElementById("btnTasksModalCloseX"),
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
  diagramEmptyState: document.getElementById("diagramEmptyState"),
  fileOpenInput: document.getElementById("fileOpenInput")
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
  tasksModalOverlay: null,
  tasksCatalog: [],
  tasksCatalogLoaded: false,
  tasksCatalogLoading: false,
  tasksCatalogError: "",
  currentTaskIndex: 0,
  aboutModalOverlay: null,
  helpModalOverlay: null,
  grammarSnippetMenuOpen: false
};

let grammarEditorView = null;
let grammarEditorProgrammaticUpdate = false;
let grammarParseTimer = null;

function getGrammarText() {
  return grammarEditorView ? grammarEditorView.state.doc.toString() : "";
}

function setGrammarText(text, selectionAnchor) {
  if (!grammarEditorView) {
    return;
  }

  const nextText = `${text ?? ""}`;
  const currentText = grammarEditorView.state.doc.toString();
  const currentHead = grammarEditorView.state.selection.main.head;
  const anchor = Number.isInteger(selectionAnchor)
    ? Math.max(0, Math.min(nextText.length, selectionAnchor))
    : Math.max(0, Math.min(nextText.length, currentHead));

  grammarEditorProgrammaticUpdate = true;
  grammarEditorView.dispatch({
    changes: { from: 0, to: currentText.length, insert: nextText },
    selection: { anchor }
  });
  grammarEditorProgrammaticUpdate = false;
}

function focusGrammarEditor() {
  grammarEditorView?.focus();
}

function scheduleGrammarParse() {
  window.clearTimeout(grammarParseTimer);
  grammarParseTimer = window.setTimeout(() => {
    parseAndRender();
  }, 180);
}

const grammarTokenMatcher = new MatchDecorator({
  regexp: /\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^<>\n]+?>|::=|\||\b(?:epsilon)\b|ε/gi,
  decoration: (match) => {
    const token = match[0];
    let className = "";

    if (token.startsWith("//") || token.startsWith("#")) {
      className = "cm-hl-comment";
    } else if (token.startsWith("<")) {
      className = "cm-hl-nonterminal";
    } else if (token === "::=") {
      className = "cm-hl-operator";
    } else if (token === "|") {
      className = "cm-hl-alternative";
    } else if (/^(?:epsilon|ε)$/i.test(token)) {
      className = "cm-hl-epsilon";
    } else {
      className = "cm-hl-terminal";
    }

    return Decoration.mark({ class: className });
  }
});

const grammarHighlightPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = grammarTokenMatcher.createDeco(view);
  }

  update(update) {
    this.decorations = grammarTokenMatcher.updateDeco(update, this.decorations);
  }
}, {
  decorations: (instance) => instance.decorations
});

const grammarEditorTheme = EditorView.theme({
  ".cm-content .cm-hl-comment": { color: "#8ea0b0" },
  ".cm-content .cm-hl-nonterminal": { color: "#4fb584", fontWeight: "600" },
  ".cm-content .cm-hl-terminal": { color: "#d967be" },
  ".cm-content .cm-hl-operator": { color: "#d4985c", fontWeight: "600" },
  ".cm-content .cm-hl-alternative": { color: "#d4985c", fontWeight: "600" },
  ".cm-content .cm-hl-epsilon": { color: "#b8a0e8" }
});

function insertTabAtCaret(view) {
  const changes = [];
  const ranges = [];

  for (const range of view.state.selection.ranges) {
    changes.push({ from: range.from, to: range.to, insert: "\t" });
    const caret = range.from + 1;
    ranges.push(EditorSelection.cursor(caret));
  }

  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges),
    userEvent: "input"
  });

  return true;
}

function insertNewlineAtCaret(view) {
  const changes = [];
  const ranges = [];

  for (const range of view.state.selection.ranges) {
    changes.push({ from: range.from, to: range.to, insert: "\n" });
    const caret = range.from + 1;
    ranges.push(EditorSelection.cursor(caret));
  }

  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges),
    userEvent: "input"
  });

  return true;
}

function normaliseEmptyStringMarkers() {
  if (!grammarEditorView) {
    return;
  }

  const text = getGrammarText();
  if (!text.includes('""')) {
    return;
  }

  const head = grammarEditorView.state.selection.main.head;
  const beforeHead = text.slice(0, head);
  const replacementsBeforeHead = (beforeHead.match(/""/g) || []).length;
  const nextText = text.replace(/""/g, "ε");
  const nextHead = Math.max(0, head - replacementsBeforeHead);
  setGrammarText(nextText, nextHead);
}

function initGrammarEditor() {
  grammarEditorView = new EditorView({
    state: EditorState.create({
      doc: "",
      extensions: [
        history(),
        keymap.of([
          { key: "Enter", run: insertNewlineAtCaret, shift: insertNewlineAtCaret },
          { key: "Tab", run: insertTabAtCaret, shift: insertTabAtCaret },
          ...defaultKeymap,
          ...historyKeymap
        ]),
        grammarEditorTheme,
        grammarHighlightPlugin,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || grammarEditorProgrammaticUpdate) {
            return;
          }

          normaliseEmptyStringMarkers();
          hideGrammarSnippetMenu();
          scheduleGrammarParse();
        })
      ]
    }),
    parent: els.grammarEditor
  });

  const scroller = grammarEditorView.scrollDOM;
  scroller.addEventListener("scroll", hideGrammarSnippetMenu);
  scroller.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showGrammarSnippetMenu(event.clientX, event.clientY);
  });
}

function buildCharacterRule(ruleName, startChar, endChar) {
  const startCode = startChar.charCodeAt(0);
  const endCode = endChar.charCodeAt(0);
  const symbols = [];

  for (let code = startCode; code <= endCode; code += 1) {
    symbols.push(`"${String.fromCharCode(code)}"`);
  }

  return `<${ruleName}> ::= ${symbols.join(" | ")}`;
}

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
    grammarText: getGrammarText(),
    selectedStartSymbol: state.selectedStartSymbol,
    diagramRule: state.diagramRule,
    testInput: els.testInput.value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function getGrammarFileName() {
  return `syntaxor-grammar-${new Date().toISOString().slice(0, 10)}.bnf`;
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function loadGrammarFromText(grammarText) {
  setGrammarText(grammarText, 0);
  state.selectedExample = null;
  state.selectedStartSymbol = null;
  state.diagramRule = null;
  parseAndRender();
}

async function saveGrammarToFile() {
  const grammarText = getGrammarText();
  const filename = getGrammarFileName();

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Syntaxor grammar", accept: { "text/plain": [".bnf", ".txt"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([grammarText], { type: "text/plain;charset=utf-8" }));
      await writable.close();
      return;
    } catch (_error) {
      // Fall back to a download when the picker is unavailable or cancelled.
    }
  }

  downloadTextFile(grammarText, filename);
}

async function openGrammarFromFilePicker() {
  try {
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "Syntaxor grammar", accept: { "text/plain": [".bnf", ".txt"] } }]
      });
      const file = await handle.getFile();
      loadGrammarFromText(await file.text());
      return;
    }

    if (els.fileOpenInput) {
      els.fileOpenInput.value = "";
      els.fileOpenInput.click();
    }
  } catch (_error) {
    // User cancelled or the picker failed.
  }
}

async function handleGrammarFileOpenChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  try {
    loadGrammarFromText(await file.text());
  } finally {
    event.target.value = "";
  }
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

function hideGrammarSnippetMenu() {
  if (!els.grammarSnippetMenu) {
    return;
  }

  els.grammarSnippetMenu.hidden = true;
  state.grammarSnippetMenuOpen = false;
}

function showGrammarSnippetMenu(clientX, clientY) {
  if (!els.grammarSnippetMenu) {
    return;
  }

  els.grammarSnippetMenu.hidden = false;
  const menuWidth = els.grammarSnippetMenu.offsetWidth;
  const menuHeight = els.grammarSnippetMenu.offsetHeight;
  const maxLeft = Math.max(12, window.innerWidth - menuWidth - 12);
  const maxTop = Math.max(12, window.innerHeight - menuHeight - 12);
  const left = Math.min(clientX, maxLeft);
  const top = Math.min(clientY, maxTop);

  els.grammarSnippetMenu.style.left = `${left}px`;
  els.grammarSnippetMenu.style.top = `${top}px`;
  state.grammarSnippetMenuOpen = true;
}

function insertGrammarSnippet(snippetKey) {
  const snippet = GRAMMAR_SNIPPETS[snippetKey];
  if (!snippet || !grammarEditorView) {
    return;
  }

  const selection = grammarEditorView.state.selection.main;
  const start = selection.from;
  const end = selection.to;
  const currentValue = getGrammarText();
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const needsLeadingBreak = before.length > 0 && !before.endsWith("\n");
  const needsTrailingBreak = after.length > 0 && !after.startsWith("\n");
  const insertedSnippet = `${needsLeadingBreak ? "\n" : ""}${snippet}${needsTrailingBreak ? "\n" : ""}`;
  const nextCaret = start + insertedSnippet.length;

  grammarEditorView.dispatch({
    changes: { from: start, to: end, insert: insertedSnippet },
    selection: { anchor: nextCaret }
  });

  focusGrammarEditor();
  hideGrammarSnippetMenu();
}

function insertTextAtGrammarSelection(text) {
  if (!grammarEditorView) {
    return;
  }

  const selection = grammarEditorView.state.selection.main;
  const start = selection.from;
  const end = selection.to;
  const nextCaret = start + text.length;

  grammarEditorView.dispatch({
    changes: { from: start, to: end, insert: text },
    selection: { anchor: nextCaret }
  });

  focusGrammarEditor();
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

function parseTaskTestCase(rawValue) {
  const input = String(rawValue || "");
  const arrowParts = input.split("=>");
  const pipeParts = input.split("|");
  const pieces = arrowParts.length >= 2 ? arrowParts : pipeParts;

  if (pieces.length < 2) {
    return null;
  }

  const testInput = pieces[0].trim();
  const expectedRaw = pieces.slice(1).join("=>").trim();
  if (!testInput || !expectedRaw) {
    return null;
  }

  const expectedLower = expectedRaw.toLowerCase();
  const isAccept = ["accept", "accepted", "pass", "valid", "yes", "true", "1"].includes(expectedLower);
  const isReject = ["reject", "rejected", "fail", "invalid", "no", "false", "0"].includes(expectedLower);
  const expected = isAccept ? "ACCEPT" : isReject ? "REJECT" : expectedRaw.toUpperCase();

  return {
    input: testInput,
    expected,
    type: expected === "ACCEPT" ? "accept" : expected === "REJECT" ? "reject" : "other"
  };
}

function parseTasksText(sourceText) {
  const blocks = String(sourceText || "")
    .split(/^===\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, index) => {
    const task = {
      id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      grade: "",
      description: "",
      tests: []
    };

    block.split(/\r?\n/).forEach((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        return;
      }

      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();
      if (key === "title") task.title = value || task.title;
      if (key === "grade" || key === "level") task.grade = value;
      if (key === "description") task.description = value;
      if (key === "test") {
        const parsedTest = parseTaskTestCase(value);
        if (parsedTest) {
          task.tests.push(parsedTest);
        }
      }
    });

    return task;
  });
}

async function loadTasksCatalog() {
  if (state.tasksCatalogLoaded || state.tasksCatalogLoading) {
    return;
  }

  state.tasksCatalogLoading = true;
  state.tasksCatalogError = "";

  try {
    const response = await fetch(TASKS_SOURCE_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Tasks file returned ${response.status}.`);
    }

    const text = await response.text();
    state.tasksCatalog = parseTasksText(text);
    state.tasksCatalogLoaded = true;
  } catch (error) {
    state.tasksCatalog = [];
    state.tasksCatalogError = error instanceof Error ? error.message : "Unable to load tasks.";
  } finally {
    state.tasksCatalogLoading = false;
  }
}

function renderTasksModal() {
  if (!els.tasksModalList || !els.tasksModalStatus || !els.tasksModalPosition || !els.btnTasksModalPrev || !els.btnTasksModalNext) {
    return;
  }

  els.tasksModalList.replaceChildren();
  els.tasksModalPosition.textContent = "";
  els.btnTasksModalPrev.disabled = true;
  els.btnTasksModalNext.disabled = true;

  if (state.tasksCatalogLoading) {
    els.tasksModalStatus.hidden = false;
    els.tasksModalStatus.textContent = "Loading tasks...";
    return;
  }

  if (state.tasksCatalogError) {
    els.tasksModalStatus.hidden = false;
    els.tasksModalStatus.textContent = `Could not load tasks: ${state.tasksCatalogError}`;
    return;
  }

  if (state.tasksCatalog.length === 0) {
    els.tasksModalStatus.hidden = false;
    els.tasksModalStatus.textContent = "No tasks found.";
    return;
  }

  els.tasksModalStatus.hidden = true;
  state.currentTaskIndex = Math.max(0, Math.min(state.currentTaskIndex, state.tasksCatalog.length - 1));

  const task = state.tasksCatalog[state.currentTaskIndex];
  const index = state.currentTaskIndex;

  els.tasksModalPosition.textContent = `${index + 1} / ${state.tasksCatalog.length}`;
  els.btnTasksModalPrev.disabled = index === 0;
  els.btnTasksModalNext.disabled = index >= state.tasksCatalog.length - 1;

  const article = document.createElement("article");
  article.className = "task-card";

  const title = document.createElement("h4");
  title.className = "task-card-title";
  title.textContent = `Task ${index + 1}: ${task.title}`;
  article.appendChild(title);

  if (task.grade) {
    const grade = document.createElement("p");
    grade.className = "task-card-grade";
    grade.textContent = `Grade: ${task.grade}`;
    article.appendChild(grade);
  }

  if (task.description) {
    const description = document.createElement("p");
    description.className = "task-card-description";
    description.textContent = task.description;
    article.appendChild(description);
  }

  const testsSection = document.createElement("section");
  testsSection.className = "task-card-tests";
  const testsLabel = document.createElement("p");
  testsLabel.className = "task-card-tests-label";
  testsLabel.textContent = "Test strings";
  testsSection.appendChild(testsLabel);

  if (task.tests.length === 0) {
    const noTests = document.createElement("p");
    noTests.className = "task-card-outcome other";
    noTests.textContent = "No tests provided.";
    testsSection.appendChild(noTests);
  } else {
    const list = document.createElement("ul");
    list.className = "task-tests-list";

    task.tests.forEach((testCase) => {
      const item = document.createElement("li");
      item.className = "task-test-item";

      const input = document.createElement("span");
      input.className = "task-test-input";
      input.textContent = `"${testCase.input}"`;

      const expected = document.createElement("span");
      expected.className = `task-test-expected ${testCase.type}`;
      expected.textContent = testCase.expected;

      item.appendChild(input);
      item.appendChild(expected);
      list.appendChild(item);
    });

    testsSection.appendChild(list);
  }

  article.appendChild(testsSection);
  els.tasksModalList.appendChild(article);
}

function showTaskAtIndex(nextIndex) {
  if (state.tasksCatalog.length === 0) {
    return;
  }

  state.currentTaskIndex = Math.max(0, Math.min(nextIndex, state.tasksCatalog.length - 1));
  renderTasksModal();
}

async function openTasksModal() {
  if (state.tasksModalOverlay) {
    return;
  }

  state.modalOpenedAt = performance.now();
  renderTasksModal();
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;";
  const content = els.tasksModal.firstElementChild;
  if (content) {
    overlay.appendChild(content);
  }
  overlay.addEventListener("click", (event) => {
    if (performance.now() - state.modalOpenedAt < 350) {
      return;
    }
    if (event.target === overlay) {
      closeTasksModal();
    }
  });
  document.body.appendChild(overlay);
  state.tasksModalOverlay = overlay;
  document.body.style.overflow = "hidden";
  toggleMenu(false);
  window.requestAnimationFrame(() => {
    const modalContent = state.tasksModalOverlay?.firstElementChild;
    if (modalContent instanceof HTMLElement) {
      modalContent.setAttribute("tabindex", "-1");
      modalContent.focus({ preventScroll: true });
    }
  });

  if (!state.tasksCatalogLoaded && !state.tasksCatalogLoading) {
    renderTasksModal();
    await loadTasksCatalog();
    renderTasksModal();
  }
}

function closeTasksModal() {
  if (!state.tasksModalOverlay) {
    return;
  }

  const content = state.tasksModalOverlay.firstElementChild;
  if (content) {
    els.tasksModal.appendChild(content);
  }
  state.tasksModalOverlay.remove();
  state.tasksModalOverlay = null;
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
  setGrammarText(example.grammar, 0);
  parseAndRender();
}

function clearWorkspace() {
  state.selectedStartSymbol = null;
  state.diagramRule = null;
  state.parsed = null;
  state.parseError = null;

  setGrammarText("", 0);
  els.testInput.value = "";
  els.testInput.classList.remove("test-pass", "test-fail");
  setParseTreeEnabled(false);

  setStartSymbolOptions(null);
  setDiagramRuleOptions(null);
  renderWarnings([]);
  renderDiagram();

  saveWorkspace();
}

function toggleMenu(open) {
  const isOpen = open !== undefined ? open : !els.appMenu.classList.contains("is-open");
  if (isOpen) {
    collapseMenuConcertinas();
  }
  els.appMenu.classList.toggle("is-open", isOpen);
  els.btnHamburger.setAttribute("aria-expanded", String(isOpen));
  els.btnHamburger.classList.toggle("is-open", isOpen);
}

function collapseMenuConcertinas() {
  if (!els.menuExamplesToggle || !els.menuExamplesList) {
    return;
  }

  els.menuExamplesToggle.setAttribute("aria-expanded", "false");
  els.menuExamplesList.hidden = true;
  const arrow = els.menuExamplesToggle.querySelector(".concertina-arrow");
  if (arrow) {
    arrow.textContent = "▸";
  }
}

function parseAndRender() {
  const grammarText = getGrammarText();
  state.grammarText = grammarText;

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
  let parseTreeViewportTimer = null;

  const isTextEntryTarget = (target) => {
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  };

  els.grammarSnippetMenu.addEventListener("click", (event) => {
    const target = event.target.closest(".grammar-snippet-btn");
    if (!target) {
      return;
    }

    insertGrammarSnippet(target.dataset.snippetKey);
  });

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

  els.menuOpenFile?.addEventListener("click", () => {
    openGrammarFromFilePicker();
    toggleMenu(false);
  });

  els.menuSaveFile?.addEventListener("click", () => {
    saveGrammarToFile();
    toggleMenu(false);
  });

  els.btnHamburger.addEventListener("click", () => toggleMenu());
  els.btnMenuClose.addEventListener("click", () => toggleMenu(false));
  els.menuTasks.addEventListener("click", () => {
    if (state.tasksModalOverlay) {
      closeTasksModal();
      return;
    }
    openTasksModal();
  });
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
  els.btnTasksModalCloseX.addEventListener("click", closeTasksModal);
  els.btnTasksModalPrev.addEventListener("click", () => showTaskAtIndex(state.currentTaskIndex - 1));
  els.btnTasksModalNext.addEventListener("click", () => showTaskAtIndex(state.currentTaskIndex + 1));
  els.btnHelpCloseX.addEventListener("click", closeHelpModal);
  els.btnAboutCloseX.addEventListener("click", closeAboutModal);
  els.aboutShowOnStartup.addEventListener("change", () => {
    setShowAboutOnStartupPreference(els.aboutShowOnStartup.checked);
  });

  els.fileOpenInput?.addEventListener("change", handleGrammarFileOpenChange);

  const scheduleParseTreeViewportRender = () => {
    if (!state.parseTreeModalOverlay) {
      return;
    }
    window.clearTimeout(parseTreeViewportTimer);
    parseTreeViewportTimer = window.setTimeout(() => {
      renderParseTreeModal();
    }, 120);
  };

  window.addEventListener("resize", scheduleParseTreeViewportRender);
  window.addEventListener("orientationchange", scheduleParseTreeViewportRender);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleParseTreeViewportRender);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.appMenu.classList.contains("is-open")) {
      toggleMenu(false);
      return;
    }

    if (event.key === "Escape" && state.grammarSnippetMenuOpen) {
      hideGrammarSnippetMenu();
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

    if (event.key === "Escape" && state.tasksModalOverlay) {
      closeTasksModal();
      return;
    }

    if (event.key === "Escape" && state.parseTreeModalOverlay) {
      closeParseTreeModal();
    }

    const isTasksShortcut = event.shiftKey
      && !event.ctrlKey
      && !event.altKey
      && !event.metaKey
      && !event.repeat
      && event.key.toLowerCase() === "t";

    if (!isTasksShortcut || isTextEntryTarget(event.target)) {
      return;
    }

    event.preventDefault();
    if (state.tasksModalOverlay) {
      closeTasksModal();
      return;
    }

    openTasksModal();
  });

  document.addEventListener("click", (event) => {
    if (state.grammarSnippetMenuOpen && !els.grammarSnippetMenu.contains(event.target)) {
      hideGrammarSnippetMenu();
    }

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
  initGrammarEditor();
  const restoredFromStorage = loadWorkspace();
  if (!restoredFromStorage) {
    state.selectedExample = DEFAULT_EXAMPLE_KEY;
    state.grammarText = EXAMPLES[DEFAULT_EXAMPLE_KEY].grammar;
    state.selectedStartSymbol = "expression";
    state.diagramRule = "expression";
    els.testInput.value = DEFAULT_FIRST_RUN_TEST_INPUT;
  }
  populateExamples();
  setGrammarText(state.grammarText, 0);
  parseAndRender();
  attachEvents();
  loadTasksCatalog().then(() => {
    if (state.tasksModalOverlay) {
      renderTasksModal();
    }
  });

  if (showAboutOnStartup) {
    openAboutModal({ focusClose: false });
  }
}

init();
