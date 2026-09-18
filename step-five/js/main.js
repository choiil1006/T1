// Bootstrap: wire every module up in dependency order, then restore whatever
// was saved from a previous session.
(function () {
  "use strict";

  SF.ui.init();
  SF.input.init();
  SF.editor.init();
  SF.game.cacheLaneEls();

  SF.ui.restoreFromStorage();
})();
