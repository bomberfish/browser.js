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

		const walk = (
			rules: CSSRuleList,
			sheet: CSSStyleSheet,
			media: Protocol.CSS.CSSMedia[],
			containerQueries: Protocol.CSS.CSSContainerQuery[] = [],
			supports: Protocol.CSS.CSSSupports[] = [],
			layers: Protocol.CSS.CSSLayer[] = [],
			scopes: Protocol.CSS.CSSScope[] = [],
			ruleTypes: Protocol.CSS.CSSRuleType[] = []
		) => {
			for (const rule of rules) {
				if (rule instanceof CSSStyleRule) {
					if (node instanceof Element && node.matches(rule.selectorText)) {
						console.log("Matched css rule:", rule.cssText);
						const selectors = rule.selectorText.split(",").map((s) => s.trim());
						let id;
						if (this.has(rule.parentStyleSheet || sheet)) {
							id = this.getOrCreateId(rule.parentStyleSheet || sheet);
						} else {
							// register the stylesheet if we haven't seen it before
							id = this.register(sheet);
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
								media: media.length > 0 ? media : undefined,
								containerQueries:
									containerQueries.length > 0 ? containerQueries : undefined,
								supports: supports.length > 0 ? supports : undefined,
								layers: layers.length > 0 ? layers : undefined,
								scopes: scopes.length > 0 ? scopes : undefined,
								ruleTypes: ruleTypes.length > 0 ? ruleTypes : undefined,
							},
							matchingSelectors: selectors.map((_, i) => i),
						});
					}

					if (rule.cssRules && rule.cssRules.length > 0) {
						// recurse into nested rules
						walk(
							rule.cssRules,
							sheet,
							media,
							containerQueries,
							supports,
							layers,
							scopes,
							["StyleRule", ...ruleTypes]
						);
					}
				} else if (rule instanceof CSSMediaRule) {
					const mediaObj: Protocol.CSS.CSSMedia = {
						text: rule.conditionText || rule.media.mediaText,
						source: "mediaRule",
					};
					// only recurse into the media rule if it matches the current viewport
					if (window.matchMedia(rule.media.mediaText).matches) {
						walk(
							rule.cssRules,
							sheet,
							[...media, mediaObj],
							containerQueries,
							supports,
							layers,
							scopes,
							["MediaRule", ...ruleTypes]
						);
					}
				} else if (rule instanceof CSSContainerRule) {
					const containerObj: Protocol.CSS.CSSContainerQuery = {
						text: rule.conditionText || "",
					};
					// ditto
					walk(
						rule.cssRules,
						sheet,
						media,
						[...containerQueries, containerObj],
						supports,
						layers,
						scopes,
						["ContainerRule", ...ruleTypes]
					);
				} else if (rule instanceof CSSSupportsRule) {
					const supportsObj: Protocol.CSS.CSSSupports = {
						text: rule.conditionText || "",
						active: rule.conditionText
							? CSS.supports(rule.conditionText)
							: true,
					};
					walk(
						rule.cssRules,
						sheet,
						media,
						containerQueries,
						[...supports, supportsObj],
						layers,
						scopes,
						["SupportsRule", ...ruleTypes]
					);
				} else if (rule instanceof CSSLayerBlockRule) {
					const layerObj: Protocol.CSS.CSSLayer = {
						text: rule.name,
					};
					walk(
						rule.cssRules,
						sheet,
						media,
						containerQueries,
						supports,
						[...layers, layerObj],
						scopes,
						["LayerRule", ...ruleTypes]
					);
				} else if (rule instanceof CSSGroupingRule) {
					// more evil rule types
					// TODO: Implement scopes
					walk(
						rule.cssRules,
						sheet,
						media,
						containerQueries,
						supports,
						layers,
						scopes,
						["StyleRule", ...ruleTypes]
					);
				}
			}
		};

		for (const styleSheet of document.styleSheets) {
			if (styleSheet instanceof CSSStyleSheet) {
				try {
					walk(styleSheet.cssRules, styleSheet, []);
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
		const matches = [
			...blockText.matchAll(/(\/\*[\s\S]*?\*\/|[\w---]+\s*:[^;]+;?)/g),
		];
		const props: Protocol.CSS.CSSProperty[] = [];

		matches.forEach((match, i) => {
			const rawDecl = match[0].trim();
			if (!rawDecl) return;

			const currentLine = baseLineOffset + i;
			const startCol = i === 0 ? baseColOffset : 0;

			let name;
			let value;
			let disabled = false;
			let text = rawDecl;

			const commentMatch = rawDecl.match(
				/^\/\*\s*([\w---]+)\s*:\s*([\s\S]*?);?\s*\*\/$/
			);

			if (commentMatch) {
				disabled = true;
				name = commentMatch[1].trim();
				value = commentMatch[2].trim();
				text = `/* ${name}: ${value}; */`;
			} else {
				const colonIdx = rawDecl.indexOf(":");
				if (colonIdx === -1) return;
				name = rawDecl.slice(0, colonIdx).trim();
				value = rawDecl
					.slice(colonIdx + 1)
					.replace(/;$/, "")
					.trim();
				if (!text.endsWith(";")) {
					text += ";";
				}
			}

			const important = value.includes("!important");
			if (important) {
				value = value.replace(/!important$/, "").trim();
			}

			props.push({
				name,
				value,
				important,
				disabled: disabled || undefined,
				text,
				range: {
					startLine: currentLine,
					startColumn: startCol,
					endLine: currentLine,
					endColumn: startCol + text.length,
				},
			});
		});

		const formattedCssText = props.map((p) => p.text).join("\n");
		const lastLineIdx = Math.max(0, props.length - 1);
		const lastLineLen = props[lastLineIdx]?.text?.length || 0;

		return {
			cssText: formattedCssText,
			cssProperties: props,
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
