export const APP_VERSION = "0.1.0";

export const EXAMPLES = {
  arithmetic: {
    title: "Arithmetic expression",
    grammar: [
      '<expression> ::= <factor>',
      '                 | <factor> "*" <factor>',
      '                 | <factor> "/" <factor>',
      '',
      '<factor> ::= <term>',
      '             | <term> "+" <term>',
      '             | <term> "-" <term>',
      '',
      '<term> ::= "-" <expression> | <number>',
      '',
      '<number> ::= <digit> | <digit> <number>',
      '',
      '<digit> ::= "0"',
      '            | "1"',
      '            | "2"',
      '            | "3"',
      '            | "4"',
      '            | "5"',
      '            | "6"',
      '            | "7"',
      '            | "8"',
      '            | "9"'
    ].join("\n")
  },
  identifier: {
    title: "Identifier",
    grammar: [
      '<identifier> ::= <letter> <identifier-tail>',
      '<identifier-tail> ::= <letter> <identifier-tail> | <digit> <identifier-tail> | "_" <identifier-tail> | ""',
      '<letter> ::= "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"',
      '<digit> ::= "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"'
    ].join("\n")
  },
  sentence: {
    title: "Tiny sentence",
    grammar: [
      '<sentence> ::= <subject> " " <verb> " " <object>',
      '<subject> ::= "the cat" | "the robot" | "a student"',
      '<verb> ::= "writes" | "tests" | "builds"',
      '<object> ::= "rules" | "a parser" | "a diagram"'
    ].join("\n")
  }
};

function isQuote(char) {
  return char === '"' || char === "'";
}

function decodeEscapes(text) {
  let value = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char !== "\\") {
      value += char;
      continue;
    }

    index += 1;
    const next = text[index];

    if (next === undefined) {
      value += "\\";
      break;
    }

    if (next === "n") {
      value += "\n";
    } else if (next === "t") {
      value += "\t";
    } else {
      value += next;
    }
  }

  return value;
}

function parseSequence(source, lineNumber) {
  const terms = [];
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) {
      index += 1;
    }

    if (index >= source.length) {
      break;
    }

    const char = source[index];

    if (char === "<") {
      const endIndex = source.indexOf(">", index + 1);
      if (endIndex === -1) {
        throw new Error(`Line ${lineNumber}: missing closing > for non-terminal.`);
      }

      const name = source.slice(index + 1, endIndex).trim();
      if (!name) {
        throw new Error(`Line ${lineNumber}: empty non-terminal name.`);
      }

      terms.push({ type: "nonterminal", value: name });
      index = endIndex + 1;
      continue;
    }

    if (isQuote(char)) {
      const quote = char;
      index += 1;
      let token = "";
      let closed = false;

      while (index < source.length) {
        const current = source[index];
        if (current === "\\" && index + 1 < source.length) {
          token += current + source[index + 1];
          index += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        token += current;
        index += 1;
      }

      if (!closed) {
        throw new Error(`Line ${lineNumber}: unterminated quoted terminal.`);
      }

      const decoded = decodeEscapes(token);
      if (decoded === "") {
        terms.push({ type: "epsilon", value: "" });
      } else {
        terms.push({ type: "terminal", value: decoded });
      }
      continue;
    }

    let end = index;
    while (end < source.length && !/\s/.test(source[end])) {
      end += 1;
    }

    const token = source.slice(index, end).trim();
    if (token && token !== "|") {
      if (token === "ε" || token.toLowerCase() === "epsilon") {
        terms.push({ type: "epsilon", value: "" });
      } else {
        terms.push({ type: "nonterminal", value: token });
      }
    }
    index = end;
  }

  return terms;
}

