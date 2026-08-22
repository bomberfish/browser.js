import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";
import { StyleManager } from "./stylemanager";

function serializeStyle(
	style: CSSStyleDeclaration,
	styleSheetId?: string
): Protocol.CSS.CSSStyle {
	return {
		...parseStyleDeclarations(style.cssText),
		styleSheetId,
	};
}

export function parseStyleDeclarations(
	blockText: string,
	baseLineOffset = 0,
	baseColOffset = 0
): Protocol.CSS.CSSStyle {
	const declarations = blockText
		.split(";")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => s + ";");

	const cssProperties: Protocol.CSS.CSSProperty[] = [];

	declarations.forEach((lineText, idx) => {
		const colonIdx = lineText.indexOf(":");
		if (colonIdx === -1) return;

		const currentLine = baseLineOffset + idx;
		const startCol = idx === 0 ? baseColOffset : 0;

		const name = lineText.slice(0, colonIdx).trim();
		let value = lineText
			.slice(colonIdx + 1)
			.replace(/;$/, "")
			.trim();

		const important = value.includes("!important");
		if (important) {
			value = value.replace(/!important$/, "").trim();
		}

		cssProperties.push({
			name,
			value,
			important,
			text: lineText,
			range: {
				startLine: currentLine,
				startColumn: startCol,
				endLine: currentLine,
				endColumn: startCol + lineText.length,
			},
		});
	});

	const formattedCssText = cssProperties.map((p) => p.text).join("\n");
	const lastLineIdx = Math.max(0, cssProperties.length - 1);
	const lastLineLen = cssProperties[lastLineIdx]?.text?.length || 0;

	return {
		cssText: formattedCssText,
		cssProperties,
		shorthandEntries: [],
		range: {
			startLine: baseLineOffset,
			startColumn: baseColOffset,
			endLine: baseLineOffset + lastLineIdx,
			endColumn:
				baseLineOffset === baseLineOffset + lastLineIdx
					? baseColOffset + lastLineLen
					: lastLineLen,
		},
	};
}

function spliceRange(
	src: string | undefined,
	range: Protocol.CSS.SourceRange,
	replacement: string
): string {
	const text = src || "";
	const lines = text.split("\n");
	let start = 0;
	for (let i = 0; i < range.startLine; i++) {
		start += lines[i].length + 1; // +1 for newline
	}
	start += range.startColumn;
	let end = 0;
	for (let i = 0; i < range.endLine; i++) {
		end += lines[i].length + 1; // +1 for newline
	}
	end += range.endColumn;

	return text.slice(0, start) + replacement + text.slice(end);
}

function serializeComputedStyle(
	props: CSSStyleDeclaration
): Protocol.CSS.CSSComputedStyleProperty[] {
	return Array.from(props).map((name) => ({
		name: name,
		value: props.getPropertyValue(name),
	}));
}

bindCDP("CSS.enable", async function () {
	for (const styleSheet of document.styleSheets) {
		if (styleSheet instanceof CSSStyleSheet) {
			this.styles.register(styleSheet);
		}
	}
	this.cssEnabled = true;
});

bindCDP("CSS.disable", async function () {
	this.cssEnabled = false;
});

bindCDP("CSS.getComputedStyleForNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);
	if (node instanceof Element) {
		return {
			computedStyle: serializeComputedStyle(getComputedStyle(node)),
		};
	} else {
		return {
			computedStyle: [],
		};
	}
});

bindCDP("CSS.getInlineStylesForNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);
	if (node instanceof HTMLElement) {
		return {
			inlineStyle: serializeStyle(node.style, `inline-${nodeId}`),
			attributesStyle: null,
		};
	} else {
		return {
			inlineStyle: null,
			attributesStyle: null,
		};
	}
});

