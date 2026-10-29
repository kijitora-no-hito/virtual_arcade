/******************************************************************************
 * Columns                                                                    *
 *                                                                            *
 * Copyright (C) 2020 J.C. Fields (jcfields@jcfields.dev).                    *
 *                                                                            *
 * Permission is hereby granted, free of charge, to any person obtaining a    *
 * copy of this software and associated documentation files (the "Software"), *
 * to deal in the Software without restriction, including without limitation  *
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,   *
 * and/or sell copies of the Software, and to permit persons to whom the      *
 * Software is furnished to do so, subject to the following conditions:       *
 *                                                                            *
 * The above copyright notice and this permission notice shall be included in *
 * all copies or substantial portions of the Software.                        *
 *                                                                            *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR *
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,   *
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL    *
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER *
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING    *
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER        *
 * DEALINGS IN THE SOFTWARE.                                                  *
 ******************************************************************************/

"use strict";

// va: バーチャルゲームセンター（Columns like game。DESIGN §16.8）に同梱するために変えた所には「va:」と書いた。
// 一覧は同じフォルダの CHANGES.md。親の窓とのやりとり・種からの乱数は va_bridge.js。

/*
 * constants
 */

// gameplay
const ROWS = 13;
const COLS = 7;
const PIECE_SIZE = 3;     // number of blocks per piece
const BLOCK_SIZE = 128;   // size of block in pixels
const MATCH_SIZE = 3;     // number of blocks required for match
const LEVELS = 12;
const TIER = 50;          // number of jewels per level
const TIER_INCREASE = 10; // increase per level (in standard mode)
const START_COLOR = 2;
const MINIMUM_HEIGHT = 2; // for flash mode
const MAGIC_JEWEL_CHANCE = 0.005;
const MAGIC_JEWEL_BONUS = 10000;

// default options
const DEFAULT_START_LEVEL = 1;
const DEFAULT_DIFFICULTY = 5;
const DEFAULT_HEIGHT = 0;
const GHOST_PIECE = true;
const TIME_ATTACK_LENGTH = 300;
const TIME_ATTACK_FLASH = 60;

// display
const BLOCK_STROKE_WIDTH = 4;
const GRID_LINE_COLOR = "#404040";
const GRID_LINE_WIDTH = 2;
const GHOST_INSET = 12;
const GHOST_WIDTH = 8;
const MOBILE_BREAKPOINT = 768;

// timing (in ms)
const MOVE_DELAY = 250;
const DROP_DELAY = 5;
const FLASH_DELAY = 10;
const CLEAR_DELAY = 50;

// time in seconds for piece to drop from top to bottom of well,
// determines tick length
const SPEED = 15;
// number of ticks per block, higher is smoother
// should be divisor of block size for nice integer pixel values
const STEP = 64;

// storage
const STORAGE_NAME = "columns";
const TABLE_SIZE = 5;
const STARTING_DIFFICULTY = 3, DIFFICULTY_LEVELS = 4, GAME_MODES = 3;
const STANDARD = 0, FLASH = 1, TIME_ATTACK = 2; // game modes
const PHOTOGRAPH = 0, GRADIENT = 1;             // backdrops

// block colors
// va: 宝石の色を元（赤・青・黄・緑・紫・橙）から変えた（色の数・並び・決まりは同じ）。マジックジュエルは真珠色
const COLORS = [
	["#000",    "#404040", "#202020"], // black
	["#fffaf0", "#c9b8ff", "#7d6aa8"], // white (magic jewel: pearl)
	["#ff7ac6", "#c4176f", "#6e0c3e"], // pink
	["#7cc4ff", "#1f6fd1", "#0d3a75"], // azure
	["#d8ff6b", "#79b815", "#3d6408"], // lime
	["#ffd47a", "#d9850a", "#734300"], // amber
	["#d29bff", "#7a33cc", "#3f1a6b"], // purple
	["#7dffe4", "#11a88f", "#08584b"]  // turquoise
];

// special colors
const BLACK = 0, WHITE = 1;

// background images
const IMAGES = [
	{
		file:   "alberta",
		author: "James Wheeler",
		url:    "https://www.pexels.com/@souvenirpixels"
	}, {
		file:   "asphalt",
		author: "Nextvoyage",
		url:    "https://www.pexels.com/@nextvoyage"
	}, {
		file:   "bridge",
		author: "Martin Damboldt",
		url:    "https://www.pexels.com/@mdx014"
	}, {
		file:   "clouds",
		author: "Mauricio Artieda",
		url:    "https://www.pexels.com/@martieda"
	}, {
		file:   "dock",
		author: "Pok Rie",
		url:    "https://www.pexels.com/@pok-rie-33563"
	}, {
		file:   "flowers",
		author: "David Bartus",
		url:    "https://www.pexels.com/@david-bartus-43782"
	}, {
		file:   "lights",
		author: "Lucas Ettore Chiereguini",
		url:    "https://www.pexels.com/@ettore"
	}, {
		file:   "reflection",
		author: "Quang Nguyen Vinh",
		url:    "https://www.pexels.com/@quang-nguyen-vinh-222549"
	}, {
		file:   "river",
		author: "Michiel Alleman",
		url:    "https://www.pexels.com/@michiel-alleman-702603"
	}, {
		file:   "rocks",
		author: "Paul IJsendoorn",
		url:    "https://www.pexels.com/@photospublic"
	}, {
		file:   "swan",
		author: "Cat Crawford",
		url:    "https://www.pexels.com/@cat-crawford-673653"
	}, {
		file:   "wave",
		author: "Emiliano Arano",
		url:    "https://www.pexels.com/@earano"
	}
];

/*
 * initialization
 */

