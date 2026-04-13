(function () {
  "use strict";

  // Public API stub — filled in Task 6
  window.ProfileCard = {
    show: function (username) {
      console.warn("[ProfileCard] show() not yet implemented for", username);
    },
    close: function () {},
    isOpen: function () { return false; },
    bindTrigger: function (el, username) {
      if (!el) { return; }
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        window.ProfileCard.show(username);
      });
    },
  };
})();