bindCDP("CSS.getMatchedStylesForNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);
	const matchedCSSRules: Protocol.CSS.RuleMatch[] = [];
	for (const styleSheet of document.styleSheets) {
		if (styleSheet instanceof CSSStyleSheet) {
			try {
				for (const rule of styleSheet.cssRules) {
					if (rule instanceof CSSStyleRule) {
						if (node instanceof Element && node.matches(rule.selectorText)) {
							console.log("Matched css rule:", rule.cssText);
							const selectors = rule.selectorText
								.split(",")
								.map((s) => s.trim());
							let id;
							if (this.styles.has(rule.parentStyleSheet || styleSheet)) {
								id = this.styles.getOrCreateId(
									rule.parentStyleSheet || styleSheet
								);
							} else {
								// register the stylesheet if we haven't seen it before
								id = this.styles.register(styleSheet);
							}
							matchedCSSRules.push({
								rule: {
									selectorList: {
										selectors: selectors.map((s) => ({
											text: s,
										})),
										text: rule.selectorText,
									},
									style: serializeStyle(rule.style, id),
									styleSheetId: id,
									origin: "regular", // dont care enough yet
								},
								matchingSelectors: selectors.map((_, i) => i),
							});
						}
					}
				}
			} catch (e) {
				console.warn("css: Could not access stylesheet rules:", e);
			}
		}
	}
	console.log("Matched CSS rules for node", nodeId, matchedCSSRules);
	if (node instanceof HTMLElement) {
		return {
			inlineStyle: serializeStyle(node.style, `inline-${nodeId}`),
			matchedCSSRules: matchedCSSRules,
			attributesStyle: null,
			pseudoElements: [],
			inherited: [],
			cssKeyframesRules: [],
		};
	} else {
		return {
			inlineStyle: null,
			matchedCSSRules: [],
			attributesStyle: null,
			pseudoElements: [],
			inherited: [],
			cssKeyframesRules: [],
		};
	}
});

function applyStyleEdit(
	css: string,
	range: Protocol.CSS.SourceRange,
	text: string
): string {
	const lines = css?.split("\n") ?? [];
	lines.splice(
		range.startLine,
		Math.max(0, range.endLine - range.startLine + 1),
		...text.split("\n")
	);
	return lines.filter((line) => line.trim()).join("\n");
}

// editing
bindCDP("CSS.setStyleTexts", async function (params) {
	const { edits } = params;
	const results: Protocol.CSS.SetStyleTextsResponse = { styles: [] };

	for (const edit of edits) {
		const { styleSheetId, range, text } = edit;

		if (styleSheetId.startsWith("inline-")) {
			const nodeId = parseInt(styleSheetId.split("-")[1], 10);
			const node = this.nodes.resolveElement(nodeId);

			if (node instanceof HTMLElement) {
				node.style.cssText = text;

				const updatedStyle = parseStyleDeclarations(text, 0, 0);
				updatedStyle.styleSheetId = styleSheetId;
				results.styles.push(updatedStyle);
			}
		} else {
			const sheet = this.styles.get(styleSheetId);
			if (sheet) {
				const rule = sheet.cssRules[range.startLine] || sheet.cssRules[0];

				if (rule instanceof CSSStyleRule) {
					rule.style.cssText = text;

					if (sheet.ownerNode instanceof HTMLStyleElement) {
						this.styles.setText(
							styleSheetId,
							sheet.ownerNode.textContent || ""
						);
					}

					const updatedStyle = parseStyleDeclarations(
						text,
						range.startLine,
						range.startColumn
					);
					updatedStyle.styleSheetId = styleSheetId;
					results.styles.push(updatedStyle);
				}
			}
		}
	}
	return results;
});

bindCDP("CSS.addRule", async function (params) {
	const { styleSheetId, ruleText } = params;
	const sheet = this.styles.get(styleSheetId);

	if (!sheet) {
		throw new Error("StyleSheet not found");
	}

	const index = sheet.insertRule(ruleText, sheet.cssRules.length);
	const newRule = sheet.cssRules[index] as CSSStyleRule;

	const selectors = newRule.selectorText.split(",").map((s) => s.trim());

	return {
		rule: {
			styleSheetId,
			selectorList: {
				selectors: selectors.map((s) => ({ text: s })),
				text: newRule.selectorText,
			},
			style: serializeStyle(newRule.style, styleSheetId),
			origin: "regular",
		},
	};
});

bindCDP("CSS.getStyleSheetText", async function (params) {
	const { styleSheetId } = params;
	const sheet = this.styles.get(styleSheetId);

	if (!sheet) {
		throw new Error("StyleSheet not found");
	}

	// Reconstruct raw CSS text from rules
	const text = Array.from(sheet.cssRules)
		.map((r) => r.cssText)
		.join("\n");

	return { text };
});

bindCDP("CSS.createStyleSheet", async function (params) {
	const el = document.createElement("style");
	document.head.appendChild(el);

	const sheet = el.sheet as CSSStyleSheet;
	const id = this.styles.register(sheet);

	return { id };
});