window.addEventListener("load", function() {
	// va: 途中のゲーム・ハイスコア・オプションを localStorage に残さない（記録は店のランキング）
	const options = new Options();
	const scores = new Scores();

	options.load();
	scores.load();

	const game = new Game(options, scores);
	game.init();

	// va: 親の窓とのやりとり（Play で親に種を頼む・ピースを置くたびに知らせる。va_bridge.js）
	VAColumns.attach(game);

	window.addEventListener("blur", function() {
		game.pause(true);
	});
	window.addEventListener("keydown", function(event) {
		const keyCode = event.keyCode;

		if (keyCode == 13 && !game.stopped) { // enter
			event.preventDefault();
			game.pause();
		}

		if (keyCode == 27 && !game.locked && game.stopped) {  // esc
			event.preventDefault();
			game.display.closeAllOverlays();
		}

		if (!game.paused && !game.locked && !game.stopped) {
			if (keyCode == 8) { // backspace
				event.preventDefault();
				resetGame();
			}

			if (keyCode == 32 || keyCode == 35) { // space bar or end
				event.preventDefault();
				game.drop();
			}

			if (keyCode == 37 || keyCode == 65) { // left or A
				event.preventDefault();
				game.moveLeft();
			}

			if (keyCode == 38 || keyCode == 87) { // up or W
				event.preventDefault();
				game.currentPiece.rotate();
			}

			if (keyCode == 39 || keyCode == 68) { // right or D
				event.preventDefault();
				game.moveRight();
			}

			if (keyCode == 40 || keyCode == 83) { // down or S
				event.preventDefault();
				game.moveDown();
			}
		}
	});

	document.addEventListener("click", function(event) {
		const element = event.target;

		if (element.matches("button")) {
			element.blur();
		}

		if (element.matches("#play")) {
			if (game.stopped) {
				// va: すぐには始めず、親の窓に種を頼む（親が start を返したら game.play()）
				VAColumns.requestPlay();
			} else {
				game.pause();
			}
		}

		if (element.matches("#scores")) {
			const mode = options.read("mode");
			const difficulty = options.read("difficulty");
			game.display.showScores(game.scores, mode, difficulty, false);

			setSelect("mode", mode);
			setSelect("colors", difficulty);
		}

		if (element.matches("#options")) {
			setSliders();
		}

		if (element.matches("#reset")) {
			resetGame();
		}

		if (element.matches("#swap")) {
			if (!game.paused && !game.locked && !game.stopped) {
				game.currentPiece.rotate();
			}
		}

		if (element.matches("#left")) {
			if (!game.paused && !game.locked && !game.stopped) {
				game.moveLeft();
			}
		}

		if (element.matches("#right")) {
			if (!game.paused && !game.locked && !game.stopped) {
				game.moveRight();
			}
		}

		if (element.matches("#drop")) {
			if (!game.paused && !game.locked && !game.stopped) {
				game.drop();
			}
		}

		if (element.matches("#flash")) {
			const height = $("#height");

			if (height.value < MINIMUM_HEIGHT) {
				height.value = MINIMUM_HEIGHT;
				setSliders();
			}
		}

		if (element.matches("#prompt button")) {
			submitScore();
		}

		if (element.matches(".toggle")) {
			$("#overlay_" + element.value).classList.toggle("open");

			for (const overlay of $$(".overlay")) { // hides other open overlays
				if (!overlay.id.endsWith(element.value)) {
					overlay.classList.remove("open");
				}
			}
		}

		if (element.matches(".close")) {
			$("#overlay_" + element.value).classList.remove("open");
		}

		if (element.matches(".backdrop")) {
			const className = document.documentElement.className;
			const state = Number($("#gradient").checked);

			// changes backdrop when options closed if changed
			if (
				(state == PHOTOGRAPH && className != "photograph")
				|| (state == GRADIENT && className != "gradient")
			) {
				game.display.backdrop = state;
				game.display.changeBackdrop(0);
			}
		}
	});
	document.addEventListener("input", function(event) {
		const element = event.target;

		if (element.matches('input[type="range"]')) {
			setSliders();
		}

		if (element.matches("#overlay_scores select")) {
			const mode = $("#mode").value;
			const difficulty = $("#colors").value;
			game.display.showScores(game.scores, mode, difficulty, false);
		}
	});
	document.addEventListener("keydown", function(event) {
		const element = event.target;

		if (element.matches("#prompt input")) {
			if (event.keyCode == 13) { // enter
				submitScore();
			}
		}
	});

	function resetGame() {
		VAColumns.reset(); // va: 親の窓に知らせる（今のゲームを記録する）
		game.reset();
		game.init();
	}

	function setSelect(id, value) {
		const select = $("#" + id);
		const options = Array.from(select.options);

		select.selectedIndex = options.findIndex(function(option) {
			return option.value == value;
		});
	}

	function setSliders() {
		$("#showDifficulty").textContent = $("#difficulty").value;
		$("#showStart").textContent = $("#start").value;
		$("#showHeight").textContent = $("#height").value;

		if ($("#height").value < 2 && $("#flash").checked) {
			$("#standard").checked = true;
			$("#flash").checked = false;
			$("#timeAttack").checked = false;
		}
	}

	function submitScore() {
		const input = $("#prompt input");

		if (input.value == "") {
			return;
		}

		game.scores.add(
			input.value, game.mode, game.difficulty,
			game.time, game.level, game.score, game.jewels
		);
		game.display.showScores(game.scores, game.mode, game.difficulty, true);
		game.display.togglePrompt(false);
	}
});

function $(selector) {
	return document.querySelector(selector);
}

function $$(selector) {
	return Array.from(document.querySelectorAll(selector));
}

/*
 * Game prototype
 */

function Game(options, scores) {
	this.well = Array(ROWS).fill().map(function() {
		return Array(COLS).fill(0);
	});

	this.currentPiece = null;
	this.nextPiece = null;

	this.mode = STANDARD;
	this.difficulty = DEFAULT_DIFFICULTY;

	this.time = 1;
	this.score = 0;
	this.level = 1;
	this.jewels = 0;

	this.loop = null;
	this.timer = null;

	this.paused = false; // user pause
	this.locked = false; // hold for delays
	this.stopped = true; // game not playing

	this.options = options;
	this.scores = scores;
	this.display = new Display();

	this.flashCell = {x: 0, y: 0};
	this.flashClear = false;

	this.pieceBonus = 0; // va: 今のピースの ↓ と落下の点（親の窓に知らせる）
}

Game.prototype.init = function() {
	this.display.backdrop = this.options.read("backdrop");
	this.display.init();
};

Game.prototype.play = function() {
	// reloads options every new game in case player changed something
	this.options.load(this.options.save());
	this.display.closeAllOverlays(); // makes sure options screen is closed

	this.difficulty = this.options.read("difficulty");
	this.level = this.options.read("start");
	this.mode = this.options.read("mode");

	this.currentPiece = new Piece(this.difficulty, this.display);
	this.nextPiece = new Piece(this.difficulty, this.display);
	this.display.drawNextPiece(this.nextPiece);

	this.display.backdrop = this.options.read("backdrop");
	this.display.changeBackdrop(this.level - 1);

	this.display.startGame(this.mode);

	if (this.mode == FLASH) {
		this.flashCell = {x: Math.floor(COLS / 2), y: ROWS - 1};
		this.flashClear = false;
		this.display.flashCell(this.flashCell.x, this.flashCell.y);
	} else if (this.mode == TIME_ATTACK) {
		this.time = TIME_ATTACK_LENGTH;
	}

	this.fillHeight();

	this.locked = false;

	this.loop = this.createLoop(this.level);
	this.timer = this.createTimer();
};

