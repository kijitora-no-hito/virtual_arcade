function rotatePoint(x, y, theta) {
	var thetaRad = theta * (Math.PI / 180);
	var rotX = Math.cos(thetaRad) * x - Math.sin(thetaRad) * y;
	var rotY = Math.sin(thetaRad) * x + Math.cos(thetaRad) * y;

	return {
		x: rotX,
		y: rotY
	};
}

// va: 落ちてくるブロックの乱数を、親の窓（サーバ）が渡す種からの mulberry32 に（va_bridge.js）
function randInt(min, max) {
	return Math.floor((VAHextris.rng() * max) + min);
}
