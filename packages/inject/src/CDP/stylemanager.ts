import Protocol from "devtools-protocol";
import { SkiBidiMap } from "./util";
import { box, CDPSession } from ".";

export class StyleManager {
	private styleMap: SkiBidiMap<string, CSSStyleSheet> = new SkiBidiMap();
	private textMap: SkiBidiMap<string, string> = new SkiBidiMap();

	private counter = 1;

	constructor(public session: CDPSession) {}

	private createId(): string {
		return `style-${this.counter++}`; // yeah zone
	}

	public getOrCreateId(style: CSSStyleSheet): string {
		if (this.styleMap.getKey(style)) {
			return this.styleMap.getKey(style)!;
		} else {
			const id = this.createId();
			this.styleMap.set(id, style);
			return id;
		}
	}

	public has(style: CSSStyleSheet): boolean {
		return this.styleMap.getKey(style) !== undefined;
	}

	public get(id: string): CSSStyleSheet | undefined {
		return this.styleMap.get(id);
	}

	public setText(id: string, text: string): void {
		this.textMap.set(id, text);
	}

	public getText(id: string): string {
		const text = this.textMap.get(id);
		if (text !== undefined) {
			return text;
		}

		const style = this.get(id);
		if (style?.ownerNode instanceof HTMLStyleElement) {
			this.textMap.set(id, style.ownerNode.textContent || "");
			return style.ownerNode.textContent || "";
		}

		if (style) {
			const rules = Array.from(style.cssRules)
				.map((rule) => rule.cssText)
				.join("\n");
			this.textMap.set(id, rules);
			return rules;
		}

		return "";
	}

	public register(style: CSSStyleSheet): string {
		const id = this.getOrCreateId(style);
		this.session.emit("CSS.styleSheetAdded", {
			header: this.serializeStyleSheet(style),
		});
		return id;
	}

	public serializeStyleSheet(
		style: CSSStyleSheet
	): Protocol.CSS.CSSStyleSheetHeader {
		const owner = style.ownerNode instanceof Element ? style.ownerNode : null;
		const href = style.href || owner?.getAttribute("href") || null;
		const url = href ? new URL(href, window.location.href).href : "";
		return {
			styleSheetId: this.getOrCreateId(style),
			frameId: "", // todo!
			sourceURL: url,
			origin: "regular", // bigger todo?
			title: style.title || "",
			ownerNode: style.ownerNode
				? this.session.nodes.wrap(style.ownerNode).backendNodeId
				: undefined,
			disabled: style.disabled,
			hasSourceURL: Boolean(url),
			isInline: !url,
			startLine: 0,
			startColumn: 0,
			isMutable: true, // todo
			isConstructed: false, // todo
			length: style.cssRules.length,
			endLine: 0, // todo, holy shit how do you even get this
			endColumn: 0, // todo
		};
	}

	public getMatchingRulesForNode(node: Element): Protocol.CSS.RuleMatch[] {
		const matches: Protocol.CSS.RuleMatch[] = [];

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
								if (this.has(rule.parentStyleSheet || styleSheet)) {
									id = this.getOrCreateId(rule.parentStyleSheet || styleSheet);
								} else {
									// register the stylesheet if we haven't seen it before
									id = this.register(styleSheet);
								}
								matches.push({
									rule: {
										selectorList: {
											selectors: selectors.map((s) => ({
												text: s,
											})),
											text: rule.selectorText,
										},
										style: this.serializeStyle(rule.style, id),
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

		return matches;
	}

	public serializeComputedStyle(
		props: CSSStyleDeclaration
	): Protocol.CSS.CSSComputedStyleProperty[] {
		return Array.from(props).map((name) => ({
			name: name,
			value: props.getPropertyValue(name),
		}));
	}

	public serializeStyle(
		style: CSSStyleDeclaration,
		styleSheetId?: string
	): Protocol.CSS.CSSStyle {
		return {
			...this.parseStyleDeclarations(style.cssText),
			styleSheetId,
		};
	}

	public parseStyleDeclarations(
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
}
