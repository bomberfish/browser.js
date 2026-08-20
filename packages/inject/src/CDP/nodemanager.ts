import Protocol from "devtools-protocol";
import { SkiBidiMap } from "./util";
type NodeId = Protocol.DOM.NodeId;
type RemoteNode = Protocol.DOM.Node;

export class NodeManager {
	nodes = new SkiBidiMap<NodeId, Node>();
	counter = 1;

	private createId(): NodeId {
		return this.counter++;
	}
	private getOrCreateId(node: Node): NodeId {
		if (this.nodes.getKey(node)) {
			return this.nodes.getKey(node)!;
		} else {
			const id = this.createId();
			this.nodes.set(id, node);
			return id;
		}
	}
	public get(id: NodeId): Node | undefined {
		return this.nodes.get(id);
	}

	serializeTree(node: Node, depth: number, pierce: boolean): RemoteNode {
		const remoteNode = this.wrap(node);
		if (node.nodeType === Node.DOCUMENT_NODE) {
			remoteNode.documentURL = (node as Document).URL;
			remoteNode.baseURL = (node as Document).baseURI;
		}

		if (node.nodeType === Node.ELEMENT_NODE) {
			const element = node as Element;
			remoteNode.attributes = [];
			for (const attr of element.attributes) {
				remoteNode.attributes.push(attr.name, attr.value);
			}
		}

		if (pierce && node instanceof HTMLElement && node.shadowRoot) {
			remoteNode.shadowRoots = [
				this.serializeTree(node.shadowRoot, depth - 1, pierce),
			];
		}

		if (pierce && node instanceof HTMLIFrameElement && node.contentDocument) {
			remoteNode.contentDocument = this.serializeTree(
				node.contentDocument,
				depth,
				pierce
			);
		}

		const actualDepth = depth === -1 ? Infinity : depth;
		if (actualDepth > 0) {
			remoteNode.children = [];
			for (const child of node.childNodes) {
				if (
					child.nodeType === Node.TEXT_NODE &&
					child.nodeValue?.trim() === ""
				) {
					continue;
				}

				const childRemoteNode = this.serializeTree(
					child,
					actualDepth - 1,
					pierce
				);
				childRemoteNode.parentId = remoteNode.nodeId;
				remoteNode.children.push(childRemoteNode);
			}
		}

		return remoteNode;
	}

	wrap(node: Node): RemoteNode {
		const id = this.getOrCreateId(node);
		return {
			nodeId: id,
			backendNodeId: id,
			nodeType: node.nodeType,
			nodeName: node.nodeName,
			nodeValue: node.nodeValue ?? "",
			childNodeCount: node.childNodes.length,
			localName: node.localName,
		};
	}

	resolveElement(nodeId: NodeId): Element {
		const node = this.get(nodeId);
		if (!node || !(node instanceof Element)) {
			throw new Error("Node is not an element");
		}
		return node;
	}

	resolveNode(nodeId: NodeId): Node {
		const node = this.get(nodeId);
		if (!node) {
			throw new Error("Node not found");
		}
		return node;
	}
}