Game.prototype.resume = function(obj) {
	this.well = obj.well;
	this.time = obj.time;

	this.score  = obj.score;
	this.level  = obj.level;
	this.jewels = obj.jewels;

	this.difficulty = this.options.read("difficulty");
	this.mode = this.options.read("mode");

	this.flashCell  = obj.flashCell;
	this.flashClear = obj.flashClear;

	// draws well
	for (let y = 0; y < this.well.length; y++) {
		for (let x = 0; x < this.well[y].length; x++) {
			const color = this.well[y][x];

			if (color > 0) {
				this.display.drawCell(x, y, color, this.display.context);
			}
		}
	}

	this.currentPiece = new Piece(this.difficulty, this.display);
	this.currentPiece.load(obj.currentPiece);

	this.nextPiece = new Piece(this.difficulty, this.display);
	this.nextPiece.load(obj.nextPiece);

	this.display.changeBackdrop(this.level - 1);
	this.display.updateTime(this.time);
	this.display.drawNextPiece(this.nextPiece);
	this.display.startGame(this.mode);

	if (this.mode == FLASH) {
		this.display.flashCell(this.flashCell.x, this.flashCell.y);
	}

	this.loop = this.createLoop(this.level);
	this.timer = this.createTimer();

	this.update(); // draws current piece and ghost piece
	this.pause();
};

Game.prototype.createLoop = function(level) {
	this.stopped = false;

	// calculates stepping between fastest speed (1 ms) and slowest (SPEED)
	const FACTOR = ((SPEED - 1) / LEVELS) * level;

	return window.setInterval(function() {
		if (!this.paused && !this.locked && !this.stopped) {
			this.update();

			if (level != this.level) {
				window.clearInterval(this.loop);
				this.loop = this.createLoop(this.level);
			}

			if (this.mode == TIME_ATTACK && this.time <= 0) {
				this.gameOver(); // checks time attack victory condition
			}
		}
	}.bind(this), ((SPEED - FACTOR) * 1000) / (STEP * (ROWS + PIECE_SIZE)));
};

Game.prototype.createTimer = function() {
	return window.setInterval(function() {
		if (!this.paused && !this.stopped) {
			if (this.mode == TIME_ATTACK) {
				this.time--;
			} else {
				this.time++;
			}

			this.display.updateTime(this.time);
		}
	}.bind(this), 1000);
};

Game.prototype.update = async function() {
	const [x, y] = this.currentPiece.getPosition();

	if (this.currentPiece.locked) { // current piece has become stationary
		for (let i = 0; i < PIECE_SIZE; i++) { // saves blocks to grid
			const row = this.well[y + i];

			if (row == undefined) {
				continue;
			}

			row[x] = this.currentPiece.colors[i];
		}

		this.locked = true;

		if (this.options.read("ghost")) {
			this.display.clearGhostPiece();
		}

		await this.findMatches();

		// delay after every move
		window.setTimeout(function() {
			this.locked = false;
		}.bind(this), MOVE_DELAY);

		// va: 置いたピース（列・回した回数・↓ と落下の点・経過秒）を親の窓に知らせる
		const placed = {
			x: x,
			rot: this.currentPiece.rot % PIECE_SIZE,
			bonus: this.pieceBonus,
			t: this.time
		};
		this.pieceBonus = 0;

		this.currentPiece = this.nextPiece;
		this.nextPiece = new Piece(this.difficulty, this.display);

		if (this.mode == STANDARD && this.level > 3 && this.time > 300) {
			// va: 種からの乱数（va_bridge.js）
			this.nextPiece.setMagic(VAColumns.rng() < MAGIC_JEWEL_CHANCE);
		}

		VAColumns.placed(placed);

		this.display.clearNextPiece();
		this.display.drawNextPiece(this.nextPiece);

		if (this.mode == FLASH && this.flashClear) {
			this.gameOver();
		}

		// adjusts jewels needed for next level for starting level
		const start = this.options.read("start");
		let adjustedJewels = this.level * TIER - (start - 1) * TIER;

		// level threshold increases by ten for each level in standard mode
		if (this.mode == STANDARD && this.level > 1) {
			// triangular number;
			// calculates sum of previous values without iteration
			const level = this.level - 1;
			adjustedJewels += TIER_INCREASE * (level * (level + 1)) / 2;
		}

		if (this.jewels >= adjustedJewels && this.level < LEVELS) {
			this.level++;
			this.display.changeBackdrop();
		}
	} else {
		if (this.validate(x, y)) { // creeps piece down if there is room...
			this.currentPiece.moveDownSlowly(y);

			if (this.options.read("ghost")) {
				this.display.drawGhostPiece(
					this.currentPiece,
					this.findBottom(x)
				);
			}
		} else {
			// ...otherwise locks in place because it hit bottom
			if (y - 1 == this.findBottom(x)) {
				this.currentPiece.lock();

				if (y < 0) { // piece locked in above well
					this.gameOver();
				}
			}
		}
	}

	this.display.updateStats(this.level, this.score, this.jewels);
};

Game.prototype.pause = function(state) {
	if (!this.stopped) {
		if (state == undefined || typeof state != "boolean") {
			state = !this.paused; // toggles if no state specified
		}

		this.paused = state;
		this.display.pauseGame(state);
	}
};

Game.prototype.stop = function() {
	window.clearInterval(this.loop);  // game loop
	window.clearInterval(this.timer); // timer

	this.pause(false); // makes sure pause button/overlay off
	this.locked = true;
	this.stopped = true;

	this.display.stopGame();
};

Game.prototype.save = function() {
	if (!this.stopped) {
		return {
			well:         this.well,
			time:         this.time,
			currentPiece: this.currentPiece.save(),
			nextPiece:    this.nextPiece.save(),
			score:        this.score,
			level:        this.level,
			jewels:       this.jewels,
			flashCell:    this.flashCell,
			flashClear:   this.flashClear
		};
	}
};

Game.prototype.reset = function() {
	this.stop();
	this.display.resetGame();

	this.well = Array(ROWS).fill().map(function() {
		return Array(COLS).fill(0);
	});

	this.time = 1;
	this.score = 0;
	this.level = 1;
	this.jewels = 0;
	this.pieceBonus = 0; // va
};

Game.prototype.gameOver = async function() {
	this.stop();

	// va: 終わったことを親の窓に知らせる（最後のピースの列と ↓ の点も。記録は店のランキング）
	VAColumns.over({x: this.currentPiece.x, bonus: this.pieceBonus});

	await this.display.gameOver();
	// va: ローカルのハイスコアの表・名前の入力は出さない
};

