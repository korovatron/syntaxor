export const APP_VERSION = "0.1.0";

export const EXAMPLES = {
  arithmetic: {
    title: "Arithmetic expression",
    grammar: [
      '<expression> ::= <term> <expression-tail>',
      '<expression-tail> ::= "+" <term> <expression-tail> | "-" <term> <expression-tail> | ""',
      '<term> ::= <factor> <term-tail>',
      '<term-tail> ::= "*" <factor> <term-tail> | "/" <factor> <term-tail> | ""',
      '<factor> ::= <number> | "(" <expression> ")"',
      '<number> ::= <digit> <number-tail>',
      '<number-tail> ::= <digit> <number-tail> | ""',
      '<digit> ::= "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"'
    ].join("\n"),
    samples: [
      { input: "2+3*4", expected: true },
      { input: "(8-3)/5", expected: true },
      { input: "7+", expected: false }
    ]
  },
  identifier: {
    title: "Identifier",
    grammar: [
      '<identifier> ::= <letter> <identifier-tail>',
      '<identifier-tail> ::= <letter> <identifier-tail> | <digit> <identifier-tail> | "_" <identifier-tail> | ""',
      '<letter> ::= "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"',
      '<digit> ::= "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"'
    ].join("\n"),
    samples: [
      { input: "student_7", expected: true },
      { input: "alpha2", expected: true },
      { input: "2cool", expected: false }
    ]
  },
  sentence: {
    title: "Tiny sentence",
    grammar: [
      '<sentence> ::= <subject> " " <verb> " " <object>',
      '<subject> ::= "the cat" | "the robot" | "a student"',
      '<verb> ::= "writes" | "tests" | "builds"',
      '<object> ::= "rules" | "a parser" | "a diagram"'
    ].join("\n"),
    samples: [
      { input: "the robot builds a parser", expected: true },
      { input: "a student tests rules", expected: true },
      { input: "robot builds a parser", expected: false }
    ]
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
        terms.push({ type: "terminal", value: token });
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

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const trimmedLine = rawLine.trim();
    const lineNumber = lineIndex + 1;

    if (!trimmedLine || trimmedLine.startsWith("#") || trimmedLine.startsWith("//")) {
      continue;
    }

    const match = trimmedLine.match(/^<([^<>]+)>\s*::=\s*(.*)$/);
    if (!match) {
      throw new Error(`Line ${lineNumber}: expected <rule> ::= production.`);
    }

    const name = match[1].trim();
    const rhs = match[2] || "";

    if (!rules.has(name)) {
      rules.set(name, []);
      ruleOrder.push(name);
    }

    const alternatives = splitAlternatives(rhs).map((part) => {
      if (!part) {
        return [];
      }

      const parsedTerms = parseSequence(part, lineNumber);
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

    rules.get(name).push(...alternatives);
  }

  if (ruleOrder.length === 0) {
    throw new Error("Enter at least one BNF rule.");
  }

  for (const [ruleName, alternatives] of rules.entries()) {
    const recursive = alternatives.some((alternative) => alternative[0]?.type === "nonterminal" && alternative[0].value === ruleName);
    if (recursive) {
      warnings.push(`Direct left recursion on <${ruleName}> is not supported by this tester.`);
    }
  }

  for (const symbol of referenced) {
    if (!rules.has(symbol)) {
      warnings.push(`Referenced non-terminal <${symbol}> has no definition.`);
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
  const blocked = new Set();
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

    if (visiting.has(key)) {
      blocked.add(symbol);
      return new Set();
    }

    const alternatives = grammar.rules.get(symbol);
    if (!alternatives) {
      return new Set();
    }

    visiting.add(key);
    const results = new Set();

    for (const alternative of alternatives) {
      const endPositions = alternative.length === 0
        ? new Set([startPosition])
        : matchSequence(alternative, startPosition, visiting);

      for (const endPosition of endPositions) {
        results.add(endPosition);
      }
    }

    visiting.delete(key);
    memo.set(key, results);
    return results;
  }

  const matches = matchNonTerminal(grammar.startSymbol, 0, new Set());
  const accepted = matches.has(input.length);

  return {
    accepted,
    furthest,
    blocked: [...blocked],
    grammar,
    matches: [...matches].sort((left, right) => left - right)
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

function buildCurvePath(startX, startY, endX, endY) {
  const deltaX = endX - startX;
  const controlOffset = Math.max(22, Math.abs(deltaX) * 0.45);
  return [
    `M ${startX} ${startY}`,
    `C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`
  ].join(" ");
}

function detectLoopPattern(ruleName, alternatives) {
  if (alternatives.length !== 2) return null;

  const [alt1, alt2] = alternatives;

  function same(a, b) {
    return a.type === b.type && a.value === b.value;
  }

  if (
    alt2.length === alt1.length + 1 &&
    alt2[alt2.length - 1].type === "nonterminal" &&
    alt2[alt2.length - 1].value === ruleName &&
    alt1.every((term, i) => same(term, alt2[i]))
  ) {
    return alt1;
  }

  if (
    alt1.length === alt2.length + 1 &&
    alt1[alt1.length - 1].type === "nonterminal" &&
    alt1[alt1.length - 1].value === ruleName &&
    alt2.every((term, i) => same(term, alt1[i]))
  ) {
    return alt2;
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
  const labelGap = 12;
  const labelReserve = activeRules.reduce((widest, name) => {
    const estimated = Math.max(70, name.length * 10 + 36);
    return Math.max(widest, estimated);
  }, 70);
  const joinX = Math.max(176, labelReserve + incomingLead + labelGap + 20);
  const ruleLabelX = joinX - incomingLead - labelGap;
  const laneStartX = joinX + 60;
  const laneExitGap = 26;
  const endCapGap = 38;
  const maxWidth = { value: 0 };
  let totalHeight = 36;
  let body = "";

  for (const ruleName of activeRules) {
    const alternatives = grammar.rules.get(ruleName) || [];
    const ruleTop = totalHeight;
    const branchTop = ruleTop + titleGap;
    const loopBase = detectLoopPattern(ruleName, alternatives);

    if (loopBase !== null) {
      const baseTerms = loopBase.length === 0 ? [{ type: "epsilon", value: "ε" }] : loopBase;
      const termWidths = baseTerms.map((term) => {
        const label = term.type === "nonterminal" ? `<${term.value}>` : term.type === "epsilon" ? "ε" : `\u201c${term.value}\u201d`;
        return { label, width: measureTermWidth(label), term };
      });
      const seqWidth = termWidths.reduce((total, item, index) => total + item.width + (index < termWidths.length - 1 ? 24 : 0), 0);
      const mainLaneY = branchTop;
      const joinOutX = laneStartX + seqWidth + laneExitGap + 60;
      const endX = joinOutX + endCapGap;
      const loopDepth = 58;
      const loopY = mainLaneY + loopDepth;

      body += `<text class="rail-title" x="${ruleLabelX}" y="${mainLaneY}" text-anchor="end">&lt;${escapeXml(ruleName)}&gt;</text>`;
      body += `<line class="rail-line" x1="${joinX - incomingLead}" y1="${mainLaneY}" x2="${joinX}" y2="${mainLaneY}" />`;
      body += `<circle class="rail-dot-start" cx="${joinX - incomingLead - 10}" cy="${mainLaneY}" r="6" />`;
      body += `<line class="rail-line" x1="${joinOutX}" y1="${mainLaneY}" x2="${endX - 16}" y2="${mainLaneY}" />`;
      body += `<circle class="rail-dot-end" cx="${endX}" cy="${mainLaneY}" r="6" />`;
      body += `<line class="rail-line" x1="${joinX}" y1="${mainLaneY}" x2="${laneStartX}" y2="${mainLaneY}" />`;
      body += `<line class="rail-line" x1="${laneStartX + seqWidth + laneExitGap}" y1="${mainLaneY}" x2="${joinOutX}" y2="${mainLaneY}" />`;

      let cursorX = laneStartX;
      termWidths.forEach(({ term, label, width }, termIndex) => {
        const boxX = cursorX;
        const boxY = mainLaneY - 17;
        const boxClass = term.type === "nonterminal" ? "rail-node-nonterminal" : term.type === "epsilon" ? "rail-node-epsilon" : "rail-node-terminal";
        const labelClass = term.type === "nonterminal" ? "rail-label-nonterminal" : term.type === "epsilon" ? "rail-label-epsilon" : "rail-label-terminal";
        const radius = term.type === "nonterminal" ? 8 : 18;
        body += `<rect class="${boxClass}" x="${boxX}" y="${boxY}" width="${width}" height="34" rx="${radius}" ry="${radius}" />`;
        body += `<text class="${labelClass}" x="${boxX + width / 2}" y="${mainLaneY}" text-anchor="middle">${escapeXml(label)}</text>`;
        cursorX += width;
        if (termIndex < termWidths.length - 1) {
          body += `<line class="rail-line" x1="${cursorX}" y1="${mainLaneY}" x2="${cursorX + 24}" y2="${mainLaneY}" />`;
          cursorX += 24;
        }
      });

      body += `<line class="rail-line" x1="${cursorX}" y1="${mainLaneY}" x2="${cursorX + laneExitGap}" y2="${mainLaneY}" />`;
      const loopMidX = Math.round((joinX + joinOutX) / 2);
      const arrowY = Math.round(mainLaneY * 0.25 + loopY * 0.75);
      body += `<path class="rail-line rail-line-alt" d="M ${joinOutX} ${mainLaneY} C ${joinOutX} ${loopY}, ${joinX} ${loopY}, ${joinX} ${mainLaneY}" />`;
      body += `<polygon class="rail-loop-arrow" points="${loopMidX - 8},${arrowY} ${loopMidX + 6},${arrowY - 7} ${loopMidX + 6},${arrowY + 7}" />`;

      totalHeight = loopY + ruleGap;
      maxWidth.value = Math.max(maxWidth.value, endX + 44);
    } else {
      const laneYs = alternatives.map((_, index) => branchTop + index * laneGap);
      const mainLaneY = laneYs[Math.floor((laneYs.length - 1) / 2)] || branchTop;
      body += `<text class="rail-title" x="${ruleLabelX}" y="${mainLaneY}" text-anchor="end">&lt;${escapeXml(ruleName)}&gt;</text>`;
      const preparedAlternatives = alternatives.map((sequence) => {
        const terms = sequence.length === 0 ? [{ type: "epsilon", value: "ε" }] : sequence;
        const widths = terms.map((term) => {
          const label = term.type === "nonterminal" ? `<${term.value}>` : term.type === "epsilon" ? "ε" : `\u201c${term.value}\u201d`;
          return { label, width: measureTermWidth(label), term };
        });
        const sequenceWidth = widths.reduce((total, item, index) => total + item.width + (index < widths.length - 1 ? 24 : 0), 0);
        return { terms: widths, width: sequenceWidth };
      });
      const longestSequence = preparedAlternatives.reduce((widest, alternative) => Math.max(widest, alternative.width), 0);
      const joinOutX = laneStartX + longestSequence + laneExitGap + 60;
      const endX = joinOutX + endCapGap;
      const branchBottom = branchTop + Math.max(0, alternatives.length - 1) * laneGap;

      body += `<line class="rail-line" x1="${joinX - incomingLead}" y1="${mainLaneY}" x2="${joinX}" y2="${mainLaneY}" />`;
      body += `<circle class="rail-dot-start" cx="${joinX - incomingLead - 10}" cy="${mainLaneY}" r="6" />`;
      body += `<line class="rail-line" x1="${joinOutX}" y1="${mainLaneY}" x2="${endX - 16}" y2="${mainLaneY}" />`;
      body += `<circle class="rail-dot-end" cx="${endX}" cy="${mainLaneY}" r="6" />`;

      preparedAlternatives.forEach((prepared, index) => {
        const laneY = laneYs[index];
        let cursorX = laneStartX;

        if (laneY === mainLaneY) {
          body += `<line class="rail-line" x1="${joinX}" y1="${laneY}" x2="${laneStartX}" y2="${laneY}" />`;
          body += `<line class="rail-line" x1="${cursorX + prepared.width + laneExitGap}" y1="${laneY}" x2="${joinOutX}" y2="${laneY}" />`;
        } else {
          body += `<path class="rail-line rail-line-alt" d="${buildCurvePath(joinX, mainLaneY, laneStartX, laneY)}" />`;
          body += `<path class="rail-line rail-line-alt" d="${buildCurvePath(cursorX + prepared.width + laneExitGap, laneY, joinOutX, mainLaneY)}" />`;
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
          const radius = term.type === "nonterminal" ? 8 : 18;

          body += `<rect class="${boxClass}" x="${boxX}" y="${boxY}" width="${width}" height="34" rx="${radius}" ry="${radius}" />`;
          body += `<text class="${labelClass}" x="${boxX + width / 2}" y="${laneY}" text-anchor="middle">${escapeXml(label)}</text>`;

          cursorX += width;
          if (termIndex < prepared.terms.length - 1) {
            body += `<line class="rail-line" x1="${cursorX}" y1="${laneY}" x2="${cursorX + 24}" y2="${laneY}" />`;
            cursorX += 24;
          }
        });

        body += `<line class="rail-line" x1="${cursorX}" y1="${laneY}" x2="${cursorX + laneExitGap}" y2="${laneY}" />`;
      });

      totalHeight = branchBottom + ruleGap;
      maxWidth.value = Math.max(maxWidth.value, endX + 44);
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

  return {
    width: Math.max(320, maxWidth.value),
    height: Math.max(220, totalHeight + 14),
    markup: `${defs}<rect class="rail-backdrop" x="10" y="10" width="${Math.max(300, maxWidth.value - 20)}" height="${Math.max(200, totalHeight - 6)}" rx="18" ry="18" /><rect class="rail-grid" x="10" y="10" width="${Math.max(300, maxWidth.value - 20)}" height="${Math.max(200, totalHeight - 6)}" rx="18" ry="18" />${body}`
  };
}
