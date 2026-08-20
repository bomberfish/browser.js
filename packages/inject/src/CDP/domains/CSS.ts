import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";
import { StyleManager } from "./stylemanager";

function serializeComputedStyle(
	props: CSSStyleDeclaration
): Protocol.CSS.CSSComputedStyleProperty[] {
	return Array.from(props).map((name) => ({
		name: name,
		value: props.getPropertyValue(name),
	}));
}

function serializeInlineStyle(element: HTMLElement): Protocol.CSS.CSSStyle {
	return {
		cssText: element.getAttribute("style") || "",
		cssProperties: Array.from(element.style).map((name) => ({
			name: name,
			value: element.style.getPropertyValue(name),
			important: element.style.getPropertyPriority(name) === "important",
		})),
		shorthandEntries: [],
	};
}

bindCDP("CSS.enable", async function () {
	for (const styleSheet of document.styleSheets) {
		if (styleSheet instanceof CSSStyleSheet) {
			this.styles.getOrCreateId(styleSheet);
			this.emit("CSS.styleSheetAdded", {
				header: this.styles.serializeStyleSheet(styleSheet),
			});
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
			inlineStyle: serializeInlineStyle(node),
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
								id = this.styles.getOrCreateId(styleSheet);
								// register the stylesheet if we haven't seen it before
								this.emit("CSS.styleSheetAdded", {
									header: this.styles.serializeStyleSheet(styleSheet),
								});
							}
							matchedCSSRules.push({
								rule: {
									selectorList: {
										selectors: selectors.map((s) => ({
											text: s,
										})),
										text: rule.selectorText,
									},
									style: {
										cssProperties: Array.from(rule.style).map((name) => ({
											name: name,
											value: rule.style.getPropertyValue(name),
											important:
												rule.style.getPropertyPriority(name) === "important",
										})),
										shorthandEntries: [],
										cssText: rule.cssText,
									},
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
			inlineStyle: serializeInlineStyle(node),
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