Game.prototype.moveLeft = function() {
	const [x, y] = this.currentPiece.getPosition();

	if (this.validate(x - 1, y)) {
		this.currentPiece.moveX(x - 1);
	}
};

Game.prototype.moveRight = function() {
	const [x, y] = this.currentPiece.getPosition();

	if (this.validate(x + 1, y)) {
		this.currentPiece.moveX(x + 1);
	}
};

// va: 元はピースが動かなかったとき（固まった後・段の境目にいるとき）も点が入っていた。動いたときだけ点を入れる
Game.prototype.moveDown = function() {
	const [x, y] = this.currentPiece.getPosition();
	const before = this.currentPiece.y;
	const locked = this.currentPiece.locked;

	if (this.validate(x, y)) { // less than a block away from bottom
		this.currentPiece.moveY(y, false);

		if (!locked && y > before) {
			this.addBonus((this.level + 1) * 2);
		}
	} else if (this.validate(x, y + 1)) { // more than a block away from bottom
		this.currentPiece.moveY(y + 1, false);

		if (!locked && y + 1 > before) {
			this.addBonus(this.level + 1);
		}
	}
};

// va: 落としたときも、下りた段の分だけ（元は固まりかけのときに点が減ることがあった）
Game.prototype.drop = function() {
	const [x, y] = this.currentPiece.getPosition();
	const bottom = this.findBottom(x);
	const locked = this.currentPiece.locked;

	this.currentPiece.moveY(bottom, true);

	if (!locked && bottom > y) {
		this.addBonus((bottom - y) * (this.level + 1) * 2);
	}
};

// va: ↓ と落下の点（点数に足し、ピースごとにも数える）
Game.prototype.addBonus = function(points) {
	this.score += points;
	this.pieceBonus += points;
};

Game.prototype.validate = function(x, y) {
	// enforces margins of well
	if (x < 0 || x >= COLS || y > ROWS - PIECE_SIZE) {
		return false;
	}

	let valid = true;

	for (let i = 0; i < PIECE_SIZE; i++) {
		const row = this.well[y + i];

		if (row == undefined) {
			continue;
		}

		if (row[x] > 0) {
			valid = false;
			break;
		}
	}

	return valid;
};

Game.prototype.findBottom = function(x) {
	let y = 0;

	while (this.well[y] != undefined) {
		if (this.well[y][x] > 0) {
			break;
		}

		y++;
	}

	if (y < 0) {
		y = ROWS;
	}

	return y - PIECE_SIZE;
};

Game.prototype.findMatches = async function(chain=0) {
	const well = this.well;
	const matches = [];

	if (this.currentPiece.magic) {
		const x = this.currentPiece.x, y = this.currentPiece.y + PIECE_SIZE;

		if (this.well[y] != undefined && this.well[y][x] > 0) {
			doMagicJewel(this.well[y][x]);
		} else if (this.currentPiece.locked) {
			// gives point bonus if jewel is not used (hits bottom)
			this.score += MAGIC_JEWEL_BONUS;
			this.display.showPoints(MAGIC_JEWEL_BONUS);
		}
	}

	// matches horizontally
	scanMatrix(this.well, false);
	// matches vertically
	scanMatrix(transposeMatrix(this.well), true);
	// matches diagonally
	scanDiagonals();

	const cleared = clearMatches();
	this.jewels += cleared.length;

	const points = cleared.length * 10 * this.level * (chain + 1);
	this.score += points;
	this.display.showPoints(points);

	// checks flash mode victory condition
	const flashCell = this.well[this.flashCell.y][this.flashCell.x];
	this.flashClear |= this.mode == FLASH && flashCell == 0;

	const moved = doGravity();

	await this.display.clearMultiple(cleared);
	await this.display.dropMultiple(moved);

	if (cleared.length > 0) {
		await this.findMatches(chain + 1);
	}

	function scanMatrix(grid, invertCoords=false) {
		for (let y = 0; y < grid.length; y++) {
			let currentColor = 0, prevColor = 0;
			let count = 0, match = [], found = false;

			for (let x = 0; x < grid[y].length; x++) {
				prevColor = currentColor;
				currentColor = grid[y][x];

				// non-consecutive block colors
				if (currentColor == 0 || currentColor != prevColor) {
					if (found) { // saves match if found
						found = false;
						matches.push(match);
					}

					count = 0;
					match = [];
				}

				count++;
				match.push(invertCoords ? {x: y, y: x} : {x, y});

				if (count >= MATCH_SIZE) {
					found = true;
				}
			}

			if (found) { // special case for matches at right end of well
				matches.push(match);
			}
		}
	}

	function scanDiagonals() {
		for (let y = 0; y < well.length; y++) {
			for (let x = 0; x < well[y].length; x++) {
				if (well[y][x] == 0) {
					continue;
				}

				const match1 = [];
				let x1 = x, y1 = y, count1 = 0;

				do {
					match1.push({x: x1, y: y1});

					count1++;
					x1++;
					y1++;
				} while (well[y1] != undefined && well[y][x] == well[y1][x1]);

				if (count1 >= MATCH_SIZE) {
					matches.push(match1);
				}

				const match2 = [];
				let x2 = x, y2 = y, count2 = 0;

				do {
					match2.push({x: x2, y: y2});

					count2++;
					x2--;
					y2++;
				} while (well[y2] != undefined && well[y][x] == well[y2][x2]);

				if (count2 >= MATCH_SIZE) {
					matches.push(match2);
				}
			}
		}
	}

	function transposeMatrix(oldGrid) {
		const newGrid = Array(COLS).fill().map(function() {
			return Array(ROWS).fill(0);
		});

		for (let y = 0; y < oldGrid.length; y++) {
			for (let x = 0; x < oldGrid[y].length; x++) {
				newGrid[x][y] = oldGrid[y][x];
			}
		}

		return newGrid;
	}

	function doMagicJewel(color) {
		const match = [];

		for (let y = 0; y < well.length; y++) {
			for (let x = 0; x < well[y].length; x++) {
				if (well[y][x] == color || well[y][x] == WHITE) {
					match.push({x, y}); // also matches magic jewel
				}
			}
		}

		matches.push(match);
	}

	function doGravity() {
		const moved = [];

		for (let y = well.length - 1; y >= 0; y--) {
			for (let x = 0; x < well[y].length; x++) {
				if (well[y][x] > 0) {
					continue; // cell is not empty
				}

				let n = 1;

				// finds next cell above current cell, which is not necessarily
				// the very next cell because of matches/clears
				while (well[y - n] != undefined) {
					if (well[y - n][x] > 0) {
						break;
					}

					n++;
				}

				// current cell is already highest
				// (next cell is out of bounds or not clear)
				if (well[y - n] == undefined || well[y - n][x] == 0) {
					continue;
				}

				moved.push({x, y, n, color: well[y - n][x]});

				well[y][x] = well[y - n][x];
				well[y - n][x] = 0;
			}
		}

		return moved;
	}

	function clearMatches() {
		const cleared = [];

		while (matches.length > 0) {
			const row = matches.pop();

			for (const cell of row) {
				cleared.push(cell);
				well[cell.y][cell.x] = 0;

			}
		}

		return cleared;
	}
};