function splitAlternatives(source) {
  const parts = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      current += char;
      if (char === "\\" && index + 1 < source.length) {
        current += source[index + 1];
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (isQuote(char)) {
      quote = char;
      current += char;
      continue;
    }

    if (char === "|") {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current.trim());
  return parts;
}

export function parseGrammar(sourceText) {
  const text = `${sourceText || ""}`.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const ruleOrder = [];
  const rules = new Map();
  const terminals = new Set();
  const referenced = new Set();
  const warnings = [];
  const pendingRules = [];

  const flushPendingRule = (pendingRule) => {
    if (!pendingRule) {
      return;
    }

    if (!rules.has(pendingRule.name)) {
      rules.set(pendingRule.name, []);
      ruleOrder.push(pendingRule.name);
    }

    for (const fragment of pendingRule.fragments) {
      const rhs = fragment.text;
      const alternatives = splitAlternatives(rhs).map((part) => {
        if (!part) {
          return [];
        }

        const parsedTerms = parseSequence(part, fragment.lineNumber);
        const sequence = parsedTerms.filter((term) => term.type !== "epsilon");

        for (const term of parsedTerms) {
          if (term.type === "terminal" && term.value) {
            terminals.add(term.value);
          }
          if (term.type === "nonterminal") {
            referenced.add(term.value);
          }
        }

        return sequence;
      });

      rules.get(pendingRule.name).push(...alternatives);
    }
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const trimmedLine = rawLine.trim();
    const lineNumber = lineIndex + 1;

    if (!trimmedLine || trimmedLine.startsWith("#") || trimmedLine.startsWith("//")) {
      continue;
    }

    const continuationMatch = rawLine.match(/^\s*\|\s*(.*)$/);
    if (continuationMatch) {
      if (pendingRules.length === 0) {
        throw new Error(`Line ${lineNumber}: expected <rule> ::= production.`);
      }

      pendingRules[pendingRules.length - 1].fragments.push({
        text: continuationMatch[1] || "",
        lineNumber
      });
      continue;
    }

    const match = trimmedLine.match(/^<([^<>]+)>\s*::=\s*(.*)$/);
    if (!match) {
      throw new Error(`Line ${lineNumber}: expected <rule> ::= production.`);
    }

    pendingRules.push({
      name: match[1].trim(),
      fragments: [{ text: match[2] || "", lineNumber }]
    });
  }

  for (const pendingRule of pendingRules) {
    flushPendingRule(pendingRule);
  }

  if (ruleOrder.length === 0) {
    throw new Error("Enter at least one BNF rule.");
  }

  for (const symbol of referenced) {
    if (!rules.has(symbol)) {
      throw new Error(`Referenced non-terminal <${symbol}> has no definition.`);
    }
  }

  return {
    version: APP_VERSION,
    startSymbol: ruleOrder[0],
    ruleOrder,
    rules,
    terminals: [...terminals],
    warnings
  };
}

export function testString(grammarInput, candidate) {
  const grammar = typeof grammarInput === "string" ? parseGrammar(grammarInput) : grammarInput;
  const input = `${candidate ?? ""}`;
  const memo = new Map();
  let furthest = 0;

  function matchSequence(sequence, startPosition, visiting) {
    let positions = new Set([startPosition]);

    for (const term of sequence) {
      const nextPositions = new Set();

      for (const position of positions) {
        if (term.type === "terminal") {
          if (input.startsWith(term.value, position)) {
            nextPositions.add(position + term.value.length);
            furthest = Math.max(furthest, position + term.value.length);
          } else {
            furthest = Math.max(furthest, position);
          }
          continue;
        }

        if (term.type === "nonterminal") {
          const subMatches = matchNonTerminal(term.value, position, visiting);
          for (const endPosition of subMatches) {
            nextPositions.add(endPosition);
            furthest = Math.max(furthest, endPosition);
          }
        }
      }

      positions = nextPositions;
      if (positions.size === 0) {
        break;
      }
    }

    return positions;
  }

  function matchNonTerminal(symbol, startPosition, visiting) {
    const key = `${symbol}@${startPosition}`;

    if (memo.has(key)) {
      return memo.get(key);
    }

    const alternatives = grammar.rules.get(symbol);
    if (!alternatives) {
      return new Set();
    }

    const results = new Set();
    memo.set(key, results);
    visiting.add(key);
    let previousSize = -1;

    while (results.size !== previousSize) {
      previousSize = results.size;

      for (const alternative of alternatives) {
        const endPositions = alternative.length === 0
          ? new Set([startPosition])
          : matchSequence(alternative, startPosition, visiting);

        for (const endPosition of endPositions) {
          results.add(endPosition);
        }
      }
    }

    visiting.delete(key);
    return results;
  }

  const matches = matchNonTerminal(grammar.startSymbol, 0, new Set());
  const accepted = matches.has(input.length);

  return {
    accepted,
    furthest,
    blocked: [],
    grammar,
    matches: [...matches].sort((left, right) => left - right)
  };
}

export function buildParseTree(grammarInput, candidate, startSymbol) {
  const grammar = typeof grammarInput === "string" ? parseGrammar(grammarInput) : grammarInput;
  const input = `${candidate ?? ""}`;
  const rootSymbol = startSymbol && grammar.rules.has(startSymbol) ? startSymbol : grammar.startSymbol;
  const memo = new Map();
  let furthest = 0;

  function createTerminalNode(value, startPosition, endPosition) {
    return {
      type: "terminal",
        label: `"${value}"`,
      value,
      start: startPosition,
      end: endPosition,
      children: []
    };
  }

  function createEpsilonNode(position) {
    return {
      type: "epsilon",
      label: "ε",
      value: "",
      start: position,
      end: position,
      children: []
    };
  }

  function createNonTerminalNode(symbol, startPosition, endPosition, children) {
    return {
      type: "nonterminal",
      label: `<${symbol}>`,
      symbol,
      start: startPosition,
      end: endPosition,
      children
    };
  }

  function matchSequence(sequence, startPosition, visiting) {
    let results = [{ endPosition: startPosition, children: [] }];

    for (const term of sequence) {
      const nextResults = [];

      for (const result of results) {
        const position = result.endPosition;

        if (term.type === "terminal") {
          if (input.startsWith(term.value, position)) {
            const endPosition = position + term.value.length;
            nextResults.push({
              endPosition,
              children: [...result.children, createTerminalNode(term.value, position, endPosition)]
            });
            furthest = Math.max(furthest, endPosition);
          } else {
            furthest = Math.max(furthest, position);
          }
          continue;
        }

        if (term.type === "nonterminal") {
          const subMatches = matchNonTerminal(term.value, position, visiting);
          for (const subMatch of subMatches) {
            nextResults.push({
              endPosition: subMatch.endPosition,
              children: [...result.children, subMatch.node]
            });
            furthest = Math.max(furthest, subMatch.endPosition);
          }
        }
      }

      results = nextResults;
      if (results.length === 0) {
        break;
      }
    }

    return results;
  }

  function matchNonTerminal(symbol, startPosition, visiting) {
    const key = `${symbol}@${startPosition}`;

    if (memo.has(key)) {
      return memo.get(key);
    }

    const alternatives = grammar.rules.get(symbol);
    if (!alternatives) {
      return [];
    }

    const results = [];
    const resultsByEnd = new Map();
    memo.set(key, results);
    visiting.add(key);

    let previousSize = -1;
    while (results.length !== previousSize) {
      previousSize = results.length;

      for (const alternative of alternatives) {
        const endMatches = alternative.length === 0
          ? [{ endPosition: startPosition, children: [createEpsilonNode(startPosition)] }]
          : matchSequence(alternative, startPosition, visiting);

        for (const endMatch of endMatches) {
          if (resultsByEnd.has(endMatch.endPosition)) {
            continue;
          }

          const node = createNonTerminalNode(symbol, startPosition, endMatch.endPosition, endMatch.children);
          const result = { endPosition: endMatch.endPosition, node };
          resultsByEnd.set(endMatch.endPosition, result);
          results.push(result);
        }
      }
    }

    visiting.delete(key);
    return results;
  }

  const matches = matchNonTerminal(rootSymbol, 0, new Set());
  const acceptedMatch = matches.find((match) => match.endPosition === input.length) || null;

  return {
    accepted: Boolean(acceptedMatch),
    furthest,
    grammar,
    matches: matches.map((match) => match.endPosition).sort((left, right) => left - right),
    tree: acceptedMatch ? acceptedMatch.node : null,
    rootSymbol
  };
}

function escapeXml(value) {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function measureTermWidth(label) {
  return Math.max(68, label.length * 8 + 30);
}

function buildOrthogonalPath(startX, startY, endX, endY) {
  const bendX = Math.round((startX + endX) / 2);
  return [
    `M ${startX} ${startY}`,
    `H ${bendX}`,
    `V ${endY}`,
    `H ${endX}`
  ].join(" ");
}

function buildArrowOnSegment(startX, startY, endX, endY, position = 0.5) {
  void startX;
  void startY;
  void endX;
  void endY;
  void position;
  // Legacy chevrons removed: directional cue is now provided by animated rail flow.
  return "";
}

function buildMidArrowForOrthogonalPath(startX, startY, endX, endY) {
  const bendX = Math.round((startX + endX) / 2);
  const segments = [
    { startX, startY, endX: bendX, endY: startY },
    { startX: bendX, startY, endX: bendX, endY },
    { startX: bendX, startY: endY, endX, endY }
  ].filter((segment) => Math.hypot(segment.endX - segment.startX, segment.endY - segment.startY) > 0.1);

  const lengths = segments.map((segment) => Math.hypot(segment.endX - segment.startX, segment.endY - segment.startY));
  const totalLength = lengths.reduce((sum, value) => sum + value, 0);
  if (totalLength < 1) {
    return "";
  }

  const target = totalLength / 2;
  let traversed = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segmentLength = lengths[index];
    if (traversed + segmentLength >= target) {
      const offset = target - traversed;
      const position = segmentLength < 1 ? 0.5 : offset / segmentLength;
      const segment = segments[index];
      return buildArrowOnSegment(segment.startX, segment.startY, segment.endX, segment.endY, position);
    }
    traversed += segmentLength;
  }

  const fallback = segments[segments.length - 1];
  return buildArrowOnSegment(fallback.startX, fallback.startY, fallback.endX, fallback.endY, 0.5);
}

function buildVerticalMergeArrowForOrthogonalPath(startX, startY, endX, endY) {
  if (Math.abs(startY - endY) < 0.1) {
    return "";
  }
  const bendX = Math.round((startX + endX) / 2);
  return buildArrowOnSegment(bendX, startY, bendX, endY, 0.35);
}

function detectLoopPattern(ruleName, alternatives) {
  function same(a, b) {
    return a.type === b.type && a.value === b.value;
  }

  // Pattern B: one epsilon alternative + one or more recursive alternatives (each ending in self-ref)
  // This must be checked first so rules like <number-tail> ::= <digit> <number-tail> | ""
  // render as an explicit choice instead of collapsing into the simple 2-alt pattern.
  const isEpsilon = (alt) => alt.length === 0 || (alt.length === 1 && alt[0].type === "epsilon");
  const isRecursive = (alt) => alt.length > 0 && alt[alt.length - 1].type === "nonterminal" && alt[alt.length - 1].value === ruleName;
  const epsilonAlts = alternatives.filter(isEpsilon);
  const recursiveAlts = alternatives.filter(isRecursive);

  if (epsilonAlts.length === 1 && recursiveAlts.length >= 1 && epsilonAlts.length + recursiveAlts.length === alternatives.length) {
    return { type: "multi", bodyAlternatives: recursiveAlts.map((alt) => alt.slice(0, alt.length - 1)) };
  }

  // Pattern A: simple or separated loop (exactly 2 alternatives, one is a prefix of the other + self-ref)
  if (alternatives.length === 2) {
    const [alt1, alt2] = alternatives;

    if (
      alt2.length > alt1.length &&
      alt2[alt2.length - 1].type === "nonterminal" &&
      alt2[alt2.length - 1].value === ruleName &&
      alt1.every((term, i) => same(term, alt2[i]))
    ) {
      return { type: "simple", base: alt1, separator: alt2.slice(alt1.length, alt2.length - 1) };
    }

    if (
      alt1.length > alt2.length &&
      alt1[alt1.length - 1].type === "nonterminal" &&
      alt1[alt1.length - 1].value === ruleName &&
      alt2.every((term, i) => same(term, alt1[i]))
    ) {
      return { type: "simple", base: alt2, separator: alt1.slice(alt2.length, alt1.length - 1) };
    }
  }

  return null;
}

export function renderDiagramSvg(grammar, singleRule) {
  const activeRules = singleRule && grammar.ruleOrder.includes(singleRule)
    ? [singleRule]
    : grammar.ruleOrder;
  const laneGap = 68;
  const ruleGap = 64;
  const titleGap = 40;
  const incomingLead = 52;
  const joinX = 92;
  const canvasSideInset = joinX - incomingLead;
  const laneStartX = joinX + 60;
  const laneExitGap = 26;
  const endCapGap = 38;
  const maxWidth = { value: 0 };
  let totalHeight = 36;
  let body = "";
  const endpointRadius = 6;

  function appendRuleTitleAndEndpoints(ruleName, ruleTop, mainLaneY, endX) {
    void ruleName;
    void ruleTop;
    const entryX = joinX - incomingLead;
    const exitX = endX - 16;
    body += `<circle class="rail-dot-start" cx="${entryX}" cy="${mainLaneY}" r="${endpointRadius}" />`;
    body += `<circle class="rail-dot-end" cx="${exitX}" cy="${mainLaneY}" r="${endpointRadius}" />`;
  }

  for (const ruleName of activeRules) {
    const alternatives = grammar.rules.get(ruleName) || [];
    const ruleTop = totalHeight;
    const branchTop = ruleTop + titleGap;
    const loopPattern = detectLoopPattern(ruleName, alternatives);

    if (loopPattern !== null && loopPattern.type === "multi") {
      const { bodyAlternatives } = loopPattern;
      const preparedBodies = bodyAlternatives.map((sequence) => {
        const terms = sequence.length === 0 ? [{ type: "epsilon", value: "\u03b5" }] : sequence;
        const widths = terms.map((term) => {
          const label = term.type === "nonterminal" ? `<${term.value}>` : term.type === "epsilon" ? "\u03b5" : `"${term.value}"`;
          return { label, width: measureTermWidth(label), term };
        });
        const seqW = widths.reduce((total, item, index) => total + item.width + (index < widths.length - 1 ? 24 : 0), 0);
        return { terms: widths, width: seqW };
      });
      const bodyMaxWidth = preparedBodies.reduce((max, b) => Math.max(max, b.width), 0);
      const mainLaneY = branchTop;
      const spineSplit = 14;
      const leftReturnX = joinX - spineSplit;
      const leftDownX = joinX;
      const bodyEndX = laneStartX + bodyMaxWidth;
      const rightUpX = bodyEndX + laneExitGap + 60;
      const rightDownX = rightUpX + spineSplit;
      const endX = rightDownX + endCapGap;
      const bodyGap = 58;
      const bodyLaneYs = preparedBodies.map((_, i) => mainLaneY + bodyGap + i * laneGap);
      const deepestLoopY = bodyLaneYs[bodyLaneYs.length - 1] || mainLaneY;
      const returnY = deepestLoopY + 34;

      if (preparedBodies.length === 1) {
        const prepared = preparedBodies[0];
        const loopY = bodyLaneYs[0];
        const epsilonLabel = "ε";
        const epsilonWidth = measureTermWidth(epsilonLabel);
        const epsilonBoxX = Math.round((leftDownX + rightDownX - epsilonWidth) / 2);
        const epsilonBoxY = mainLaneY - 17;
        const epsilonTextX = epsilonBoxX + epsilonWidth / 2;

        appendRuleTitleAndEndpoints(ruleName, ruleTop, mainLaneY, endX);
        // Incoming/outgoing rails with explicit top epsilon choice branch.
        body += `<line class="rail-line" x1="${joinX - incomingLead}" y1="${mainLaneY}" x2="${leftDownX}" y2="${mainLaneY}" />`;
        body += `<line class="rail-line" x1="${rightDownX}" y1="${mainLaneY}" x2="${endX - 16}" y2="${mainLaneY}" />`;
        body += `<line class="rail-line rail-line-alt" x1="${leftDownX}" y1="${mainLaneY}" x2="${epsilonBoxX}" y2="${mainLaneY}" />`;
        body += `<rect class="rail-node-epsilon" x="${epsilonBoxX}" y="${epsilonBoxY}" width="${epsilonWidth}" height="34" rx="18" ry="18" />`;
        body += `<text class="rail-label-epsilon" x="${epsilonTextX}" y="${mainLaneY}" text-anchor="middle">${epsilonLabel}</text>`;
        body += `<line class="rail-line rail-line-alt" x1="${epsilonBoxX + epsilonWidth}" y1="${mainLaneY}" x2="${rightDownX}" y2="${mainLaneY}" />`;

        // Recursive alternative: descend to body lane, traverse body, then either exit upward or repeat via bottom loop.
        body += `<path class="rail-line rail-line-alt" d="M ${leftDownX} ${mainLaneY} V ${loopY}" />`;
        body += `<path class="rail-line rail-line-alt" d="M ${rightDownX} ${loopY} V ${mainLaneY}" />`;

        body += `<line class="rail-line rail-line-alt" x1="${leftDownX}" y1="${loopY}" x2="${laneStartX}" y2="${loopY}" />`;

        let cursorX = laneStartX;
        prepared.terms.forEach(({ term, label, width }, termIndex) => {
          const boxX = cursorX;
          const boxY = loopY - 17;
          const boxClass = term.type === "nonterminal" ? "rail-node-nonterminal" : term.type === "epsilon" ? "rail-node-epsilon" : "rail-node-terminal";
          const labelClass = term.type === "nonterminal" ? "rail-label-nonterminal" : term.type === "epsilon" ? "rail-label-epsilon" : "rail-label-terminal";
          const radius = term.type === "nonterminal" ? 0 : 10;
          body += `<rect class="${boxClass}" x="${boxX}" y="${boxY}" width="${width}" height="34" rx="${radius}" ry="${radius}" />`;
          body += `<text class="${labelClass}" x="${boxX + width / 2}" y="${loopY}" text-anchor="middle">${escapeXml(label)}</text>`;
          cursorX += width;
          if (termIndex < prepared.terms.length - 1) {
            body += `<line class="rail-line rail-line-alt" x1="${cursorX}" y1="${loopY}" x2="${cursorX + 24}" y2="${loopY}" />`;
            cursorX += 24;
          }
        });

        body += `<line class="rail-line rail-line-alt" x1="${cursorX}" y1="${loopY}" x2="${rightDownX}" y2="${loopY}" />`;

        // Bottom repeat loop: after body, return left and re-enter the recursive lane.
        body += `<path class="rail-line rail-line-alt" d="M ${rightDownX} ${loopY} V ${returnY}" />`;
        body += `<line class="rail-line rail-line-alt" x1="${rightDownX}" y1="${returnY}" x2="${leftDownX}" y2="${returnY}" />`;
        body += `<path class="rail-line rail-line-alt" d="M ${leftDownX} ${returnY} V ${loopY}" />`;

        totalHeight = returnY + ruleGap;
        maxWidth.value = Math.max(maxWidth.value, endX + canvasSideInset - 16);
        continue;
      }

      appendRuleTitleAndEndpoints(ruleName, ruleTop, mainLaneY, endX);
      // Main pass-through (the epsilon alternative) - single unbroken horizontal
      body += `<line class="rail-line" x1="${joinX - incomingLead}" y1="${mainLaneY}" x2="${endX - 16}" y2="${mainLaneY}" />`;
      body += buildArrowOnSegment(joinX - incomingLead, mainLaneY, endX - 16, mainLaneY);
      // Separate left down/up rails to avoid a bidirectional segment.
      body += `<path class="rail-line rail-line-alt" d="M ${leftDownX} ${mainLaneY} V ${deepestLoopY}" />`;
      body += `<path class="rail-line rail-line-alt" d="M ${leftReturnX} ${returnY} V ${mainLaneY}" />`;
      body += `<line class="rail-line rail-line-alt" x1="${leftReturnX}" y1="${mainLaneY}" x2="${leftDownX}" y2="${mainLaneY}" />`;
      body += buildArrowOnSegment(leftReturnX, mainLaneY, leftDownX, mainLaneY);
      // Separate right up/down rails to avoid a bidirectional segment.
      body += `<path class="rail-line rail-line-alt" d="M ${rightUpX} ${deepestLoopY} V ${mainLaneY}" />`;
      body += `<path class="rail-line rail-line-alt" d="M ${rightDownX} ${mainLaneY} V ${returnY}" />`;
      body += `<line class="rail-line rail-line-alt" x1="${rightUpX}" y1="${mainLaneY}" x2="${rightDownX}" y2="${mainLaneY}" />`;
      body += buildArrowOnSegment(rightUpX, mainLaneY, rightDownX, mainLaneY);

      preparedBodies.forEach((prepared, index) => {
        const loopY = bodyLaneYs[index];
        // Left stub: from left spine to first term
        body += `<line class="rail-line rail-line-alt" x1="${leftDownX}" y1="${loopY}" x2="${laneStartX}" y2="${loopY}" />`;
        let cursorX = laneStartX;
        prepared.terms.forEach(({ term, label, width }, termIndex) => {
          const boxX = cursorX;
          const boxY = loopY - 17;
          const boxClass = term.type === "nonterminal" ? "rail-node-nonterminal" : term.type === "epsilon" ? "rail-node-epsilon" : "rail-node-terminal";
          const labelClass = term.type === "nonterminal" ? "rail-label-nonterminal" : term.type === "epsilon" ? "rail-label-epsilon" : "rail-label-terminal";
          const radius = term.type === "nonterminal" ? 0 : 10;
          body += `<rect class="${boxClass}" x="${boxX}" y="${boxY}" width="${width}" height="34" rx="${radius}" ry="${radius}" />`;
          body += `<text class="${labelClass}" x="${boxX + width / 2}" y="${loopY}" text-anchor="middle">${escapeXml(label)}</text>`;
          cursorX += width;
          if (termIndex < prepared.terms.length - 1) {
            body += `<line class="rail-line rail-line-alt" x1="${cursorX}" y1="${loopY}" x2="${cursorX + 24}" y2="${loopY}" />`;
            cursorX += 24;
          }
        });
        // Single continuous run to the right rail avoids visible seam artefacts on shorter rows.
        body += `<line class="rail-line rail-line-alt" x1="${cursorX}" y1="${loopY}" x2="${rightUpX}" y2="${loopY}" />`;
        // Body lanes flow left-to-right; return flow is handled by shared bottom rail.
        body += buildArrowOnSegment(laneStartX, loopY, rightUpX, loopY);
      });

      // Shared bottom return path: right-to-left back to the loop entry spine.
      body += `<line class="rail-line rail-line-alt" x1="${rightDownX}" y1="${returnY}" x2="${leftReturnX}" y2="${returnY}" />`;
      body += buildArrowOnSegment(rightDownX, returnY, leftReturnX, returnY);

      totalHeight = returnY + ruleGap;
      maxWidth.value = Math.max(maxWidth.value, endX + canvasSideInset - 16);
    } else if (loopPattern !== null) {
      const { base: loopBase, separator: loopSeparator } = loopPattern;
      const baseTerms = loopBase.length === 0 ? [{ type: "epsilon", value: "ε" }] : loopBase;
      const termWidths = baseTerms.map((term) => {
        const label = term.type === "nonterminal" ? `<${term.value}>` : term.type === "epsilon" ? "ε" : `"${term.value}"`;
        return { label, width: measureTermWidth(label), term };
      });
      const seqWidth = termWidths.reduce((total, item, index) => total + item.width + (index < termWidths.length - 1 ? 24 : 0), 0);
      const loopSepWidths = loopSeparator.map((term) => {
        const label = term.type === "nonterminal" ? `<${term.value}>` : term.type === "epsilon" ? "ε" : `"${term.value}"`;
        return { label, width: measureTermWidth(label), term };
      });
      const sepTotalWidth = loopSepWidths.reduce((total, item, index) => total + item.width + (index > 0 ? 24 : 0), 0);
      const mainLaneY = branchTop;
      const joinOutX = laneStartX + seqWidth + laneExitGap + 60;
      const endX = joinOutX + endCapGap;
      const loopDepth = loopSeparator.length > 0 ? 78 : 58;
      const loopY = mainLaneY + loopDepth;

      appendRuleTitleAndEndpoints(ruleName, ruleTop, mainLaneY, endX);
      body += `<line class="rail-line" x1="${joinX - incomingLead}" y1="${mainLaneY}" x2="${laneStartX}" y2="${mainLaneY}" />`;
      body += buildArrowOnSegment(joinX - incomingLead, mainLaneY, laneStartX, mainLaneY);

      let cursorX = laneStartX;
      termWidths.forEach(({ term, label, width }, termIndex) => {
        const boxX = cursorX;
        const boxY = mainLaneY - 17;
        const boxClass = term.type === "nonterminal" ? "rail-node-nonterminal" : term.type === "epsilon" ? "rail-node-epsilon" : "rail-node-terminal";
        const labelClass = term.type === "nonterminal" ? "rail-label-nonterminal" : term.type === "epsilon" ? "rail-label-epsilon" : "rail-label-terminal";
        const radius = term.type === "nonterminal" ? 0 : 10;
        body += `<rect class="${boxClass}" x="${boxX}" y="${boxY}" width="${width}" height="34" rx="${radius}" ry="${radius}" />`;
        body += `<text class="${labelClass}" x="${boxX + width / 2}" y="${mainLaneY}" text-anchor="middle">${escapeXml(label)}</text>`;
        cursorX += width;
        if (termIndex < termWidths.length - 1) {
          body += `<line class="rail-line" x1="${cursorX}" y1="${mainLaneY}" x2="${cursorX + 24}" y2="${mainLaneY}" />`;
          cursorX += 24;
        }
      });

      body += `<line class="rail-line" x1="${cursorX}" y1="${mainLaneY}" x2="${endX - 16}" y2="${mainLaneY}" />`;
      body += `<path class="rail-line rail-line-alt" d="M ${joinOutX} ${mainLaneY} V ${loopY}" />`;
      body += `<path class="rail-line rail-line-alt" d="M ${joinX} ${loopY} V ${mainLaneY}" />`;
      if (loopSepWidths.length === 0) {
        body += `<line class="rail-line rail-line-alt" x1="${joinOutX}" y1="${loopY}" x2="${joinX}" y2="${loopY}" />`;
        body += buildArrowOnSegment(joinOutX, loopY, joinX, loopY);
      } else {
        const arcMidX = Math.round((joinX + joinOutX) / 2);
        const sepBoxStartX = arcMidX - Math.round(sepTotalWidth / 2);
        body += `<line class="rail-line rail-line-alt" x1="${joinOutX}" y1="${loopY}" x2="${sepBoxStartX}" y2="${loopY}" />`;
        let sepCursorX = sepBoxStartX;
        loopSepWidths.forEach(({ term, label, width }, sepIndex) => {
          const boxX = sepCursorX;
          const boxY = loopY - 17;
          const boxClass = term.type === "nonterminal" ? "rail-node-nonterminal" : term.type === "epsilon" ? "rail-node-epsilon" : "rail-node-terminal";
          const labelClass = term.type === "nonterminal" ? "rail-label-nonterminal" : term.type === "epsilon" ? "rail-label-epsilon" : "rail-label-terminal";
          const radius = term.type === "nonterminal" ? 0 : 10;
          body += `<rect class="${boxClass}" x="${boxX}" y="${boxY}" width="${width}" height="34" rx="${radius}" ry="${radius}" />`;
          body += `<text class="${labelClass}" x="${boxX + width / 2}" y="${loopY}" text-anchor="middle">${escapeXml(label)}</text>`;
          sepCursorX += width;
          if (sepIndex < loopSepWidths.length - 1) {
            body += `<line class="rail-line rail-line-alt" x1="${sepCursorX}" y1="${loopY}" x2="${sepCursorX + 24}" y2="${loopY}" />`;
            sepCursorX += 24;
          }
        });
        body += `<line class="rail-line rail-line-alt" x1="${sepCursorX}" y1="${loopY}" x2="${joinX}" y2="${loopY}" />`;
        body += buildArrowOnSegment(sepCursorX, loopY, joinX, loopY);
      }

      totalHeight = loopY + ruleGap;
      maxWidth.value = Math.max(maxWidth.value, endX + canvasSideInset - 16);
    } else if (loopPattern === null) {
      const laneYs = alternatives.map((_, index) => branchTop + index * laneGap);
      const mainLaneY = laneYs[Math.floor((laneYs.length - 1) / 2)] || branchTop;
      const preparedAlternatives = alternatives.map((sequence) => {
        const terms = sequence.length === 0 ? [{ type: "epsilon", value: "ε" }] : sequence;
        const widths = terms.map((term) => {
          const label = term.type === "nonterminal" ? `<${term.value}>` : term.type === "epsilon" ? "ε" : `"${term.value}"`;
          return { label, width: measureTermWidth(label), term };
        });
        const sequenceWidth = widths.reduce((total, item, index) => total + item.width + (index < widths.length - 1 ? 24 : 0), 0);
        return { terms: widths, width: sequenceWidth };
      });
      const longestSequence = preparedAlternatives.reduce((widest, alternative) => Math.max(widest, alternative.width), 0);
      const laneMergeX = laneStartX + longestSequence + laneExitGap;
      const joinOutX = laneMergeX + 60;
      const endX = joinOutX + endCapGap;
      appendRuleTitleAndEndpoints(ruleName, ruleTop, mainLaneY, endX);
      const branchBottom = branchTop + Math.max(0, alternatives.length - 1) * laneGap;
      const nonMainLaneYs = laneYs.filter((laneY) => laneY !== mainLaneY);

      if (nonMainLaneYs.length > 0) {
        const spineTopY = Math.min(...nonMainLaneYs);
        const spineBottomY = Math.max(...nonMainLaneYs);
        if (spineTopY < mainLaneY) {
          body += `<path class="rail-line rail-line-alt" d="M ${joinX} ${mainLaneY} V ${spineTopY}" />`;
          body += `<path class="rail-line rail-line-alt" d="M ${joinOutX} ${spineTopY} V ${mainLaneY}" />`;
        }
        if (spineBottomY > mainLaneY) {
          body += `<path class="rail-line rail-line-alt" d="M ${joinX} ${mainLaneY} V ${spineBottomY}" />`;
          body += `<path class="rail-line rail-line-alt" d="M ${joinOutX} ${spineBottomY} V ${mainLaneY}" />`;
        }
      }

      preparedAlternatives.forEach((prepared, index) => {
        const laneY = laneYs[index];
        let cursorX = laneStartX;

        if (laneY === mainLaneY) {
          body += `<line class="rail-line" x1="${joinX - incomingLead}" y1="${laneY}" x2="${laneStartX}" y2="${laneY}" />`;
          body += buildArrowOnSegment(joinX - incomingLead, laneY, laneStartX, laneY);
        } else {
          body += `<line class="rail-line rail-line-alt" x1="${joinX}" y1="${laneY}" x2="${laneStartX}" y2="${laneY}" />`;
        }

        prepared.terms.forEach(({ term, label, width }, termIndex) => {
          const boxX = cursorX;
          const boxY = laneY - 17;
          const boxClass = term.type === "nonterminal"
            ? "rail-node-nonterminal"
            : term.type === "epsilon"
              ? "rail-node-epsilon"
              : "rail-node-terminal";
          const labelClass = term.type === "nonterminal"
            ? "rail-label-nonterminal"
            : term.type === "epsilon"
              ? "rail-label-epsilon"
              : "rail-label-terminal";
          const radius = term.type === "nonterminal" ? 0 : 10;

          body += `<rect class="${boxClass}" x="${boxX}" y="${boxY}" width="${width}" height="34" rx="${radius}" ry="${radius}" />`;
          body += `<text class="${labelClass}" x="${boxX + width / 2}" y="${laneY}" text-anchor="middle">${escapeXml(label)}</text>`;

          cursorX += width;
          if (termIndex < prepared.terms.length - 1) {
            body += `<line class="rail-line" x1="${cursorX}" y1="${laneY}" x2="${cursorX + 24}" y2="${laneY}" />`;
            cursorX += 24;
          }
        });

        if (laneY === mainLaneY) {
          body += `<line class="rail-line" x1="${cursorX}" y1="${laneY}" x2="${endX - 16}" y2="${laneY}" />`;
        } else {
          body += `<line class="rail-line rail-line-alt" x1="${cursorX}" y1="${laneY}" x2="${joinOutX}" y2="${laneY}" />`;
        }
      });

      totalHeight = branchBottom + ruleGap;
      maxWidth.value = Math.max(maxWidth.value, endX + canvasSideInset - 16);
    }
  }

  const defs = [
    '<defs>',
    '  <pattern id="railGrid" width="28" height="28" patternUnits="userSpaceOnUse">',
    '    <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1" />',
    '  </pattern>',
    '  <linearGradient id="terminalFill" x1="0" y1="0" x2="0" y2="1">',
    '    <stop offset="0%" stop-color="#fff6df" />',
    '    <stop offset="100%" stop-color="#d6c7a8" />',
    '  </linearGradient>',
    '  <linearGradient id="nonterminalFill" x1="0" y1="0" x2="0" y2="1">',
    '    <stop offset="0%" stop-color="#f2fbff" />',
    '    <stop offset="100%" stop-color="#c8edf9" />',
    '  </linearGradient>',
    '  <linearGradient id="epsilonFill" x1="0" y1="0" x2="0" y2="1">',
    '    <stop offset="0%" stop-color="#f8f4ff" />',
    '    <stop offset="100%" stop-color="#ded2ff" />',
    '  </linearGradient>',
    '</defs>'
  ].join("");

  const railElementPattern = /<(line|path) class="rail-line[^"]*"[^>]*\/>/g;
  const railLayer = body.match(railElementPattern)?.join("") ?? "";
  const nodeLayer = body.replace(railElementPattern, "");

  function insetLineForFlow(element) {
    return element.replace(/class="rail-line([^"]*)"/g, 'class="rail-flow$1"');
  }

  function insetPathForFlow(element, inset = 4) {
    return element.replace(/class="rail-line([^"]*)"/g, 'class="rail-flow$1"');
  }

  const animatedRailLayer = railLayer.replace(/<(line|path) class="rail-line[^"]*"[^>]*\/>/g, (element, tag) => {
    return tag === "line" ? insetLineForFlow(element) : insetPathForFlow(element);
  });

  return {
    width: Math.max(320, maxWidth.value),
    height: Math.max(220, totalHeight + 14),
    markup: `${defs}<rect class="rail-backdrop" x="10" y="10" width="${Math.max(300, maxWidth.value - 20)}" height="${Math.max(200, totalHeight - 6)}" rx="18" ry="18" /><rect class="rail-grid" x="10" y="10" width="${Math.max(300, maxWidth.value - 20)}" height="${Math.max(200, totalHeight - 6)}" rx="18" ry="18" />${railLayer}${animatedRailLayer}${nodeLayer}`
  };
}
