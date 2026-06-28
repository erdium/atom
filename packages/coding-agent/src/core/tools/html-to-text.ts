/**
 * Convert HTML to plain text by stripping tags and decoding entities.
 */
export function htmlToText(html: string): string {
	// Remove script and style blocks
	let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
	text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

	// Replace block-level tags with newlines
	text = text.replace(/<br\s*\/?>/gi, "\n");
	text = text.replace(/<\/(p|div|li|h[1-6]|blockquote|tr|th|td|pre|ol|ul|dl|dt|dd|table|section|article|nav|header|footer)>/gi, "\n");
	text = text.replace(/<(li|dt|dd|tr|th|td)\b[^>]*>/gi, "\n");

	// Strip remaining HTML tags
	text = text.replace(/<[^>]+>/g, "");

	// Decode HTML entities
	text = text.replace(/&amp;/g, "&");
	text = text.replace(/&lt;/g, "<");
	text = text.replace(/&gt;/g, ">");
	text = text.replace(/&quot;/g, '"');
	text = text.replace(/&#39;/g, "'");
	text = text.replace(/&nbsp;/g, " ");
	text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));

	// Collapse whitespace
	text = text.replace(/\t/g, " ");
	text = text.replace(/[ \t]+\n/g, "\n");
	text = text.replace(/\n{3,}/g, "\n\n");

	return text.trim();
}