Game.prototype.fillHeight = function() {
	const well = this.well;
	const height = this.options.read("height");
	const complex = Math.floor(COLS / 2);
	let color = 0;

	for (let y = this.well.length - height; y < this.well.length; y++) {
		if (color == 0 || (this.difficulty > complex && y % 2 != 0)) {
			// picks new starting color every other row to give more randomized
			// appearance, unless there are too few colors at given difficulty
			color = START_COLOR + Math.floor(VAColumns.rng() * this.difficulty); // va
		}

		// goes through sequence in order unless there is a potential conflict;
		// choosing a random color for each cell often leads to situations
		// where there is no possible color left that does not cause a match
		for (let x = 0; x < this.well[y].length; color++, x++) {
			// loop breaks if number of iterations exceeds number of colors,
			// so it picks a color that causes a match rather than
			// infinite looping
			for (let i = 0; i < this.difficulty; color++, i++) {
				if (color >= this.difficulty + START_COLOR) {
					color = START_COLOR;
				}

				const matchesHorizontal = color != getValue(x - 1, y)
					|| color != getValue(x - 2, y);
				const matchesDiagonal1 = color != getValue(x - 1, y - 1)
					|| color != getValue(x - 2, y - 2);
				const matchesDiagonal2 = color != getValue(x + 1, y - 1)
					|| color != getValue(x + 2, y - 2);

				if (matchesHorizontal && matchesDiagonal1 && matchesDiagonal2) {
					const adj1 = color != getValue(x, y - 1);
					const adj2 = color != getValue(x, y - 2);

					// uses stricter matching rules at higher difficulties
					// (when there are more colors)
					if (
						(this.difficulty > complex && adj1 && adj2)
						|| (this.difficulty <= complex && (adj1 || adj2))
					) {
						break;
					}
				}
			}

			this.well[y][x] = color;
			this.display.drawCell(x, y, color, this.display.context);
		}
	}

	function getValue(x, y) {
		if (well[y] == undefined) {
			return START_COLOR;
		}

		return well[y][x];
	}
};

/*
 * Piece prototype
 */

function Piece(difficulty, display) {
	this.display = display;

	this.x = Math.floor(COLS / 2);
	this.y = -PIECE_SIZE;
	this.fraction = 0;
	this.locked = false;
	this.magic = false;
	this.rot = 0; // va: 回した回数（親の窓に知らせる）

	this.colors = Array(PIECE_SIZE).fill().map(function() {
		// va: 種からの乱数（va_bridge.js）。呼ぶ順番は元のまま
		return START_COLOR + Math.floor(VAColumns.rng() * difficulty);
	});
}

Piece.prototype.lock = function() {
	this.display.clearCurrentPiece(this);

	this.fraction = 0;
	this.locked = true;

	this.display.drawCurrentPiece(this);
};

Piece.prototype.rotate = function() {
	if (!this.locked) {
		this.display.clearCurrentPiece(this);
		this.colors.unshift(this.colors.pop());
		this.rot++; // va
	}
};

Piece.prototype.moveDownSlowly = function(y) {
	if (!this.locked) {
		if (this.y < ROWS - PIECE_SIZE) {
			this.display.clearCurrentPiece(this);

			if (this.fraction < STEP - 1) {
				this.fraction++;
			} else {
				this.y++;
				this.fraction = 0;
			}

			this.display.drawCurrentPiece(this);
		} else {
			this.lock();
		}
	}
};

Piece.prototype.moveX = function(x) {
	if (!this.locked) {
		this.display.clearCurrentPiece(this);
		this.x = x;
		this.display.drawCurrentPiece(this);
	}
};

Piece.prototype.moveY = function(y, lock=false) {
	if (!this.locked) {
		this.display.clearCurrentPiece(this);
		this.fraction = 0;
		this.y = y;
		this.display.drawCurrentPiece(this);

		if (lock) {
			this.lock();
		}
	}
};

Piece.prototype.getPosition = function() {
	return [this.x, Math.ceil(this.y + this.fraction/STEP)];
};

Piece.prototype.setMagic = function(state) {
	if (state) {
		this.colors = Array(PIECE_SIZE).fill(WHITE);
		this.magic = true;
	}
};

Piece.prototype.load = function(obj) {
	this.x        = obj.x;
	this.y        = obj.y;
	this.fraction = obj.fraction;
	this.locked   = obj.locked;
	this.magic    = obj.magic;
	this.colors   = obj.colors;
};

Piece.prototype.save = function(obj) {
	return {
		x:        this.x,
		y:        this.y,
		fraction: this.fraction,
		locked:   this.locked,
		magic:    this.magic,
		colors:   this.colors
	};
};

/*
 * Display prototype
 */

function Display() {
	this.context = null;
	this.nextContext = null;
	this.gridContext = null;

	this.index = 0;
	this.ghost = {x: -PIECE_SIZE, y: -PIECE_SIZE};
	this.backdrop = PHOTOGRAPH;
	this.mode = STANDARD;

	this.loop = null;
}

Display.prototype.init = function() {
	const canvas = $("#well");
	canvas.hidden = false;
	this.context = canvas.getContext("2d");
	this.context.canvas.width  = COLS * BLOCK_SIZE;
	this.context.canvas.height = ROWS * BLOCK_SIZE;
	this.context.lineWidth = BLOCK_STROKE_WIDTH;

	const ratio = canvas.offsetHeight / this.context.canvas.height;

	const nextCanvas = $("#next canvas");
	nextCanvas.hidden = false;
	nextCanvas.style.height = PIECE_SIZE * BLOCK_SIZE * ratio + "px";
	nextCanvas.style.width = BLOCK_SIZE * ratio + "px";
	this.nextContext = nextCanvas.getContext("2d");
	this.nextContext.canvas.width  = BLOCK_SIZE;
	this.nextContext.canvas.height = BLOCK_SIZE * PIECE_SIZE;
	this.nextContext.lineWidth = BLOCK_STROKE_WIDTH;

	if (document.documentElement.className == "") {
		this.changeBackdrop();
	}

	this.mode = STANDARD;

	this.closeAllOverlays();
	this.updateTime(0);
	this.updateStats(0, 0, 0);

	const gridCanvas = $("#grid");
	gridCanvas.hidden = false;
	this.gridContext = gridCanvas.getContext("2d");
	this.gridContext.canvas.width  = COLS * BLOCK_SIZE;
	this.gridContext.canvas.height = ROWS * BLOCK_SIZE;

	this.drawGrid();
};

