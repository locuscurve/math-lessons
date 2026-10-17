"use strict";

/**
 * Search engines offered in Settings > Proxy. `%s` is replaced with the
 * URL-encoded query. Brave is the default.
 */
const SEARCH_ENGINES = [
	{ id: "google", name: "Google", template: "https://www.google.com/search?q=%s&hl=en" },
	{ id: "duckduckgo", name: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s" },
	{ id: "bing", name: "Bing", template: "https://www.bing.com/search?q=%s" },
	{ id: "brave", name: "Brave", template: "https://search.brave.com/search?q=%s" },
	{ id: "yahoo", name: "Yahoo", template: "https://search.yahoo.com/search?p=%s" },
	{ id: "startpage", name: "Startpage", template: "https://www.startpage.com/sp/search?query=%s" },
	{ id: "ecosia", name: "Ecosia", template: "https://www.ecosia.org/search?q=%s" },
	{ id: "ask", name: "Ask", template: "https://www.ask.com/web?q=%s" },
];
const DEFAULT_SEARCH_ENGINE = "brave";

/**
 * @param {string} [id] Search engine id from SEARCH_ENGINES.
 * @returns {string} Query template; falls back to the default engine if the id is unknown.
 */
function searchTemplateFor(id) {
	const engine =
		SEARCH_ENGINES.find((e) => e.id === id) ||
		SEARCH_ENGINES.find((e) => e.id === DEFAULT_SEARCH_ENGINE);
	return engine.template;
}
/**
 *
 * @param {string} input
 * @param {string} template Template for a search query.
 * @returns {string} Fully qualified URL
 */
function search(input, template) {
	try {
		// input is a valid URL:
		// eg: https://example.com, https://example.com/test?q=param
		return new URL(input).toString();
	} catch (err) {
		// input was not a valid URL
	}

	try {
		// input is a valid URL when http:// is added to the start:
		// eg: example.com, https://example.com/test?q=param
		const url = new URL(`http://${input}`);
		// only if the hostname has a TLD/subdomain
		if (url.hostname.includes(".")) return url.toString();
	} catch (err) {
		// input was not valid URL
	}

	// input may have been a valid URL, however the hostname was invalid

	// Attempts to convert the input to a fully qualified URL have failed
	// Treat the input as a search query
	return template.replace("%s", encodeURIComponent(input));
}
