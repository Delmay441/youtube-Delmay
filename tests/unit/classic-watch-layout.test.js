class FakeElement {
	constructor(tagName, id = '') {
		this.tagName = tagName.toUpperCase();
		this.nodeName = this.tagName;
		this.id = id;
		this.children = [];
		this.parentElement = null;
		this.parentNode = null;
		this.style = {};
		this.attributes = {};
		this.dataset = {};
	}

	appendChild(child) {
		if (!child) return child;
		if (child.parentElement) {
			child.parentElement.children = child.parentElement.children.filter((node) => node !== child);
		}
		this.children.push(child);
		child.parentElement = this;
		child.parentNode = this;
		return child;
	}

	contains(node) {
		for (let current = node; current; current = current.parentElement) {
			if (current === this) return true;
		}
		return false;
	}

	setAttribute(name, value) {
		this.attributes[name] = String(value);
	}

	removeAttribute(name) {
		delete this.attributes[name];
	}
}

/*
 * YouTube's experimental watch layout: #comments in the right column (#secondary-inner),
 * #related below the player (#primary-inner). Mirrors the real element ids.
 */
function createDocument({ experiment = true, withComments = true } = {}) {
	const elements = {};

	function el(tagName, id = '') {
		const node = new FakeElement(tagName, id);
		if (id) elements[id] = node;
		return node;
	}

	const documentElement = el('html');
	const body = el('body');
	const watch = el('ytd-watch-flexy');
	const columns = el('div', 'columns');
	const primary = el('div', 'primary');
	const primaryInner = el('div', 'primary-inner');
	const below = el('div', 'below');
	const secondary = el('div', 'secondary');
	const secondaryInner = el('div', 'secondary-inner');
	const related = el('div', 'related');
	const comments = el('div', 'comments');

	documentElement.appendChild(body);
	body.appendChild(watch);
	watch.appendChild(columns);
	columns.appendChild(primary);
	columns.appendChild(secondary);
	primary.appendChild(primaryInner);
	primaryInner.appendChild(below);
	secondary.appendChild(secondaryInner);

	if (experiment) {
		primaryInner.appendChild(related);
		if (withComments) secondaryInner.appendChild(comments);
	} else {
		secondaryInner.appendChild(related);
		below.appendChild(comments);
	}

	documentElement.dataset.pageType = 'video';
	if (!withComments) delete elements.comments; // not rendered yet

	return {
		documentElement,
		body,
		getElementById: (id) => elements[id] || null,
		addEventListener: jest.fn(),
		_create: el
	};
}

function installBrowserStubs(options) {
	const callbacks = [];
	const document = createDocument(options);

	global.document = document;
	global.location = { href: 'https://www.youtube.com/watch?v=abcdefghijk' };
	global.navigator = { userAgent: 'Windows' };
	global.window = {
		addEventListener: jest.fn(),
		matchMedia: jest.fn(() => ({ matches: false }))
	};
	global.MutationObserver = jest.fn().mockImplementation((callback) => {
		callbacks.push(callback);
		return { observe: jest.fn(), disconnect: jest.fn() };
	});
	global.console.warn = jest.fn();

	return {
		document,
		// YouTube re-arranged one of the watched containers
		triggerMutation: () => callbacks.forEach((callback) => callback([{ type: 'childList' }]))
	};
}

function loadAppearance(storage = {}) {
	jest.resetModules();
	global.ImprovedTube = { storage, elements: {} };
	require('../../js&css/web-accessible/www.youtube.com/appearance.js');
}

function parentId(document, id) {
	return document.getElementById(id).parentElement.id;
}