Display.prototype.drawCell = function(x, y, color, context, fraction=0) {
	const cx = x * BLOCK_SIZE;
	const cy = y * BLOCK_SIZE + fraction/STEP * BLOCK_SIZE;

	const gradient = context.createLinearGradient(
		cx, cy,
		cx + BLOCK_SIZE, cy + BLOCK_SIZE
	);
	gradient.addColorStop(0, COLORS[color][0]);
	gradient.addColorStop(1, COLORS[color][1]);

	context.fillStyle = gradient;
	context.fillRect(cx, cy, BLOCK_SIZE, BLOCK_SIZE);

	if (color == WHITE) { // flashing border for magic jewel
		color = Math.floor(Math.random() * COLORS.length);
	}

	context.strokeStyle = COLORS[color][0];
	context.strokeRect(
		cx + BLOCK_STROKE_WIDTH, cy + BLOCK_STROKE_WIDTH,
		BLOCK_SIZE - BLOCK_STROKE_WIDTH * 2, BLOCK_SIZE - BLOCK_STROKE_WIDTH * 2
	);
};

Display.prototype.drawCurrentPiece = function(piece) {
	for (const [i, color] of piece.colors.entries()) {
		this.drawCell(
			piece.x, piece.y + i,
			color,
			this.context,
			piece.fraction
		);
	}
};

Display.prototype.drawNextPiece = function(piece) {
	for (const [i, color] of piece.colors.entries()) {
		this.drawCell(0, i, color, this.nextContext);
	}
};

Display.prototype.drawGhostPiece = function(piece, bottom) {
	const cx = piece.x * BLOCK_SIZE + GHOST_INSET;
	const gx = this.ghost.x * BLOCK_SIZE + GHOST_INSET - GHOST_WIDTH;

	const size = BLOCK_SIZE - GHOST_INSET * 2;
	const ghostSize = BLOCK_SIZE - GHOST_INSET;

	this.gridContext.lineWidth = GHOST_WIDTH;

	for (const [i, color] of piece.colors.entries()) {
		const cy = (bottom + i) * BLOCK_SIZE + GHOST_INSET;
		const gy = (this.ghost.y + i) * BLOCK_SIZE + GHOST_INSET - GHOST_WIDTH;

		const gradient = this.gridContext.createLinearGradient(
			gx, gy,
			gx + ghostSize, gy + ghostSize
		);
		gradient.addColorStop(0, COLORS[color][0]);
		gradient.addColorStop(1, COLORS[color][2]);

		this.gridContext.clearRect(gx, gy, ghostSize, ghostSize);
		this.gridContext.strokeStyle = gradient;
		this.gridContext.strokeRect(cx, cy, size, size);
	}

	this.ghost.x = piece.x;
	this.ghost.y = bottom;
};

Display.prototype.drawGrid = function() {
	this.gridContext.beginPath();
	this.gridContext.strokeStyle = GRID_LINE_COLOR;
	this.gridContext.lineWidth = GRID_LINE_WIDTH;

	const w = $("#grid").width;
	const h = $("#grid").height;

	for (let i = 0; i < COLS; i++) {
		const x = (i + 1) * BLOCK_SIZE;

		this.gridContext.moveTo(x, 0);
		this.gridContext.lineTo(x, h);
		this.gridContext.stroke();
	}

	for (let i = 0; i < ROWS; i++) {
		const y = (i + 1) * BLOCK_SIZE;

		this.gridContext.moveTo(0, y);
		this.gridContext.lineTo(w, y);
		this.gridContext.stroke();
	}

	this.gridContext.closePath();
};

Display.prototype.dropCell = function(x, y, color, n=1) {
	return new Promise(function(resolve) {
		let fraction = 0;

		const timer = window.setInterval(function() {
			if (fraction >= STEP - 1) {
				window.clearInterval(timer);
				resolve();
			}

			this.context.clearRect(
				x * BLOCK_SIZE, y * BLOCK_SIZE + fraction/STEP * BLOCK_SIZE * n,
				BLOCK_SIZE, BLOCK_SIZE
			);

			fraction++;

			this.drawCell(x, y, color, this.context, fraction * n);
		}.bind(this), DROP_DELAY);
	}.bind(this));
};

Display.prototype.clearAll = function() {
	window.clearInterval(this.loop);

	const canvas = $("#well");
	this.context.clearRect(0, 0, canvas.width, canvas.height);

	this.clearGhostPiece();
};

Display.prototype.clearCell = function(x, y) {
	return new Promise(function(resolve) {
		const cx = x * BLOCK_SIZE;
		const cy = y * BLOCK_SIZE;
		let color = 0;

		// flashes border before clearing
		const timer = window.setInterval(function() {
			if (color >= COLORS.length) {
				this.context.clearRect(cx, cy, BLOCK_SIZE, BLOCK_SIZE);

				window.clearInterval(timer);
				resolve();
				return;
			}

			const gradient = this.context.createLinearGradient(
				cx, cy,
				cx + BLOCK_SIZE, cy + BLOCK_SIZE
			);
			gradient.addColorStop(0, COLORS[color][0]);
			gradient.addColorStop(1, COLORS[color][1]);

			this.context.strokeStyle = COLORS[color][0];
			this.context.strokeRect(
				cx + BLOCK_STROKE_WIDTH,
				cy + BLOCK_STROKE_WIDTH,
				BLOCK_SIZE - BLOCK_STROKE_WIDTH * 2,
				BLOCK_SIZE - BLOCK_STROKE_WIDTH * 2
			);

			color++;
		}.bind(this), CLEAR_DELAY);
	}.bind(this));
};

Display.prototype.flashCell = function(x, y) {
	const cx = x * BLOCK_SIZE;
	const cy = y * BLOCK_SIZE;
	let color = 0;

	this.loop = window.setInterval(function() {
		color = color % COLORS.length;

		const gradient = this.context.createLinearGradient(
			cx, cy,
			cx + BLOCK_SIZE, cy + BLOCK_SIZE
		);
		gradient.addColorStop(0, COLORS[color][0]);
		gradient.addColorStop(1, COLORS[color][1]);

		this.context.strokeStyle = COLORS[color][0];
		this.context.strokeRect(
			cx + BLOCK_STROKE_WIDTH, cy + BLOCK_STROKE_WIDTH,
			BLOCK_SIZE - BLOCK_STROKE_WIDTH * 2,
			BLOCK_SIZE - BLOCK_STROKE_WIDTH * 2
		);

		color++;
	}.bind(this), CLEAR_DELAY);
};

