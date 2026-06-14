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
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const length = Math.hypot(deltaX, deltaY);
  if (length < 1) {
    return "";
  }

  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const clampedPosition = Math.max(0.12, Math.min(0.88, position));
  const anchorX = startX + deltaX * clampedPosition;
  const anchorY = startY + deltaY * clampedPosition;
  const arrowSpan = Math.max(10, Math.min(16, length * 0.45));
  const halfSpan = arrowSpan / 2;
  const arrowStartX = anchorX - unitX * halfSpan;
  const arrowStartY = anchorY - unitY * halfSpan;
  const arrowEndX = anchorX + unitX * halfSpan;
  const arrowEndY = anchorY + unitY * halfSpan;

  return `<line class="rail-arrow" x1="${arrowStartX.toFixed(2)}" y1="${arrowStartY.toFixed(2)}" x2="${arrowEndX.toFixed(2)}" y2="${arrowEndY.toFixed(2)}" />`;
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

  // Pattern B: one epsilon alternative + one or more recursive alternatives (each ending in self-ref)
  const isEpsilon = (alt) => alt.length === 0 || (alt.length === 1 && alt[0].type === "epsilon");
  const isRecursive = (alt) => alt.length > 0 && alt[alt.length - 1].type === "nonterminal" && alt[alt.length - 1].value === ruleName;
  const epsilonAlts = alternatives.filter(isEpsilon);
  const recursiveAlts = alternatives.filter(isRecursive);

  if (epsilonAlts.length === 1 && recursiveAlts.length >= 1 && epsilonAlts.length + recursiveAlts.length === alternatives.length) {
    return { type: "multi", bodyAlternatives: recursiveAlts.map((alt) => alt.slice(0, alt.length - 1)) };
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
    const loopPattern = detectLoopPattern(ruleName, alternatives);

    if (loopPattern !== null && loopPattern.type === "multi") {
      const { bodyAlternatives } = loopPattern;
      const preparedBodies = bodyAlternatives.map((sequence) => {
        const terms = sequence.length === 0 ? [{ type: "epsilon", value: "\u03b5" }] : sequence;
        const widths = terms.map((term) => {
          const label = term.type === "nonterminal" ? `<${term.value}>` : term.type === "epsilon" ? "\u03b5" : `\u201c${term.value}\u201d`;
          return { label, width: measureTermWidth(label), term };
        });
        const seqW = widths.reduce((total, item, index) => total + item.width + (index < widths.length - 1 ? 24 : 0), 0);
        return { terms: widths, width: seqW };
      });
      const bodyMaxWidth = preparedBodies.reduce((max, b) => Math.max(max, b.width), 0);
      const mainLaneY = branchTop;
      const joinOutX = laneStartX + bodyMaxWidth + laneExitGap + 60;
      const endX = joinOutX + endCapGap;
      const bodyGap = 58;
      const bodyLaneYs = preparedBodies.map((_, i) => mainLaneY + bodyGap + i * laneGap);
      const deepestLoopY = bodyLaneYs[bodyLaneYs.length - 1] || mainLaneY;

      body += `<text class="rail-title" x="${ruleLabelX}" y="${mainLaneY}" text-anchor="end">&lt;${escapeXml(ruleName)}&gt;</text>`;
      // Main pass-through (the epsilon alternative) - single unbroken horizontal
      body += `<line class="rail-line" x1="${joinX - incomingLead}" y1="${mainLaneY}" x2="${endX - 16}" y2="${mainLaneY}" />`;
      body += buildArrowOnSegment(joinX - incomingLead, mainLaneY, endX - 16, mainLaneY);
      // Left and right vertical spines shared by all loop arcs
      body += `<path class="rail-line rail-line-alt" d="M ${joinX} ${mainLaneY} V ${deepestLoopY}" />`;
      body += `<path class="rail-line rail-line-alt" d="M ${joinOutX} ${mainLaneY} V ${deepestLoopY}" />`;

      preparedBodies.forEach((prepared, index) => {
        const loopY = bodyLaneYs[index];
        // Left stub: from left spine to first term
        body += `<line class="rail-line rail-line-alt" x1="${joinX}" y1="${loopY}" x2="${laneStartX}" y2="${loopY}" />`;
        let cursorX = laneStartX;
        prepared.terms.forEach(({ term, label, width }, termIndex) => {
          const boxX = cursorX;
          const boxY = loopY - 17;
          const boxClass = term.type === "nonterminal" ? "rail-node-nonterminal" : term.type === "epsilon" ? "rail-node-epsilon" : "rail-node-terminal";
          const labelClass = term.type === "nonterminal" ? "rail-label-nonterminal" : term.type === "epsilon" ? "rail-label-epsilon" : "rail-label-terminal";
          const radius = term.type === "nonterminal" ? 8 : 18;
          body += `<rect class="${boxClass}" x="${boxX}" y="${boxY}" width="${width}" height="34" rx="${radius}" ry="${radius}" />`;
          body += `<text class="${labelClass}" x="${boxX + width / 2}" y="${loopY}" text-anchor="middle">${escapeXml(label)}</text>`;
          cursorX += width;
          if (termIndex < prepared.terms.length - 1) {
            body += `<line class="rail-line rail-line-alt" x1="${cursorX}" y1="${loopY}" x2="${cursorX + 24}" y2="${loopY}" />`;
            cursorX += 24;
          }
        });
        // Right stub: from last term to right spine (padded to bodyMaxWidth for alignment)
        body += `<line class="rail-line rail-line-alt" x1="${cursorX + laneExitGap}" y1="${loopY}" x2="${joinOutX}" y2="${loopY}" />`;
        // Arrow pointing left (loop-back direction)
        body += buildArrowOnSegment(cursorX + laneExitGap, loopY, joinX, loopY);
      });

      totalHeight = deepestLoopY + ruleGap;
      maxWidth.value = Math.max(maxWidth.value, endX + 44);
    } else if (loopPattern !== null) {
      const { base: loopBase, separator: loopSeparator } = loopPattern;
      const baseTerms = loopBase.length === 0 ? [{ type: "epsilon", value: "ε" }] : loopBase;
      const termWidths = baseTerms.map((term) => {
        const label = term.type === "nonterminal" ? `<${term.value}>` : term.type === "epsilon" ? "ε" : `\u201c${term.value}\u201d`;
        return { label, width: measureTermWidth(label), term };
      });
      const seqWidth = termWidths.reduce((total, item, index) => total + item.width + (index < termWidths.length - 1 ? 24 : 0), 0);
      const loopSepWidths = loopSeparator.map((term) => {
        const label = term.type === "nonterminal" ? `<${term.value}>` : term.type === "epsilon" ? "ε" : `\u201c${term.value}\u201d`;
        return { label, width: measureTermWidth(label), term };
      });
      const sepTotalWidth = loopSepWidths.reduce((total, item, index) => total + item.width + (index > 0 ? 24 : 0), 0);
      const mainLaneY = branchTop;
      const joinOutX = laneStartX + seqWidth + laneExitGap + 60;
      const endX = joinOutX + endCapGap;
      const loopDepth = loopSeparator.length > 0 ? 78 : 58;
      const loopY = mainLaneY + loopDepth;

      body += `<text class="rail-title" x="${ruleLabelX}" y="${mainLaneY}" text-anchor="end">&lt;${escapeXml(ruleName)}&gt;</text>`;
      body += `<line class="rail-line" x1="${joinX - incomingLead}" y1="${mainLaneY}" x2="${laneStartX}" y2="${mainLaneY}" />`;
      body += buildArrowOnSegment(joinX - incomingLead, mainLaneY, laneStartX, mainLaneY);
      body += `<line class="rail-line" x1="${laneStartX + seqWidth + laneExitGap}" y1="${mainLaneY}" x2="${endX - 16}" y2="${mainLaneY}" />`;
      body += buildArrowOnSegment(laneStartX + seqWidth + laneExitGap, mainLaneY, endX - 16, mainLaneY);

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
          const radius = term.type === "nonterminal" ? 8 : 18;
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
      maxWidth.value = Math.max(maxWidth.value, endX + 44);
    } else if (loopPattern === null) {
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
      const laneMergeX = laneStartX + longestSequence + laneExitGap;
      const joinOutX = laneMergeX + 60;
      const endX = joinOutX + endCapGap;
      const branchBottom = branchTop + Math.max(0, alternatives.length - 1) * laneGap;
      const nonMainLaneYs = laneYs.filter((laneY) => laneY !== mainLaneY);
      const topMergeLaneY = nonMainLaneYs.length ? Math.min(...nonMainLaneYs) : null;
      const bottomMergeLaneY = nonMainLaneYs.length ? Math.max(...nonMainLaneYs) : null;

      preparedAlternatives.forEach((prepared, index) => {
        const laneY = laneYs[index];
        let cursorX = laneStartX;

        if (laneY === mainLaneY) {
          body += `<line class="rail-line" x1="${joinX - incomingLead}" y1="${laneY}" x2="${laneStartX}" y2="${laneY}" />`;
          body += buildArrowOnSegment(joinX - incomingLead, laneY, laneStartX, laneY);
          body += `<line class="rail-line" x1="${cursorX + prepared.width + laneExitGap}" y1="${laneY}" x2="${laneMergeX}" y2="${laneY}" />`;
          body += `<line class="rail-line" x1="${laneMergeX}" y1="${laneY}" x2="${endX - 16}" y2="${laneY}" />`;
          body += buildArrowOnSegment(laneMergeX, laneY, endX - 16, laneY);
        } else {
          body += `<path class="rail-line rail-line-alt" d="${buildOrthogonalPath(joinX, mainLaneY, laneStartX, laneY)}" />`;
          body += `<line class="rail-line rail-line-alt" x1="${cursorX + prepared.width + laneExitGap}" y1="${laneY}" x2="${laneMergeX}" y2="${laneY}" />`;
          body += `<path class="rail-line rail-line-alt" d="${buildOrthogonalPath(laneMergeX, laneY, joinOutX, mainLaneY)}" />`;
          if (laneY === topMergeLaneY || laneY === bottomMergeLaneY) {
            body += buildVerticalMergeArrowForOrthogonalPath(laneMergeX, laneY, joinOutX, mainLaneY);
          }
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
    '  <marker id="railChevron" viewBox="0 0 12 12" markerWidth="12" markerHeight="12" refX="10.8" refY="6" orient="auto" markerUnits="userSpaceOnUse">',
    '    <path d="M 2 1 L 11 6 L 2 11" fill="none" stroke="#ffd86b" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />',
    '  </marker>',
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
