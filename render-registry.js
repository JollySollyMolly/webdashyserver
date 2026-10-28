/* Mode draw functions register here (modes/*.js). game.js calls GDRender.draw[mode](api, S). */
window.GDRender = { draw: {}, register: function (mode, fn) { this.draw[mode] = fn; } };
