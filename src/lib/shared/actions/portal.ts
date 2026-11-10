/** Keep viewport overlays outside scrolling, material and animated ancestors. */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy() { node.remove(); } };
}
