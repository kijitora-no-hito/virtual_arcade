function exportSaveState() {
	var state = {};

	if(gameState == 1 || gameState == -1 || (gameState === 0 && false /* va: 保存しない */)) {
		state = {
			hex: $.extend(true, {}, MainHex),
			blocks: $.extend(true, [], blocks),
			score: score,
			wavegen: waveone,
			gdx: gdx,
			gdy: gdy,
			comboTime:settings.comboTime
		};

		state.hex.blocks.map(function(a){
			for (var i = 0; i < a.length; i++) {
				a[i] = $.extend(true, {}, a[i]);
			}

			a.map(descaleBlock);
		});

		for (var i = 0; i < state.blocks.length; i++) {
			state.blocks[i] = $.extend(true, {}, state.blocks[i]);
		}

		state.blocks.map(descaleBlock);
	}

	// va: ハイスコア・途中の状態は保存しない（記録は店のランキング）
	return "{}";
}

function descaleBlock(b) {
	b.distFromHex /= settings.scale;
}

function writeHighScores() {
		highscores.sort(
		function(a,b){
			a = parseInt(a, 10);
			b = parseInt(b, 10);
			if (a < b) {
				return 1;
			} else if (a > b) {
				return -1;
			}else {
				return 0;
			}
		}
	);
	highscores = highscores.slice(0,3);
	// va: localStorage に残さない（このページを開いている間だけ）
}

function clearSaveState() {
	// va: 途中の状態は保存しない
}

function isStateSaved() {
	// va: 途中の状態は保存しない（いつも新しいゲーム）
	return false;
}
