import Protocol from "devtools-protocol";
import { SkiBidiMap } from "./util";
import { box, CDPSession } from ".";

export class StyleManager {
	private styleMap: SkiBidiMap<string, CSSStyleSheet> = new SkiBidiMap();
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
			origin: "regular", // bigger todo?ç
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
}
