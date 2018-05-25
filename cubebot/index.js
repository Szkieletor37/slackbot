/* eslint array-plural/array-plural: off, no-sync: off, max-len: off */

const qs = require('querystring');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {JSDOM, VirtualConsole} = require('jsdom');
const {RTM_EVENTS: {MESSAGE}} = require('@slack/client');
const {mean, shuffle, range, random} = require('lodash');
const Cube = require('cubejs');
require('cubejs/lib/solve');

const getParity = (permutation) => {
	const N = permutation.length;
	let parity = 0;

	for (const i of range(N)) {
		for (const j of range(i)) {
			if (permutation[i] < permutation[j]) {
				parity = parity === 0 ? 1 : 0;
			}
		}
	}

	return parity;
};

const getRandomPermutation = (size, indices) => {
	const indicesPermutation = shuffle(range(indices.length));
	if (getParity(indicesPermutation) === 1) {
		[indicesPermutation[0], indicesPermutation[1]] = [indicesPermutation[1], indicesPermutation[0]];
	}

	const permutation = range(size);

	for (const [from, to] of indicesPermutation.entries()) {
		permutation[indices[to]] = indices[from];
	}
	return permutation;
};

// https://github.com/ldez/cubejs/blob/master/src/cube.coffee#L154
const getRandomOrientation = (size, indices, max) => {
	let orientationCount = 0;
	const orientation = Array(size).fill(0);

	for (const i of range(indices.length - 1)) {
		orientation[indices[i]] = random(max - 1);
		orientationCount += orientation[indices[i]];
	}

	orientation[indices[indices.length - 1]] = (max - orientationCount % max) % max;
	return orientation;
};

Cube.initSolver();

const virtualConsole = new VirtualConsole();
virtualConsole.sendTo(console);

const {window} = new JSDOM('<div id="touch"></div>', {runScripts: 'outside-only', virtualConsole});

window.localStorage = {}; // dummy