Display.prototype.clearPiece = function(piece, context) {
	context.clearRect(
		piece.x * BLOCK_SIZE,
		piece.y * BLOCK_SIZE + piece.fraction/STEP * BLOCK_SIZE,
		BLOCK_SIZE,
		PIECE_SIZE * BLOCK_SIZE
	);
};

Display.prototype.clearCurrentPiece = function(piece) {
	this.clearPiece(piece, this.context);
};

Display.prototype.clearNextPiece = function() {
	this.clearPiece({x: 0, y: 0, fraction: 0}, this.nextContext);
};

Display.prototype.clearGhostPiece = function() {
	const gx = this.ghost.x * BLOCK_SIZE + GHOST_INSET - GHOST_WIDTH;
	const ghostSize = BLOCK_SIZE - GHOST_INSET;

	for (let i = 0; i < PIECE_SIZE; i++) {
		const gy = (this.ghost.y + i) * BLOCK_SIZE + GHOST_INSET - GHOST_WIDTH;
		this.gridContext.clearRect(gx, gy, ghostSize, ghostSize);
	}
};

Display.prototype.clearMultiple = function(cleared) {
	const promises = [];

	for (const cell of cleared) {
		promises.push(this.clearCell(cell.x, cell.y));
	}

	return Promise.all(promises);
};

Display.prototype.dropMultiple = function(moved) {
	const promises = [];

	for (const cell of moved) {
		promises.push(this.dropCell(
			cell.x, cell.y - cell.n,
			cell.color, cell.n
		));
	}

	return Promise.all(promises);
};

Display.prototype.changeBackdrop = function(index) {
	this.backdrop = GRADIENT; // va: 写真は同梱しない（背景は Gradient だけ）

	if (this.backdrop == PHOTOGRAPH) {
		this.changePhotograph(index);
		document.documentElement.className = "photograph";
	} else {
		this.changeGradient();
		document.documentElement.className = "gradient";
	}
};

Display.prototype.changePhotograph = function(index) {
	if (index != undefined) {
		this.index = index;
	}

	this.index %= IMAGES.length;

	const background = IMAGES[this.index];
	const url = "images/" + background.file + ".jpg";

	const img = new Image();
	img.src = url;
	img.addEventListener("load", function() {
		document.documentElement.style.backgroundImage = `url(${url})`;

		const a = $("#photographer");
		a.href = background.url;
		a.textContent = background.author;
	});

	this.index++;
};

Display.prototype.changeGradient = function() {
	const color1 = randomColor();
	const color2 = randomColor();
	const angle = Math.floor(Math.random() * 360);
	const gradient = `linear-gradient(${angle}deg, #${color1}, #${color2})`;
	document.documentElement.style.backgroundImage = gradient;

	function randomColor() {
		return Math.floor(Math.random() * 2**24).toString(16).padStart(6, "0");
	}
};

Display.prototype.closeAllOverlays = function() {
	for (const element of $$(".overlay")) {
		element.classList.remove("open");
	}
};

Display.prototype.startGame = function(mode) {
	this.mode = mode;

	$("#play").textContent = "Pause";
	$("#reset").disabled = false;
	this.toggleControls(true);

	for (const element of $$(".toggle")) {
		element.disabled = true;
	}
};

Display.prototype.pauseGame = function(state) {
	$("#play").textContent = state ? "Resume" : "Pause";
	$("#overlay_pause").classList.toggle("open", state);
};

Display.prototype.stopGame = function() {
	window.clearInterval(this.loop); // flash mode block
	this.toggleControls(false);
};

Display.prototype.resetGame = function() {
	this.clearAll();
	this.closeAllOverlays();

	$("#play").textContent = "Play";
	$("#play").disabled = false;
	$("#reset").disabled = true;

	for (const element of $$(".toggle")) {
		element.disabled = false;
	}

	$("#time").classList.remove("flash");
};

Display.prototype.gameOver = async function() {
	await this.fillWell();

	$("#play").disabled = true;
	$("#overlay_gameover").classList.add("open");
};

Display.prototype.fillWell = function() {
	return new Promise(function(resolve) {
		let x = COLS;
		let y = ROWS;

		const timer = window.setInterval(function() { // covers well in blocks
			if (y < 0) {
				window.clearInterval(timer);
				resolve();
				return;
			}

			if (x < 0) {
				x = COLS;
				y--;
			}

			this.drawCell(x, y, BLACK, this.context);

			x--;
		}.bind(this), FLASH_DELAY);
	}.bind(this));
};

Display.prototype.updateTime = function(time) {
	$("#time").textContent = this.formatTime(time);

	if (this.mode == TIME_ATTACK && time < TIME_ATTACK_FLASH) {
		this.mode = STANDARD;
		$("#time").classList.add("flash");
	}
};

Display.prototype.updateStats = function(level, score, jewels) {
	$("#level").textContent = level;
	$("#score").textContent = score.toLocaleString();
	$("#jewels").textContent = jewels.toLocaleString();
};

Display.prototype.showPoints = function(points) {
	if (points > 0) {
		// replaces element each time so CSS animation plays
		const div = document.createElement("div");
		div.id = "points";
		div.textContent = "+" + points.toLocaleString();
		$("#points").replaceWith(div);
	}
};

Display.prototype.showScores = function(scores, mode, difficulty, isEnd=false) {
	difficulty -= STARTING_DIFFICULTY; // adjusts score from number of colors

	if (
		scores.tables[mode] == undefined
		|| scores.tables[mode][difficulty] == undefined
	) {
		return;
	}

	const table = document.createElement("table");
	const tr = document.createElement("tr");
	const name = document.createElement("th");
	const time = document.createElement("th");
	const level = document.createElement("th");
	const jewels = document.createElement("th");
	const score = document.createElement("th");

	name.className = "name";
	time.className = "time";
	level.className = "level";
	jewels.className = "jewels";
	score.className = "score";

	name.textContent = "Player";
	time.textContent = "Time";
	level.textContent = "Level";
	jewels.textContent = "Jewels";
	score.textContent = "Score";

	tr.appendChild(name);
	tr.appendChild(time);
	tr.appendChild(level);
	tr.appendChild(jewels);
	tr.appendChild(score);
	table.appendChild(tr);

	for (let i = 0; i < TABLE_SIZE; i++) {
		const tr = document.createElement("tr");
		const name = document.createElement("td");
		const time = document.createElement("td");
		const level = document.createElement("td");
		const jewels = document.createElement("td");
		const score = document.createElement("td");

		name.className = "name";
		time.className = "time";
		level.className = "level";
		jewels.className = "jewels";
		score.className = "score";

		const scoreTable = scores.tables[mode][difficulty];

		if (scoreTable[i] != undefined) {
			name.textContent = scoreTable[i].name;
			time.textContent = this.formatTime(scoreTable[i].time);
			level.textContent = scoreTable[i].level;
			jewels.textContent = scoreTable[i].jewels.toLocaleString();
			score.textContent = scoreTable[i].score.toLocaleString();

			if (scoreTable[i].date > 0) {
				const date = new Date(scoreTable[i].date * 1000);
				name.setAttribute("title", date.toLocaleString());
			}
		} else {
			name.textContent = "—";
			time.textContent = "—";
			level.textContent = 0;
			jewels.textContent = 0;
			score.textContent = 0;
		}

		tr.appendChild(name);
		tr.appendChild(time);
		tr.appendChild(level);
		tr.appendChild(jewels);
		tr.appendChild(score);
		table.appendChild(tr);
	}

	const id = isEnd ? "gameover" : "scores";
	$(`#overlay_${id} table`).replaceWith(table);
};

