import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";
import { NodeManager } from "../nodemanager";

bindCDP("DOM.disable", async function () {
	this.domEnabled = false;
});

bindCDP("DOM.enable", async function () {
	console.log("DOM enabled!");
	this.domEnabled = true;
});

bindCDP("DOM.getDocument", async function (params) {
	console.warn("DOM.getDocument", params);
	return {
		root: this.nodes.serializeTree(
			document,
			params?.depth ?? -1,
			params?.pierce ?? false
		),
	};
});
