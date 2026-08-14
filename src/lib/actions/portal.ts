/** When enabled (default true), move node to document.body; otherwise keep in-tree. */
export function portal(node: HTMLElement, enabled?: boolean) {
	const placeholder = document.createComment('portal');
	const parent = node.parentNode;
	if (parent) parent.insertBefore(placeholder, node);

	function apply(next?: boolean) {
		const on = next !== false;
		if (on) {
			document.body.appendChild(node);
		} else if (placeholder.parentNode) {
			placeholder.parentNode.insertBefore(node, placeholder);
		}
	}

	apply(enabled);

	return {
		update(next?: boolean) {
			apply(next);
		},
		destroy() {
			node.remove();
			placeholder.remove();
		}
	};
}