describe('restore classic watch layout', () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
		delete global.document;
		delete global.location;
		delete global.navigator;
		delete global.window;
		delete global.MutationObserver;
		delete global.ImprovedTube;
	});

	test('moves comments under the video info and related back to the right column', () => {
		const { document } = installBrowserStubs();
		loadAppearance();

		ImprovedTube.restoreClassicWatchLayout();
		jest.advanceTimersByTime(100);

		expect(parentId(document, 'comments')).toBe('below');
		expect(parentId(document, 'related')).toBe('secondary-inner');
	});

	test('leaves an already classic layout alone', () => {
		const { document } = installBrowserStubs({ experiment: false });
		loadAppearance();

		ImprovedTube.restoreClassicWatchLayout();
		jest.advanceTimersByTime(100);

		expect(parentId(document, 'comments')).toBe('below');
		expect(parentId(document, 'related')).toBe('secondary-inner');
	});

	test('waits for late-loading comments and fixes them when they appear', () => {
		const { document, triggerMutation } = installBrowserStubs({ withComments: false });
		loadAppearance();

		expect(() => ImprovedTube.restoreClassicWatchLayout()).not.toThrow();
		expect(document.getElementById('comments')).toBeNull();

		const comments = document._create('div', 'comments');
		document.getElementById('secondary-inner').appendChild(comments);
		triggerMutation();
		jest.advanceTimersByTime(100);

		expect(comments.parentElement.id).toBe('below');
	});

	test('re-applies when YouTube moves comments back (SPA navigation)', () => {
		const { document, triggerMutation } = installBrowserStubs();
		loadAppearance();

		ImprovedTube.restoreClassicWatchLayout();
		jest.advanceTimersByTime(100);

		document.getElementById('secondary-inner').appendChild(document.getElementById('comments'));
		triggerMutation();
		jest.advanceTimersByTime(100);

		expect(parentId(document, 'comments')).toBe('below');
	});

	test('prefers state-preserving moveBefore() and falls back when it throws', () => {
		const first = installBrowserStubs();
		loadAppearance();
		const below = first.document.getElementById('below');
		below.moveBefore = jest.fn((node) => below.appendChild(node));
		ImprovedTube.restoreClassicWatchLayout();
		jest.advanceTimersByTime(100);
		expect(below.moveBefore).toHaveBeenCalled();
		expect(parentId(first.document, 'comments')).toBe('below');

		const second = installBrowserStubs();
		loadAppearance();
		second.document.getElementById('below').moveBefore = () => { throw new Error('unsupported'); };
		ImprovedTube.restoreClassicWatchLayout();
		jest.advanceTimersByTime(100);
		expect(parentId(second.document, 'comments')).toBe('below');
	});

	test('stops fighting if YouTube keeps re-arranging the page', () => {
		const { document, triggerMutation } = installBrowserStubs();
		loadAppearance();

		ImprovedTube.restoreClassicWatchLayout();
		jest.advanceTimersByTime(100);

		for (let i = 0; i < 12; i++) {
			document.getElementById('secondary-inner').appendChild(document.getElementById('comments'));
			triggerMutation();
			jest.advanceTimersByTime(100);
		}

		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(parentId(document, 'comments')).toBe('secondary-inner');
	});

	test.each([
		['the setting is off', { restore_classic_watch_layout: false }],
		['comments sidebar is enabled', { comments_sidebar: true }],
		['comments sidebar (simple) is enabled', { comments_sidebar_simple: true }],
		['the description is set to sidebar', { description: 'sidebar' }]
	])('does nothing when %s', (_name, storage) => {
		const { document } = installBrowserStubs();
		loadAppearance(storage);

		ImprovedTube.restoreClassicWatchLayout();
		jest.advanceTimersByTime(100);

		expect(parentId(document, 'comments')).toBe('secondary-inner');
		expect(parentId(document, 'related')).toBe('primary-inner');
	});

	test('does nothing outside video pages', () => {
		const { document } = installBrowserStubs();
		document.documentElement.dataset.pageType = 'home';
		loadAppearance();

		ImprovedTube.restoreClassicWatchLayout();
		jest.advanceTimersByTime(100);

		expect(parentId(document, 'comments')).toBe('secondary-inner');
	});
});

describe('YouTube experiment flags', () => {
	beforeEach(() => {
		installBrowserStubs();
		global.window.yt = { config_: { EXPERIMENT_FLAGS: { kevlar_watch_grid: true, small_avatars_for_comments: true } } };
	});

	afterEach(() => {
		delete global.document;
		delete global.location;
		delete global.navigator;
		delete global.window;
		delete global.MutationObserver;
		delete global.ImprovedTube;
	});

	test('"Undo the new sidebar" works with the boolean the switch actually stores', () => {
		loadAppearance({ undo_the_new_sidebar: true });
		ImprovedTube.YouTubeExperiments();

		const flags = window.yt.config_.EXPERIMENT_FLAGS;
		expect(flags.kevlar_watch_grid).toBe(false);
		expect(flags.small_avatars_for_comments).toBe(false);
	});

	test('the default classic layout only overrides the layout flag', () => {
		loadAppearance();
		ImprovedTube.YouTubeExperiments();

		const flags = window.yt.config_.EXPERIMENT_FLAGS;
		expect(flags.kevlar_watch_grid).toBe(false);
		expect(flags.small_avatars_for_comments).toBe(true);
	});

	test('can be re-applied on later navigations without throwing', () => {
		loadAppearance({ undo_the_new_sidebar: true });
		ImprovedTube.YouTubeExperiments();
		window.yt.config_.EXPERIMENT_FLAGS = { kevlar_watch_grid: true };
		Object.defineProperty(window.yt.config_.EXPERIMENT_FLAGS, 'kevlar_watch_grid', { get: () => true, configurable: true });
		expect(() => ImprovedTube.YouTubeExperiments()).not.toThrow();
		expect(window.yt.config_.EXPERIMENT_FLAGS.kevlar_watch_grid).toBe(false);
	});
});
