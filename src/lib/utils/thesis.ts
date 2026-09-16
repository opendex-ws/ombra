/** A thesis body is plain text with `@[username](id)` mention markup embedded. */
export type ThesisSegment =
	| { kind: 'text'; value: string }
	| { kind: 'mention'; value: string };

const MENTION = /@\[([^\]\n]+)\]\(([^)\n]*)\)/g;

/**
 * Splits a thesis body into text and mention segments. Only the display name
 * inside `[...]` matters; the id in `(...)` is dropped, since mentions do not
 * link anywhere yet. Malformed markup is left as literal text rather than
 * swallowed, so a post never silently loses characters.
 */
export function parseThesisText(text: string): ThesisSegment[] {
	if (!text) return [];
	const segments: ThesisSegment[] = [];
	let last = 0;
	MENTION.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MENTION.exec(text)) !== null) {
		const name = match[1].trim();
		if (!name) continue;
		if (match.index > last) segments.push({ kind: 'text', value: text.slice(last, match.index) });
		segments.push({ kind: 'mention', value: name });
		last = match.index + match[0].length;
	}
	if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) });
	return segments;
}