for (const scriptPath of [
	'dist/js/jquery.min.js',
	'src/js/mathlib.js',
	'src/js/kernel.js',
	'src/js/tools.js',
	'src/js/tools/cross.js',
]) {
	const script = fs.readFileSync(path.resolve(__dirname, '../lib/cstimer', scriptPath)).toString();
	window.eval(script.replace(/['"]use strict['"];/, '').replace('solve: solve_cross,', 'solve: solve_cross, solve_xcross: solve_xcross,'));
}

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		scrambles: [],
	};

	const getAttachment = (scramble, size, inverse) => ({
		title: scramble,
		title_link: `https://alg.cubing.net/?${qs.encode({
			alg: scramble.replace(/'/g, '-').replace(/ /g, '_'),
			view: 'playback',
		})}`,
		image_url: `http://roudai.net/visualcube/visualcube.php?${qs.encode({
			fmt: 'png',
			size,
			sch: inverse ? 'yogwrb' : 'wrgyob',
			alg: scramble.replace(/ /g, ''),
		})}`,
	});

	const getTimeText = (time) => time === Infinity ? 'DNF' : time.toFixed(2);

	const faceColors = ['#fefe00', '#ffffff', '#ffa100', '#ee0000', '#00d800', '#0000f2'];

	rtm.on(MESSAGE, async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		const {text} = message;

		if (text.startsWith('スクランブル') || text.startsWith('F2L') || text.startsWith('LL')) {
			const countMatch = text.slice(2).match(/\d+/);
			const count = countMatch ? Math.min(12, parseInt(countMatch[0])) : 1;

			const scrambles = Array(count).fill().map(() => {
				if (text.startsWith('スクランブル')) {
					return Cube.scramble();
				}

				if (text.startsWith('F2L')) {
					const cube = new Cube();
					cube.ep = getRandomPermutation(12, [0, 1, 2, 3, 8, 9, 10, 11]);
					cube.cp = getRandomPermutation(8, range(8));
					cube.eo = getRandomOrientation(12, [0, 1, 2, 3, 8, 9, 10, 11], 2);
					cube.co = getRandomOrientation(8, range(8), 3);
					return Cube.inverse(cube.solve());
				}

				{
					assert(text.startsWith('LL'));

					const cube = new Cube();
					cube.ep = getRandomPermutation(12, [0, 1, 2, 3]);
					cube.cp = getRandomPermutation(8, [0, 1, 2, 3]);
					cube.eo = getRandomOrientation(12, [0, 1, 2, 3], 2);
					cube.co = getRandomOrientation(8, [0, 1, 2, 3], 3);
					return Cube.inverse(cube.solve(18));
				}
			});
			state.scrambles = scrambles;

			await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, '', {
				username: 'cubebot',
				icon_url: 'https://i.imgur.com/YyCc0mc.png',
				attachments: scrambles.map((scramble) => getAttachment(scramble, count > 1 ? 80 : 200, !text.startsWith('スクランブル'))),
			});
		}

		if (text === 'クロス') {
			for (const scramble of state.scrambles.slice(0, 5)) {
				const crosses = [];
				const xcrosses = [];

				const div = window.$('<div/>');
				window.cross.solve(scramble, div);

				for (const index of [0, 1, 2, 3, 4, 5]) {
					const solve = div.children().eq(index).text().split(':')[1].trim();
					crosses.push(solve);
				}

				for (const index of [0, 1, 2, 3, 4, 5]) {
					const span = window.$('<span/>');
					window.cross.solve_xcross(window.kernel.parseScramble(scramble, 'FRUBLD'), index, span);
					const solve = span.text().split(':')[1].trim();
					xcrosses.push(solve);
				}

				await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, '', {
					username: 'cubebot',
					icon_url: 'https://i.imgur.com/YyCc0mc.png',
					attachments: [
						getAttachment(scramble, 80),
						...faceColors.map((color, index) => {
							const xcross = xcrosses[index];
							const rotation = xcross.match(/^[xyz]2?'?/);

							return {
								color,
								text: [
									`cross: <https://alg.cubing.net/?${qs.encode({
										setup: (scramble + (rotation ? ` ${rotation[0]}` : '')).replace(/'/g, '-').replace(/ /g, '_'),
										alg: (crosses[index].replace(/^[xyz]2?'? /, '')).replace(/'/g, '-').replace(/ /g, '_'),
										view: 'playback',
									})}|${crosses[index]}>`,
									`x-cross: <https://alg.cubing.net/?${qs.encode({
										setup: (scramble + (rotation ? ` ${rotation[0]}` : '')).replace(/'/g, '-').replace(/ /g, '_'),
										alg: (xcrosses[index].replace(/^[xyz]2?'? /, '')).replace(/'/g, '-').replace(/ /g, '_'),
										view: 'playback',
									})}|${xcrosses[index]}>`,
								].join('\n'),
							};
						}),
					],
				});
			}
		}

		if (text.match(/^\s*(([\d.,]+|DNF)\s*)+$/i)) {
			const times = text.replace(/,/g, '.').split(/\s+/).filter((time) => time.length > 0).map((time) => parseFloat(time) || Infinity);

			if (times.length <= 1) {
				return;
			}

			if (times.length < 5) {
				const timeTexts = times.map((time) => getTimeText(time));

				slack.chat.postMessage(process.env.CHANNEL_SANDBOX, `*${getTimeText(mean(times))}*: ${timeTexts.join(' ')}`, {
					username: 'cubebot',
					icon_url: 'https://i.imgur.com/YyCc0mc.png',
					thread_ts: message.thread_ts,
				});
			} else {
				const maxIndex = times.indexOf(Math.max(...times));
				const minIndex = times.indexOf(Math.min(...times));
				const average = mean(times.filter((time, index) => index !== maxIndex && index !== minIndex));
				const fixedTimes = times.map((time, index) => (index === maxIndex || index === minIndex) ? `(${getTimeText(time)})` : getTimeText(time));

				slack.chat.postMessage(process.env.CHANNEL_SANDBOX, `*${getTimeText(average)}*: ${fixedTimes.join(' ')}`, {
					username: 'cubebot',
					icon_url: 'https://i.imgur.com/YyCc0mc.png',
					thread_ts: message.thread_ts,
				});
			}
		}
	});
};