Display.prototype.toggleControls = function(state=false) {
	for (const element of $$("#controls button")) {
		element.disabled = !state;
	}
};

Display.prototype.togglePrompt = function(state=false) {
	$("#prompt").hidden = !state;
	$("#prompt input").disabled = !state;
	$("#prompt button").disabled = !state;
};

Display.prototype.formatTime = function(time) {
	if (time < 0) {
		return "0:00";
	}

	const hr  = Math.floor(time / 3600).toString();
	const rem = time % 3600;
	const min = Math.floor(rem / 60).toString();
	const sec = Math.floor(rem % 60).toString().padStart(2, "0");

	if (hr > 0) {
		const pad = min.padStart(2, "0");
		return `${hr}:${pad}:${sec}`;
	}

	return `${min}:${sec}`;
};

/*
 * Options prototype
 */

function Options() {
	this.values = {};
	this.defaults = {
		name:       "",
		start:      DEFAULT_START_LEVEL,
		difficulty: DEFAULT_DIFFICULTY,
		height:     DEFAULT_HEIGHT,
		mode:       STANDARD,
		ghost:      GHOST_PIECE,
		backdrop:   GRADIENT // va: 写真は同梱しない
	};
}

Options.prototype.load = function(options) {
	if (options != undefined) {
		this.values = options;
	} else {
		this.values = Object.assign({}, this.defaults); // copies default values
	}

	// sets form elements
	for (const [key, value] of Object.entries(this.values)) {
		const elements = document.getElementsByName(key);

		if (elements.length > 0) { // radio buttons
			for (const element of document.getElementsByName(key)) {
				element.checked = Number(element.value) == value;
			}
		} else { // checkboxes and range sliders
			const element = $("#" + key);

			if (element != undefined) {
				if (element.type == "checkbox") {
					element.checked = Boolean(value);
				} else {
					element.value = Number(value);
				}
			}
		}
	}

	// va: 名前の入力は出さない
};

Options.prototype.save = function() {
	const options = {};

	for (const element of $$(".option")) { // reads state of form elements
		if (element.type == "checkbox") {
			options[element.id] = Number(element.checked);
		} else if (element.type == "radio") {
			if (element.checked) {
				options[element.name] = Number(element.value);
			}
		} else {
			options[element.id] = Number(element.value);
		}
	}

	for (const option of Object.keys(options)) {
		if (this.defaults[option] == options[option]) {
			// removes options that are same as default values
			delete options[option];
		}
	}

	return options;
};

Options.prototype.read = function(key) {
	let value = 0;

	if (this.values[key] != undefined) {
		value = Number(this.values[key]);

		if (Number.isNaN(value)) {
			value = Number(this.defaults[key]);
		}
	} else {
		value = Number(this.defaults[key]);
	}

	return value;
};

/*
 * Scores prototype
 */

function Scores() {
	this.tables = Array(GAME_MODES).fill().map(function() {
		return Array(DIFFICULTY_LEVELS).fill().map(function() {
			return [];
		});
	});
	this.modified = false;
}

Scores.prototype.load = function(tables) {
	if (tables != undefined && tables.length > 0) {
		this.tables = tables;
		this.modified = true;
	} else { // fills with default values
		for (let i = 0; i < GAME_MODES; i++) {
			for (let j = 0; j < DIFFICULTY_LEVELS; j++) {
				this.tables[i][j] = Array(TABLE_SIZE).fill().map(function() {
					return {
						name:   "AAA",
						date:   0,
						time:   600,
						level:  1,
						score:  100,
						jewels: 10
					};
				});
			}
		}
	}
};

Scores.prototype.save = function() {
	if (this.modified) { // only saves tables if they contain player data
		return this.tables;
	}
};

Scores.prototype.add = function(name, mode, diff, time, level, score, jewels) {
	diff -= STARTING_DIFFICULTY;

	if (
		this.tables[mode] == undefined
		|| this.tables[mode][diff] == undefined
	) {
		return;
	}

	if (mode == TIME_ATTACK) {
		time = TIME_ATTACK_LENGTH;
	}

	const date = Math.floor(Date.now() / 1000);

	this.tables[mode][diff].push({name, date, time, level, score, jewels});
	this.tables[mode][diff].sort(function(a, b) {
		const cmp = a.time - b.time;

		// sorts by time and then score in flash mode
		if (mode == FLASH && cmp != 0) {
			return cmp;
		}

		return b.score - a.score;
	});
	this.tables[mode][diff] = this.tables[mode][diff].slice(0, TABLE_SIZE);
	this.modified = true;
};

Scores.prototype.check = function(mode, diff, time, score) {
	diff -= STARTING_DIFFICULTY;

	if (
		this.tables[mode] == undefined
		|| this.tables[mode][diff] == undefined
	) {
		return;
	}

	return this.tables[mode][diff].some(function(row) {
		if (mode == FLASH && time != row.time) {
			return time < row.time;
		}

		return score > row.score;
	});
};

/*
 * Storage prototype
 */

function Storage(name) {
	this.name = name;
}

Storage.prototype.load = function() {
	try {
		const contents = localStorage.getItem(this.name);

		if (contents != null) {
			return JSON.parse(contents);
		}
	} catch (err) {
		console.error(err);
		this.reset();
		return null;
	}
};

Storage.prototype.save = function(list) {
	try {
		if (Object.keys(list).length != 0) {
			localStorage.setItem(this.name, JSON.stringify(list));
		} else {
			this.reset();
		}
	} catch (err) {
		console.error(err);
	}
};

Storage.prototype.reset = function() {
	try {
		localStorage.removeItem(this.name);
	} catch (err) {
		console.error(err);
	}
};